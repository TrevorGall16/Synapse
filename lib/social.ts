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
 * Legacy raw engagement score (likes + 4×comments). Kept for non-Hot
 * consumers (leaderboards, etc). Hot badging uses getVelocityScore instead.
 */
export function getEngagementScore(post: FeedPost): number {
  const likes = post.likes ?? 0;
  const comments = post.comments ?? 0;
  return likes + comments * 4;
}

// Hot badging tunables ───────────────────────────────────────────────────────
/** Minimum post age before it can be "Hot". Brand-new posts with a burst of
 *  self-likes from the uploader shouldn't spike the badge. */
const HOT_MIN_AGE_MS = 30 * 60 * 1000; // 30 minutes
/** Floor denominator in hours, used so freshly-eligible posts don't divide
 *  by a tiny number and dominate purely on recency. */
const HOT_DENOM_FLOOR_H = 2;
/** Absolute minimum velocity (engagement-per-hour) for a post to be Hot at
 *  all. Prevents tiny pools from flagging any post with a single like. */
const HOT_MIN_VELOCITY = 10;

/**
 * Velocity score = engagement per hour since publication, with a floor on
 * the denominator to avoid runaway scores for posts ~minutes old.
 * Posts without createdAt (legacy/mock) get a conservative stale velocity.
 */
export function getVelocityScore(post: FeedPost, now: number = Date.now()): number {
  const engagement = getEngagementScore(post);
  if (engagement <= 0) return 0;
  if (typeof post.createdAt !== "number") {
    // Unknown age → treat as 48h old so legacy high-like mocks don't auto-Hot.
    return engagement / 48;
  }
  const ageMs = Math.max(0, now - post.createdAt);
  if (ageMs < HOT_MIN_AGE_MS) return 0; // too new to qualify
  const hours = Math.max(HOT_DENOM_FLOOR_H, ageMs / 3_600_000);
  return engagement / hours;
}

/**
 * Top-decile velocity cut for a pool. Posts whose velocity meets or exceeds
 * this AND clears HOT_MIN_VELOCITY earn Hot.
 */
export function getHotThreshold(pool: readonly FeedPost[], now: number = Date.now()): number {
  if (pool.length === 0) return Number.POSITIVE_INFINITY;
  const scores = pool.map((p) => getVelocityScore(p, now)).sort((a, b) => b - a);
  const cutIndex = Math.max(0, Math.floor(scores.length * 0.1) - 1);
  const idx = Math.min(cutIndex, scores.length - 1);
  return Math.max(scores[idx], HOT_MIN_VELOCITY);
}

/**
 * Hot = high engagement velocity relative to the current pool, not raw totals.
 * Old high-like-but-stale posts no longer glow just because they accumulated
 * likes years ago; freshly-rising posts can surface quickly.
 */
export function isHot(post: FeedPost, pool: readonly FeedPost[], now: number = Date.now()): boolean {
  const v = getVelocityScore(post, now);
  if (v < HOT_MIN_VELOCITY) return false;
  return v >= getHotThreshold(pool, now);
}
