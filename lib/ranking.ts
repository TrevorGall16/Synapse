/**
 * Ranking — Reddit-style time-windowed sorts for Discovery feed.
 *
 * Time windows filter the candidate pool BEFORE scoring so that short windows
 * (Today/Week) cannot be dominated by old all-time-winner posts.
 *
 * Popular  = raw likes within the window.
 * Trending = time-decay score within the window:  likes / (hoursOld + 2)^1.5
 */

import type { FeedPost } from "@/lib/store/feed-store";

export type TimeWindow = "today" | "week" | "month" | "year" | "all";

export const TIME_WINDOWS: readonly TimeWindow[] = ["today", "week", "month", "year", "all"] as const;

export const TIME_WINDOW_LABEL: Record<TimeWindow, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
  year: "Year",
  all: "All Time",
};

/** Default window per sort mode — see task spec. */
export const DEFAULT_WINDOW_FOR_SORT: Record<"trending" | "popular" | "latest", TimeWindow> = {
  trending: "week",
  popular: "all",
  latest: "all",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const WINDOW_MS: Record<TimeWindow, number> = {
  today: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
  all: Number.POSITIVE_INFINITY,
};

/** True if post.createdAt falls within the requested window (now-relative). */
export function isInWindow(post: FeedPost, window: TimeWindow, now: number = Date.now()): boolean {
  if (window === "all") return true;
  // Posts without createdAt are treated as mock/seed content: visible only in
  // "all". Short windows hide them so stale seeds don't crowd fresh uploads.
  if (typeof post.createdAt !== "number") return false;
  return now - post.createdAt <= WINDOW_MS[window];
}

/** Apply time-window filter to a pool. */
export function filterByWindow(posts: readonly FeedPost[], window: TimeWindow, now: number = Date.now()): FeedPost[] {
  if (window === "all") return [...posts];
  return posts.filter((p) => isInWindow(p, window, now));
}

/** Trending decay score: likes / (hoursOld + 2)^1.5. */
export function trendingScore(post: FeedPost, now: number = Date.now()): number {
  const likes = post.likes ?? 0;
  const ageMs = typeof post.createdAt === "number" ? Math.max(0, now - post.createdAt) : 48 * HOUR_MS;
  const hoursOld = ageMs / HOUR_MS;
  return likes / Math.pow(hoursOld + 2, 1.5);
}

/**
 * Sort a post pool by the requested mode within the requested window.
 * `likeBoostIds` lets callers add +1 to optimistic user-liked posts so the
 * UI reflects the tap before the store rehydrates.
 */
export function rankByWindow(
  posts: readonly FeedPost[],
  mode: "latest" | "popular" | "trending",
  window: TimeWindow,
  opts: { likeBoostIds?: readonly string[]; now?: number } = {},
): FeedPost[] {
  const now = opts.now ?? Date.now();
  const boost = new Set(opts.likeBoostIds ?? []);
  const boosted = (p: FeedPost) => (p.likes ?? 0) + (boost.has(p.id) ? 1 : 0);

  const pool = filterByWindow(posts, window, now);

  if (mode === "latest") {
    return pool.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
  if (mode === "popular") {
    return pool.sort((a, b) => boosted(b) - boosted(a));
  }
  // trending — decay-scored using boosted like counts
  return pool.sort((a, b) => {
    const withBoost = (p: FeedPost) => {
      const base = trendingScore(p, now);
      if (!boost.has(p.id)) return base;
      const ageMs = typeof p.createdAt === "number" ? Math.max(0, now - p.createdAt) : 48 * HOUR_MS;
      return base + 1 / Math.pow(ageMs / HOUR_MS + 2, 1.5);
    };
    return withBoost(b) - withBoost(a);
  });
}
