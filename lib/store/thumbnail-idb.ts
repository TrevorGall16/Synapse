// ── Post Thumbnail IndexedDB Layer ────────────────────────────
// Durable static thumbnails for feed posts. One Blob per post,
// keyed by post.id. Survives refresh + session blob URL churn.
//
// Store: "synapse-thumbnail-db" / "thumbs"
//
// Write path:  extractThumbnail(videoUrl) → Blob → saveThumbnail(id, blob)
// Read path:   loadThumbnailUrl(id) → "blob:..." ObjectURL (cached in memory)

import { get, set, del, keys, createStore } from "idb-keyval";

const thumbDb = createStore("synapse-thumbnail-db", "thumbs");

// Cache of ObjectURLs we created this session, keyed by post id.
// Prevents leaks + redundant createObjectURL calls on repeated reads.
const sessionThumbUrls = new Map<string, string>();

/** Persist a thumbnail Blob for a post. Overwrites any existing thumb. */
export async function saveThumbnail(postId: string, blob: Blob): Promise<void> {
  try {
    await set(postId, blob, thumbDb);
    // Invalidate the cached URL — on next load we'll createObjectURL from the
    // fresh Blob, not the stale one.
    const existing = sessionThumbUrls.get(postId);
    if (existing) {
      URL.revokeObjectURL(existing);
      sessionThumbUrls.delete(postId);
    }
  } catch (err) {
    console.warn("[ThumbIDB] saveThumbnail failed for", postId, err);
  }
}

/** Load the thumbnail Blob for a post, or null if none persisted. */
export async function getThumbnailBlob(postId: string): Promise<Blob | null> {
  try {
    const blob = await get<Blob>(postId, thumbDb);
    return blob ?? null;
  } catch {
    return null;
  }
}

/** Load the thumbnail as an ObjectURL suitable for <img src> or <video> poster.
 *  Returns null if no thumb is persisted. Cached per-session so repeated calls
 *  don't leak URLs. Callers do NOT revoke — the cache owns the URL lifetime. */
export async function loadThumbnailUrl(postId: string): Promise<string | null> {
  const cached = sessionThumbUrls.get(postId);
  if (cached) return cached;

  const blob = await getThumbnailBlob(postId);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  sessionThumbUrls.set(postId, url);
  return url;
}

/** Remove a thumbnail (called when its post is deleted). */
export async function removeThumbnail(postId: string): Promise<void> {
  try {
    await del(postId, thumbDb);
  } catch {
    // Non-critical
  }
  const cached = sessionThumbUrls.get(postId);
  if (cached) {
    URL.revokeObjectURL(cached);
    sessionThumbUrls.delete(postId);
  }
}

/** Return all persisted thumb IDs — used by GC to cross-reference posts. */
export async function getAllThumbnailIds(): Promise<string[]> {
  try {
    const ks = await keys<string>(thumbDb);
    return ks.filter((k): k is string => typeof k === "string");
  } catch {
    return [];
  }
}
