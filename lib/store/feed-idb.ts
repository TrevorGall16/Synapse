// ── Feed Post IndexedDB Layer ────────────────────────────────
// Stores each FeedPost individually by ID so addPost/removePost
// touch only one record — no full-array rewrite on every change.
//
// Store: "synapse-feed-db" / "posts"

import { get, del, keys, createStore } from "idb-keyval";
import { idbSafeSet } from "./idb-safe-write";
import type { FeedPost } from "./feed-store";

const feedDb = createStore("synapse-feed-db", "posts");

/**
 * Persist one post to IDB.
 * Blob videoUrl / mediaPool previewUrls are stripped before writing —
 * they are session-only and will be re-hydrated from media-pool-db on next boot.
 */
export async function savePostToIDB(post: FeedPost): Promise<void> {
  const safePost: FeedPost = {
    ...post,
    videoUrl: post.videoUrl?.startsWith("blob:") ? undefined : post.videoUrl,
    projectSnapshot: post.projectSnapshot
      ? {
          ...post.projectSnapshot,
          mediaPool: post.projectSnapshot.mediaPool?.map((m) => ({
            ...m,
            previewUrl: m.previewUrl?.startsWith("blob:") ? "" : m.previewUrl,
          })),
        }
      : undefined,
  };
  const ok = await idbSafeSet(post.id, safePost, feedDb);
  if (!ok) {
    console.error("[FeedIDB] savePostToIDB failed — IDB write returned false for post", post.id, `"${post.title}"`);
  }
}

export async function removePostFromIDB(id: string): Promise<void> {
  await del(id, feedDb);
}

/**
 * Load all persisted posts, sorted newest-first (by createdAt).
 * Called once on boot by hydrateAllPosts before blob-URL recovery.
 */
export async function loadAllPostsFromIDB(): Promise<FeedPost[]> {
  const postKeys = await keys<string>(feedDb);
  const posts = await Promise.all(
    postKeys
      .filter((k): k is string => typeof k === "string")
      .map((k) => get<FeedPost>(k, feedDb)),
  );
  return posts
    .filter((p): p is FeedPost => !!p)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Used by the GC service to cross-reference feed media IDs. */
export async function getAllFeedPostIds(): Promise<string[]> {
  const k = await keys<string>(feedDb);
  return k.filter((v): v is string => typeof v === "string");
}
