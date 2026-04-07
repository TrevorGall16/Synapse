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

// ── Scoring ──────────────────────────────────────────────────────────────────
/** Weighted relevance score for a post against a raw query.
 *  title > tags > description > creator handle. Exact > substring > fuzzy. */
export function scorePost(post: FeedPost, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase().replace(/^[@#]/, "");
  if (!q) return 0;

  let score = 0;
  const title = post.title.toLowerCase();
  const handle = post.user.handle.toLowerCase();
  const desc = (post.description ?? "").toLowerCase();

  // Title: highest weight
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 60;
  else if (title.includes(q))   score += 40;
  else if (fuzzyMatch(title, q)) score += 15;

  // Tags: second weight
  for (const t of post.tags) {
    const n = normalizeTag(t);
    if (n === q) { score += 35; break; }
    if (n.includes(q)) { score += 20; break; }
  }

  // Description: third
  if (desc.includes(q)) score += 10;
  else if (fuzzyMatch(desc, q)) score += 4;

  // Creator handle: lowest (but exact handle still meaningful)
  if (handle === q) score += 25;
  else if (handle.includes(q)) score += 8;

  // Small popularity tiebreaker so equal-relevance results favor engagement.
  score += Math.log10(post.likes + 1) * 0.5;

  return score;
}

/** Rank posts by relevance, return top N. */
export function rankPosts(posts: readonly FeedPost[], rawQuery: string, limit = 20): FeedPost[] {
  const scored: Array<{ p: FeedPost; s: number }> = [];
  for (const p of posts) {
    const s = scorePost(p, rawQuery);
    if (s > 0) scored.push({ p, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.p);
}
