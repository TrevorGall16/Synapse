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
    mimeType: file.type || "application/octet-stream",
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
