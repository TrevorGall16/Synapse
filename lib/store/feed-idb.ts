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
 * Pure helper: strips all derived (pool-dependent, time-dependent) fields from a
 * FeedPost before it is written to IndexedDB.
 *
 * `heatTier` is computed from the pool at mutation time using `Date.now()`.
 * If persisted, a cold post could survive across sessions flagged "trending" forever.
 * Enrichment is always recomputed on hydrate (see `hydrateAllPosts`), so it is
 * safe — and correct — to omit it from the durable record.
 *
 * Exported so unit tests can assert the strip logic directly without IDB plumbing.
 */
export function stripDerivedFields(post: FeedPost): FeedPost {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { heatTier: _drop, ...rest } = post;
  return rest as FeedPost;
}

/**
 * Persist one post to IDB.
 * Blob videoUrl / mediaPool previewUrls are stripped before writing —
 * they are session-only and will be re-hydrated from media-pool-db on next boot.
 */
export async function savePostToIDB(post: FeedPost): Promise<void> {
  // Strip derived `heatTier` — pool-dependent and time-dependent (reads Date.now()).
  // If persisted, a cold post could survive across sessions flagged "trending" forever.
  // Enrichment is always recomputed on hydrate, so never persist it in the first place.
  const rest = stripDerivedFields(post);
  const safePost: FeedPost = {
    ...rest,
    videoUrl: rest.videoUrl?.startsWith("blob:") ? undefined : rest.videoUrl,
    projectSnapshot: rest.projectSnapshot
      ? {
          ...rest.projectSnapshot,
          mediaPool: rest.projectSnapshot.mediaPool?.map((m) => ({
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
