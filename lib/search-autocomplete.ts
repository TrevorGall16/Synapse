/**
 * lib/search-autocomplete.ts
 *
 * Pure helper for the GlobalSearch autocomplete dropdown. Returns up to 8
 * channel names + up to 8 creator handles for a raw query string. Ranked
 * per the design spec:
 *
 *   exact > prefix > substring  (case-insensitive, leading @/# stripped)
 *
 * Decoupled from React so it can be unit-tested under vitest without a DOM.
 */

import type { FeedPost } from "@/lib/store/feed-store";
import { CHANNELS, type Channel } from "@/lib/config/taxonomy";

const CAP = 8;

export interface AutocompleteSuggestions {
  channels: Channel[];
  creators: string[];
}

type Tier = 0 | 1 | 2 | 3;
// 3 = exact, 2 = prefix, 1 = substring, 0 = no match.
function tierOf(candidate: string, needle: string): Tier {
  const c = candidate.toLowerCase();
  if (c === needle) return 3;
  if (c.startsWith(needle)) return 2;
  if (c.includes(needle)) return 1;
  return 0;
}

function rankByTier<T>(items: readonly T[], key: (v: T) => string, needle: string): T[] {
  const scored: Array<{ item: T; tier: Tier; idx: number }> = [];
  items.forEach((item, idx) => {
    const t = tierOf(key(item), needle);
    if (t > 0) scored.push({ item, tier: t, idx });
  });
  // Higher tier first; stable tiebreak by original index.
  scored.sort((a, b) => (b.tier - a.tier) || (a.idx - b.idx));
  return scored.slice(0, CAP).map((x) => x.item);
}

/**
 * Build channel + creator suggestions for the autocomplete dropdown.
 * Empty / whitespace-only query returns empty sections.
 */
export function buildAutocompleteSuggestions(
  posts: readonly FeedPost[],
  rawQuery: string,
): AutocompleteSuggestions {
  const needle = rawQuery.trim().toLowerCase().replace(/^[@#]/, "");
  if (!needle) return { channels: [], creators: [] };

  const channels = rankByTier<Channel>(CHANNELS, (c) => c, needle);

  // Dedup creator handles across posts, preserving first-seen order for a
  // stable tiebreak. Matches `buildPostIndex.byCreator`'s behavior but we
  // don't pull in the full index — the helper owns its own small pipeline.
  const seen = new Set<string>();
  const uniqueHandles: string[] = [];
  for (const p of posts) {
    const h = p.user.handle.toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    uniqueHandles.push(h);
  }
  const creators = rankByTier<string>(uniqueHandles, (h) => h, needle);

  return { channels, creators };
}
