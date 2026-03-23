// ── Garbage Collection Service ──────────────────────────────
// Periodically cross-references all IDB media blobs against
// live project records and feed posts. Blobs with refCount=0
// that are older than 24h and not referenced anywhere are purged.
//
// Run on app boot + every 30 minutes via the root layout.

import { del } from "idb-keyval";
import { getAllMediaIds, getStoredMediaItem } from "./media-pool-db";
import { getAllProjectIds, loadProjectFromIDB } from "./project-idb";

const DB_PREFIX = "synapse-media-";
const GC_MAX_AGE_MS = 24 * 60 * 60 * 1_000; // 24 hours

function itemKey(id: string) { return `${DB_PREFIX}${id}`; }

export interface GcResult {
  purged: number;
  bytesFreed: number;
}

export async function runGcSweep(): Promise<GcResult> {
  // 1. Collect all referenced media IDs from live IDB projects
  const referencedIds = new Set<string>();

  const projectIds = await getAllProjectIds();
  await Promise.all(projectIds.map(async (pid) => {
    const proj = await loadProjectFromIDB(pid);
    proj?.tracks
      .flatMap((t) => t.clips)
      .forEach((c) => { if (c.sourceId) referencedIds.add(c.sourceId); });
  }));

  // 2. Also collect IDs referenced by feed posts (via runtime import to avoid circular deps)
  try {
    const { useFeedStore } = await import("./feed-store");
    const posts = useFeedStore.getState().userPosts;
    for (const post of posts) {
      post.projectSnapshot?.mediaPool?.forEach((m) => referencedIds.add(m.id));
    }
  } catch { /* feed-store unavailable in SSR/test */ }

  // 3. Sweep all media blobs in IDB
  const allIds = await getAllMediaIds();
  let purged = 0;
  let bytesFreed = 0;

  await Promise.all(allIds.map(async (id) => {
    if (referencedIds.has(id)) return; // still referenced — keep
    const item = await getStoredMediaItem(id);
    if (!item) return;
    // Only purge when refCount=0 AND older than GC_MAX_AGE_MS
    if ((item.refCount ?? 1) <= 0 && Date.now() - (item.createdAt ?? 0) > GC_MAX_AGE_MS) {
      bytesFreed += item.data?.byteLength ?? 0;
      await del(itemKey(id));
      purged++;
    }
  }));

  if (purged > 0) {
    console.info(`[GC] Purged ${purged} orphaned blobs (${(bytesFreed / 1024 / 1024).toFixed(2)} MB freed)`);
  }
  return { purged, bytesFreed };
}
