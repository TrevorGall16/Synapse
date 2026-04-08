/**
 * lib/search-index.ts
 *
 * Lightweight in-memory derived indexes + relevance scoring for the mock
 * discovery catalog. Designed so that search, browse, and tag filtering can
 * scale past linear scans over hundreds of thousands of posts.
 *
 * API contract is intentionally server-agnostic: `buildPostIndex(posts)`
 * returns plain Maps/arrays, so the same shape can be populated by a
 * server-side indexer later without changing call sites.
 *
 * Scoring weights (per spec):
 *   title > tags > description > creator name
 *
 * The index is pure: callers memoize against the source array identity.
 */

import type { FeedPost } from "@/lib/store/feed-store";
import { normalizeTag } from "@/lib/mock-posts";

// ── Tokenization ─────────────────────────────────────────────────────────────
/** Split a string into lowercase alphanumeric tokens ≥2 chars. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

// ── Index shape ──────────────────────────────────────────────────────────────
export interface PostIndex {
  /** All posts (stable reference used for ranking). */
  posts: readonly FeedPost[];
  /** normalized tag → post ids */
  byTag: Map<string, string[]>;
  /** lowercased creator handle → post ids */
  byCreator: Map<string, string[]>;
  /** token → post ids (union across title + tags + description) */
  byToken: Map<string, string[]>;
  /** id → post lookup */
  byId: Map<string, FeedPost>;
}

/** Build derived indexes. O(N · avg tokens/post). Pure. */
export function buildPostIndex(posts: readonly FeedPost[]): PostIndex {
  const byTag     = new Map<string, string[]>();
  const byCreator = new Map<string, string[]>();
  const byToken   = new Map<string, string[]>();
  const byId      = new Map<string, FeedPost>();

  const push = (m: Map<string, string[]>, k: string, id: string) => {
    const arr = m.get(k);
    if (arr) arr.push(id); else m.set(k, [id]);
  };

  for (const p of posts) {
    byId.set(p.id, p);

    for (const t of p.tags) {
      const n = normalizeTag(t);
      if (n) push(byTag, n, p.id);
    }

    const h = p.user.handle.toLowerCase();
    push(byCreator, h, p.id);

    const tokens = new Set<string>([
      ...tokenize(p.title),
      ...p.tags.flatMap((t) => tokenize(t)),
      ...(p.description ? tokenize(p.description) : []),
      ...tokenize(p.user.handle),
    ]);
    for (const tk of tokens) push(byToken, tk, p.id);
  }

  return { posts, byTag, byCreator, byToken, byId };
}

// ── Fuzzy helpers ────────────────────────────────────────────────────────────
/** Minimal Levenshtein distance, bounded at `max` for early-exit. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Two-row DP.
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // early exit
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** True if the haystack loosely matches the short needle (substring OR edit ≤1). */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  if (n.length < 4) return false; // don't fuzz on 2–3 char queries (too noisy)
  // Scan each token of the haystack and check Levenshtein ≤1.
  for (const tok of h.split(/[^a-z0-9]+/)) {
    if (!tok) continue;
    if (Math.abs(tok.length - n.length) > 1) continue;
    if (editDistance(tok, n, 1) <= 1) return true;
  }
  return false;
}

// ── Scoring — deterministic tiered ranking ───────────────────────────────────
/**
 * Relevance tiers, highest first. `rankPosts` sorts strictly by tier; the
 * tiebreak score (engagement + recency + optional follow boost) is *only*
 * consulted when two posts share the same tier. This eliminates ranking
 * ambiguity — e.g., a creator-name hit can never outrank a title substring,
 * regardless of how many likes the creator-name-hit post has.
 */
export const RELEVANCE_TIER = {
  EXACT_TITLE:    6,
  TITLE_PREFIX:   5,
  TITLE_SUBSTRING:4,
  TAG:            3,
  DESCRIPTION:    2,
  CREATOR:        1,
  NONE:           0,
} as const;
export type RelevanceTier = typeof RELEVANCE_TIER[keyof typeof RELEVANCE_TIER];

export interface ScoredPost {
  post: FeedPost;
  tier: RelevanceTier;
  tiebreak: number;
}

export type SortMode = "latest" | "popular" | "trending";

export interface ScoreOpts {
  /** Creator handles the current viewer follows — adds a tiebreak bonus only. */
  followedHandles?: ReadonlySet<string>;
  /** Enable fuzzy matching on title / description / creator for longer queries. */
  fuzzy?: boolean;
  /** Active sort mode — used STRICTLY as an intra-tier tiebreaker. Never crosses
   *  a relevance tier boundary. If two posts share the same RELEVANCE_TIER, the
   *  sort mode decides their order (latest → newest wins, popular → most likes,
   *  trending → time-decayed engagement). */
  sortMode?: SortMode;
}

/**
 * Assign a post a deterministic tier + tiebreak score for a query.
 * Returns `tier === 0` when the post does not match at all.
 *
 * Precedence (strict, tier-first):
 *   exact title > title prefix > title substring > tags > description > creator
 *
 * Tiebreak (only used within a single tier):
 *   log10(likes) + followBoost + recency-decay
 */
export function scorePost(
  post: FeedPost,
  rawQuery: string,
  opts: ScoreOpts = {},
): ScoredPost {
  const q = rawQuery.trim().toLowerCase().replace(/^[@#]/, "");
  if (!q) return { post, tier: RELEVANCE_TIER.NONE, tiebreak: 0 };

  const title  = post.title.toLowerCase();
  const handle = post.user.handle.toLowerCase();
  const desc   = (post.description ?? "").toLowerCase();
  const useFuzzy = opts.fuzzy !== false;

  // Determine the single highest-relevance tier this post qualifies for.
  let tier: RelevanceTier = RELEVANCE_TIER.NONE;

  if (title === q) {
    tier = RELEVANCE_TIER.EXACT_TITLE;
  } else if (title.startsWith(q)) {
    tier = RELEVANCE_TIER.TITLE_PREFIX;
  } else if (title.includes(q) || (useFuzzy && fuzzyMatch(title, q))) {
    tier = RELEVANCE_TIER.TITLE_SUBSTRING;
  } else if (post.tags.some((t) => {
    const n = normalizeTag(t);
    return n === q || n.includes(q) || (useFuzzy && fuzzyMatch(n, q));
  })) {
    tier = RELEVANCE_TIER.TAG;
  } else if (desc.includes(q) || (useFuzzy && fuzzyMatch(desc, q))) {
    tier = RELEVANCE_TIER.DESCRIPTION;
  } else if (handle === q || handle.includes(q) || (useFuzzy && fuzzyMatch(handle, q))) {
    tier = RELEVANCE_TIER.CREATOR;
  }

  if (tier === RELEVANCE_TIER.NONE) return { post, tier, tiebreak: 0 };

  // Tiebreak: driven by the active sortMode (latest | popular | trending) with
  // a small follow boost layered on top. The outer sort compares tiers first
  // (integer-spaced), so tiebreaks may be ANY magnitude without crossing a
  // tier boundary — we deliberately use raw (un-compressed) scales here so
  // that a 4.2k-like post decisively outranks a 3.4k-like post inside the
  // same relevance tier. Previously log10() flattened that gap from 800 to
  // ~0.09, which the follow boost could trivially overwhelm.
  const followed = opts.followedHandles && opts.followedHandles.has(post.user.handle);

  const createdAt = post.createdAt ?? 0;
  const hoursAgo = createdAt ? Math.max(1, (Date.now() - createdAt) / 3_600_000) : 48;
  const likes = post.likes;

  let tiebreak: number;
  let followBoost: number;
  switch (opts.sortMode) {
    case "latest":
      // Newest first — raw createdAt (ms) dwarfs any follow boost, which is
      // intentional: sort mode intent > follow affinity.
      tiebreak = createdAt || 0;
      // Follow boost scaled to roughly "one hour of recency" so a followed
      // creator edges out an otherwise-identical stranger but never beats a
      // genuinely newer post.
      followBoost = followed ? 3_600_000 : 0;
      break;
    case "popular":
      // RAW likes. A 4.2k post beats a 3.4k post by 800 — decisive.
      tiebreak = likes;
      // Follow boost = ~200 likes worth. Enough to break true ties (same
      // like count) but never enough to flip a meaningful engagement gap.
      followBoost = followed ? 200 : 0;
      break;
    case "trending":
      // Time-decayed raw engagement: likes / (hoursAgo+2)^1.5. Kept un-logged
      // so larger like counts dominate within the same recency bucket.
      tiebreak = likes / Math.pow(hoursAgo + 2, 1.5);
      followBoost = followed ? 5 : 0;
      break;
    default:
      // No sort mode specified — preserve previous (log-compressed) behavior.
      tiebreak = Math.log10(likes + 1) + (createdAt ? 1 / Math.pow(hoursAgo + 2, 0.5) : 0);
      followBoost = followed ? 1.0 : 0;
  }
  tiebreak += followBoost;

  return { post, tier, tiebreak };
}

/**
 * Rank posts by deterministic tier, then tiebreak. Returns top `limit`
 * matching posts in strict relevance order.
 */
export function rankPosts(
  posts: readonly FeedPost[],
  rawQuery: string,
  limit = 20,
  opts: ScoreOpts = {},
): FeedPost[] {
  const scored: ScoredPost[] = [];
  for (const p of posts) {
    const s = scorePost(p, rawQuery, opts);
    if (s.tier > 0) scored.push(s);
  }
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return b.tier - a.tier;
    return b.tiebreak - a.tiebreak;
  });
  return scored.slice(0, limit).map((x) => x.post);
}
