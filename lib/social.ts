/**
 * Social / engagement utilities — single source of truth for:
 *   - Displayed follower counts (base + optimistic delta from user-store).
 *   - Compact vs exact follower formatting.
 *   - Engagement scores and "Hot" badge eligibility.
 *
 * Rule: no component may hardcode a "Hot" / "Trending" badge. All pages
 * compute `isHot(post, pool)` against the currently-rendered pool so the
 * badge always reflects the actual visible leaderboard.
 */

import type { FeedPost } from "@/lib/store/feed-store";

// ── Follower counts ────────────────────────────────────────────────────────────

/**
 * DisplayCount = BaseMockCount + Δ_store.
 *
 * The delta comes from `useUserStore().followerDeltas[handle]`. Pass it in
 * explicitly instead of reaching into the store so this function stays pure
 * and testable.
 */
export function getDisplayFollowerCount(baseCount: number, delta: number | undefined): number {
  return Math.max(0, baseCount + (delta ?? 0));
}

/**
 * Format a follower count either compactly ("8.4K") or exactly ("8,421").
 * Exact mode is used briefly after a follow/unfollow event for tactile feedback.
 */
export function formatFollowerCount(n: number, mode: "compact" | "exact" = "compact"): string {
  if (mode === "exact") return n.toLocaleString("en-US");
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

// ── Engagement / Hot badging ───────────────────────────────────────────────────

/**
 * Engagement score for a single post. Mirrors (likes + weighted comments).
 * Keep this cheap — it runs inside render loops against whole feed pools.
 */
export function getEngagementScore(post: FeedPost): number {
  const likes = post.likes ?? 0;
  const comments = post.comments ?? 0;
  return likes + comments * 4;
}

/**
 * Compute the top-decile engagement threshold for a pool. Posts whose
 * engagement score meets or exceeds this cut earn the "Hot" badge.
 *
 * Small pools (< 10 posts): the top 1 post qualifies.
 * Empty pools: returns Infinity so nothing is flagged.
 */
export function getHotThreshold(pool: readonly FeedPost[]): number {
  if (pool.length === 0) return Number.POSITIVE_INFINITY;
  const scores = pool.map(getEngagementScore).sort((a, b) => b - a);
  const cutIndex = Math.max(0, Math.floor(scores.length * 0.1) - 1);
  const idx = Math.min(cutIndex, scores.length - 1);
  return scores[idx];
}

/**
 * True if this post's engagement lands in the top ~10% of the supplied pool
 * (which should be the list currently rendered around it — feed grid,
 * niche grid, etc). A post with zero engagement is never hot.
 */
export function isHot(post: FeedPost, pool: readonly FeedPost[]): boolean {
  const score = getEngagementScore(post);
  if (score <= 0) return false;
  return score >= getHotThreshold(pool);
}
