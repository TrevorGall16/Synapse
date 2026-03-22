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
 *  Items not found in IDB (e.g. remote URLs) are returned unchanged. */
export async function hydrateMediaPool(items: MediaPoolItem[]): Promise<MediaPoolItem[]> {
  return Promise.all(
    items.map(async (item) => {
      // Skip only if URL is clearly valid and not a blob (e.g. https://...)
      // Empty string ("") and blob: URLs both need refreshing from IDB
      if (item.previewUrl && !item.previewUrl.startsWith("blob:")) return item;
      const fresh = await refreshMediaUrl(item.id);
      if (fresh) console.log(`IDB Recovery Success: ${item.name} (${item.id.slice(0, 8)})`);
      return fresh ? { ...item, previewUrl: fresh } : item;
    })
  );
}

/** Remove all media IDs referenced by a project snapshot (call before removePost). */
export async function cleanupSnapshotMedia(mediaPool: MediaPoolItem[]): Promise<void> {
  await Promise.all(mediaPool.map((m) => removeMediaFromDB(m.id)));
}
