// ── Persistent Media Pool via IndexedDB (idb-keyval) ─────
// Stores file ArrayBuffers so media survives page refreshes.
// On load, the file blobs are reconstructed into ObjectURLs.

import { get, set, del, keys } from "idb-keyval";
import type { MediaPoolItem } from "./types";

interface StoredMediaItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  duration: number;
  mimeType: string;
  data: ArrayBuffer;
}

const DB_PREFIX = "synapse-media-";

const MIME_MAP: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};
function inferMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function itemKey(id: string): string {
  return `${DB_PREFIX}${id}`;
}

/** Save a file to IndexedDB alongside its metadata. */
export async function saveMediaToDB(file: File, item: MediaPoolItem): Promise<void> {
  const data = await file.arrayBuffer();
  const stored: StoredMediaItem = {
    id: item.id,
    name: item.name,
    type: item.type,
    duration: item.duration,
    mimeType: file.type || inferMimeType(file.name),
    data,
  };
  await set(itemKey(item.id), stored);
}

/** Load all stored media items from IndexedDB, recreating ObjectURLs. */
export async function loadMediaFromDB(): Promise<MediaPoolItem[]> {
  const allKeys = await keys<string>();
  const mediaKeys = allKeys.filter((k) => typeof k === "string" && k.startsWith(DB_PREFIX));
  const items: MediaPoolItem[] = [];

  for (const key of mediaKeys) {
    const stored = await get<StoredMediaItem>(key);
    if (!stored) continue;
    const blob = new Blob([stored.data], { type: stored.mimeType });
    const previewUrl = URL.createObjectURL(blob);
    items.push({
      id: stored.id,
      name: stored.name,
      type: stored.type,
      duration: stored.duration,
      previewUrl,
    });
  }

  return items;
}

/** Remove a media item from IndexedDB. */
export async function removeMediaFromDB(id: string): Promise<void> {
  await del(itemKey(id));
}

/** Re-create a fresh ObjectURL for a single stored item.
 *  Returns null if the item is not found in IndexedDB. */
export async function refreshMediaUrl(id: string): Promise<string | null> {
  const stored = await get<StoredMediaItem>(itemKey(id));
  if (!stored) return null;
  const blob = new Blob([stored.data], { type: stored.mimeType });
  return URL.createObjectURL(blob);
}

/** Replace dead blob: URLs in a MediaPool array with fresh ObjectURLs from IDB.
 *  Items not found in IDB (e.g. remote URLs) are returned unchanged.
 *  Logs a debug table: [id | name | old URL | new URL | status] */
export async function hydrateMediaPool(items: MediaPoolItem[]): Promise<MediaPoolItem[]> {
  const rows: Array<{ id: string; name: string; old: string; new: string; status: string }> = [];
  const results = await Promise.all(
    items.map(async (item) => {
      if (item.previewUrl && !item.previewUrl.startsWith("blob:")) return item;
      const oldUrl = item.previewUrl || "(empty)";
      const fresh = await refreshMediaUrl(item.id);
      const status = fresh ? "✓ refreshed" : "✗ NOT IN IDB";
      rows.push({ id: item.id.slice(0, 8), name: item.name, old: oldUrl.slice(0, 48), new: (fresh ?? "").slice(0, 48), status });
      return fresh ? { ...item, previewUrl: fresh } : item;
    })
  );
  if (rows.length) console.table(rows);
  return results;
}

/** Remove all media IDs referenced by a project snapshot (call before removePost). */
export async function cleanupSnapshotMedia(mediaPool: MediaPoolItem[]): Promise<void> {
  await Promise.all(mediaPool.map((m) => removeMediaFromDB(m.id)));
}
