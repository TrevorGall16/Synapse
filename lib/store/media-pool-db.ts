// ── Persistent Media Pool via IndexedDB (idb-keyval) ─────
// Stores file ArrayBuffers so media survives page refreshes.
// On load, the file blobs are reconstructed into ObjectURLs.
// refCount: tracks how many projects/posts reference each blob —
// only hard-deletes when count reaches 0.

import { get, set, del, keys } from "idb-keyval";
import { idbSafeSet } from "./idb-safe-write";
import type { MediaPoolItem } from "./types";

interface StoredMediaItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  duration: number;
  mimeType: string;
  data: ArrayBuffer;
  refCount: number;   // number of projects/posts referencing this blob
  createdAt: number;  // unix ms — for GC age check
}

const DB_PREFIX = "synapse-media-";

// Module-level set of blob URLs created during this page session.
// hydrateMediaPool skips any item whose previewUrl is already alive here.
const sessionAliveBlobUrls = new Set<string>();

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

/** Save a file to IndexedDB alongside its metadata. Initialises refCount=1. */
export async function saveMediaToDB(file: File, item: MediaPoolItem): Promise<void> {
  const data = await file.arrayBuffer();
  const stored: StoredMediaItem = {
    id: item.id,
    name: item.name,
    type: item.type,
    duration: item.duration,
    mimeType: file.type || inferMimeType(file.name),
    data,
    refCount: 1,
    createdAt: Date.now(),
  };
  await idbSafeSet(itemKey(item.id), stored);
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
    sessionAliveBlobUrls.add(previewUrl);
    items.push({ id: stored.id, name: stored.name, type: stored.type, duration: stored.duration, previewUrl });
  }

  return items;
}

/** Remove a media item from IndexedDB unconditionally (hard delete). */
export async function removeMediaFromDB(id: string): Promise<void> {
  await del(itemKey(id));
}

/** Increment refCount by delta (default +1). Call when a project/post gains a reference. */
export async function retainMedia(id: string, delta = 1): Promise<void> {
  const stored = await get<StoredMediaItem>(itemKey(id));
  if (!stored) return;
  await idbSafeSet(itemKey(id), { ...stored, refCount: (stored.refCount ?? 1) + delta });
}

/** Decrement refCount by 1. Hard-deletes the blob when count reaches 0. */
export async function releaseMedia(id: string): Promise<void> {
  const stored = await get<StoredMediaItem>(itemKey(id));
  if (!stored) return;
  const next = (stored.refCount ?? 1) - 1;
  if (next <= 0) {
    await del(itemKey(id));
  } else {
    await idbSafeSet(itemKey(id), { ...stored, refCount: next });
  }
}

/** Safe batch release — replaces cleanupSnapshotMedia. Only hard-deletes when refCount=0. */
export async function releaseSnapshotMedia(mediaPool: MediaPoolItem[]): Promise<void> {
  await Promise.all(mediaPool.map((m) => releaseMedia(m.id)));
}

/** Return the raw stored item (includes refCount, createdAt, data). Used by GC service. */
export async function getStoredMediaItem(id: string): Promise<StoredMediaItem | undefined> {
  return get<StoredMediaItem>(itemKey(id));
}

/** Return all media IDs currently in IDB. */
export async function getAllMediaIds(): Promise<string[]> {
  const allKeys = await keys<string>();
  return allKeys
    .filter((k): k is string => typeof k === "string" && k.startsWith(DB_PREFIX))
    .map((k) => k.slice(DB_PREFIX.length));
}

/** Re-create a fresh ObjectURL for a single stored item.
 *  Returns null if the item is not found in IndexedDB. */
export async function refreshMediaUrl(id: string): Promise<string | null> {
  const stored = await get<StoredMediaItem>(itemKey(id));
  if (!stored) return null;
  const blob = new Blob([stored.data], { type: stored.mimeType });
  const url = URL.createObjectURL(blob);
  sessionAliveBlobUrls.add(url);
  return url;
}

/** Replace dead blob: URLs in a MediaPool array with fresh ObjectURLs from IDB.
 *  Items not found in IDB (e.g. remote URLs) are returned unchanged.
 *  Skips items whose previewUrl is still alive in the current page session. */
export async function hydrateMediaPool(items: MediaPoolItem[]): Promise<MediaPoolItem[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.previewUrl && !item.previewUrl.startsWith("blob:")) return item;
      // Skip if this blob URL is still alive in the current session
      if (item.previewUrl && sessionAliveBlobUrls.has(item.previewUrl)) return item;
      const fresh = await refreshMediaUrl(item.id);
      return fresh ? { ...item, previewUrl: fresh } : item;
    })
  );
}

/** @deprecated Use releaseSnapshotMedia instead — this hard-deletes without reference counting. */
export async function cleanupSnapshotMedia(mediaPool: MediaPoolItem[]): Promise<void> {
  await Promise.all(mediaPool.map((m) => removeMediaFromDB(m.id)));
}
