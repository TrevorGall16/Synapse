/**
 * lib/policy.ts — Centralised remix policy
 *
 * Single authoritative source for remix permission and routing decisions.
 * No component may define its own remix logic — all must consume this module.
 *
 * Rules:
 *  - canRemix: gate for whether the Remix button/action is permitted at all.
 *  - getRemixMode: determines which code path executes the remix.
 */

import type { FeedPost } from "./store/feed-store";

/**
 * Whether remix is permitted for a given post.
 * Defaults to true when allowRemix is absent (backward-compatible with older posts).
 */
export function canRemix(post: FeedPost): boolean {
  return post.allowRemix !== false;
}

/**
 * Which remix code path to use for a given post.
 *
 * "snapshot" — post has a full projectSnapshot; use `usePlaybackStore.loadSnapshot()`
 *              to open it in Studio with proper attribution and demo-window seeding.
 *
 * "legacy"   — post has no projectSnapshot (community/mock/preset posts); fall back
 *              to the track-flattening handleRemix path that reconstructs from videoUrl.
 */
export type RemixMode = "snapshot" | "legacy";

export function getRemixMode(post: FeedPost): RemixMode {
  return post.projectSnapshot ? "snapshot" : "legacy";
}
