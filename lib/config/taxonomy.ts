/**
 * Centralized taxonomy — single source of truth for all niche categories and
 * global tags used across the app (home feed, niche pages, publish modal,
 * upload form, global search).
 *
 * Any page that needs a tag list or category metadata MUST import from here.
 * Hardcoded string literals for tags/categories are not allowed elsewhere.
 */

/** Valid niche category slugs — matches FeedPostSchema.category enum. */
export const NICHE_CATEGORY_SLUGS = [
  "high-sensation",
  "aesthetic",
  "cinematic",
  "glitch",
  "slow-mo",
] as const;

export type NicheCategorySlug = (typeof NICHE_CATEGORY_SLUGS)[number];

export interface NicheCategory {
  slug: NicheCategorySlug;
  label: string;
  description: string;
  /** Primary accent color for badges, borders, gradients. */
  accent: string;
  /** Card/background fill tint. */
  bg: string;
  /** Hashtag aliases used when matching feed posts to this category. */
  tagAliases: readonly string[];
}

export const NICHE_CATEGORIES: readonly NicheCategory[] = [
  { slug: "high-sensation", label: "High Sensation", description: "Strobing, rapid-cut, beat-synced intensity.", accent: "#ec4899", bg: "#1a0818", tagAliases: ["#HighSensation", "#highsensation"] },
  { slug: "aesthetic",      label: "Aesthetic",       description: "Dreamy palettes, soft grading, lo-fi vibes.", accent: "#a855f7", bg: "#160a1a", tagAliases: ["#Aesthetic", "#aesthetic"] },
  { slug: "cinematic",      label: "Cinematic",       description: "Wide aspect, film grain, color science.",    accent: "#06b6d4", bg: "#071a1a", tagAliases: ["#Cinematic", "#cinematic"] },
  { slug: "glitch",         label: "Glitch",          description: "Data-bent, pixel-sorted, RGB split chaos.",  accent: "#22c55e", bg: "#051a0a", tagAliases: ["#Glitch", "#glitch"] },
  { slug: "slow-mo",        label: "Slow Mo",         description: "Time-stretch, optical flow, high-fps glass.",accent: "#f59e0b", bg: "#1a1100", tagAliases: ["#SlowMo", "#slowmo", "#slow-mo"] },
] as const;

/** Lookup table by slug. */
export const NICHE_CATEGORY_BY_SLUG: Readonly<Record<NicheCategorySlug, NicheCategory>> =
  Object.fromEntries(NICHE_CATEGORIES.map((c) => [c.slug, c])) as Record<NicheCategorySlug, NicheCategory>;

export function isValidNicheCategory(v: string): v is NicheCategorySlug {
  return (NICHE_CATEGORY_SLUGS as readonly string[]).includes(v);
}

// ── Channels vs Tags ─────────────────────────────────────────────────────────
//
// CHANNELS are a fixed, curated list of top-level buckets. They back the
// Channel filter pills on the Discovery feed, the channel pages, and the
// publish/upload category picker. Clicking a channel navigates to its
// channel filter view.
//
// TAGS are free-form, per-video keywords. Clicking a tag runs a global
// search for that keyword. Tags are NOT constrained to this list — anything
// a creator types becomes a tag. The `NICHE_TAGS` array below is only the
// "suggested / quick-pick" row shown in UI affordances.

/** Fixed controlled channel list — identical across upload, feed, search. */
export const CHANNELS = [
  "Blonde",
  "Brunette",
  "Big Tits",
  "Creampie",
  "Anal",
  "Gangbang",
  "Solo",
  "Dildo",
] as const;

export type Channel = (typeof CHANNELS)[number];

const CHANNEL_SET = new Set<string>(CHANNELS.map((c) => c.toLowerCase()));

/** True if a string (with or without `#`) matches a fixed channel. */
export function isChannel(raw: string): raw is Channel {
  const trimmed = raw.trim().replace(/^#+/, "").toLowerCase();
  return CHANNEL_SET.has(trimmed);
}

/** URL-safe slug for a channel (spaces → "-", lowercased). */
export function channelSlug(channel: Channel): string {
  return channel.toLowerCase().replace(/\s+/g, "-");
}

/** Suggested free-form tags shown in publish/upload quick-pick rows. NOT a
 *  closed set — creators can also type custom tags. */
export const NICHE_TAGS = [
  "#HighSensation",
  "#Cinematic",
  "#Glitch",
  "#SlowMo",
  "#Aesthetic",
  "#Curvy",
  "#Latex",
] as const;

export type NicheTag = (typeof NICHE_TAGS)[number];

/** Normalize a raw user-entered tag ("blonde" / "Blonde" / "#blonde") → "#Blonde". */
export function normalizeTag(raw: string): string {
  const trimmed = raw.trim().replace(/^#+/, "");
  if (!trimmed) return "";
  const lower = `#${trimmed.toLowerCase()}`;
  const canonicalSuggested = NICHE_TAGS.find((t) => t.toLowerCase() === lower);
  if (canonicalSuggested) return canonicalSuggested;
  const canonicalChannel = CHANNELS.find((c) => `#${c.toLowerCase()}` === lower);
  if (canonicalChannel) return `#${canonicalChannel}`;
  return `#${trimmed}`;
}

/** True if a tag is a known suggestion (channel or quick-pick). Free-form
 *  tags return false — that's fine, tags are open-set by design. */
export function isValidTag(tag: string): boolean {
  const lower = tag.trim().replace(/^#+/, "").toLowerCase();
  if (CHANNEL_SET.has(lower)) return true;
  return NICHE_TAGS.some((t) => t.slice(1).toLowerCase() === lower);
}
