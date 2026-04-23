/**
 * lib/mock-posts.ts
 *
 * Single source of truth for the mock discovery catalog used by the home feed,
 * video route, browse, and server-side metadata generation. Previously these
 * arrays were duplicated across multiple client files — extracting them here
 * enables (a) Next.js server layouts to synthesize SEO metadata without
 * pulling client-only code, and (b) lib/search-index.ts to build derived
 * indexes that scale past linear scans.
 *
 * Keep the shape identical to prior inline definitions to avoid churn in
 * consumer components that still import locally.  Once consumers migrate to
 * importing from this file, the inline copies can be deleted.
 */

import type { FeedPost } from "@/lib/store/feed-store";

/** Lowercase, strip leading '#', collapse whitespace. Used everywhere a tag is
 *  compared, indexed, or displayed. Idempotent — safe to call multiple times. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-");
}

/** Display format: always with a leading '#'. Normalizes first. */
export function formatTag(raw: string): string {
  return `#${normalizeTag(raw)}`;
}

/** Dedupe + normalize a tag list. Preserves first-seen order. */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n && !seen.has(n)) { seen.add(n); out.push(`#${n}`); }
  }
  return out;
}

// ── Static mock catalog ──────────────────────────────────────────────────────
//
// Wiped for launch — the home feed now starts clean with only user-published
// posts. The export is preserved so server layouts (video / profile) and
// search-index helpers continue to compile; helpers below return null/empty
// for any id, which surfaces the "Video not found" / "Creator not found"
// fallbacks that already existed for unknown ids.
export const MOCK_POSTS: FeedPost[] = [];

/** Look up a post by id in the static catalog — used by server layouts for
 *  metadata. Does NOT read zustand/IDB (those are client-only). */
export function findMockPostById(id: string): FeedPost | null {
  return MOCK_POSTS.find((p) => p.id === id) ?? null;
}

// ── Mock creator catalog — mirrors app/profile/[username]/page.tsx ───────────
export interface MockCreator {
  displayName: string;
  bio:         string;
  hue:         number;
  followers:   number;
  following:   number;
  postCount:   number;
  totalLikes:  number;
  remixes:     number;
}

export const CREATOR_MAP: Record<string, MockCreator> = {
  aurora_vj: {
    displayName: "Aurora VJ",
    bio:         "Techno-leaning VJ edits. Sharp cuts, hypnotic loops.",
    hue:         270,
    followers:   2847,
    following:   142,
    postCount:   18,
    totalLikes:  12_400,
    remixes:     64,
  },
};

export function findMockCreator(username: string): MockCreator | null {
  return CREATOR_MAP[username] ?? null;
}
