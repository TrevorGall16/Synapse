/**
 * Centralized taxonomy — single source of truth for all niche categories and
 * global tags used across the app (home feed, niche pages, publish modal,
 * upload form, global search).
 *
 * Any page that needs a tag list or category metadata MUST import from here.
 * Hardcoded string literals for tags/categories are not allowed elsewhere.
 */

export interface NicheCategory {
  slug: string;
  label: string;
  description: string;
  /** Primary accent color for badges, borders, gradients. */
  accent: string;
  /** Card/background fill tint. */
  bg: string;
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
  "Big Tits",
  "Anal",
  "Creampie",
  "Solo",
  "Dildo",
  "Lesbian",
  "Interracial",
  "Amateur",
  "Asian",
  "Blonde",
  "Latina",
  "Ebony",
  "PAWG",
  "Shemale",
  "Curvy",
  "Feet",
  "MILF",
  "Gangbang",
  "Busty",
  "Femdom",
  "BDSM",
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

// ── Niche category metadata ────────────────────────────────────────────────────
// NICHE_CATEGORIES is derived from CHANNELS — each channel gets a slug, color,
// and short description for use on the /niche/* pages and the Explore grid.

const _CHANNEL_ACCENTS = [
  "#ec4899", "#f97316", "#a855f7", "#06b6d4", "#8b5cf6",
  "#f43f5e", "#f59e0b", "#22c55e", "#e11d48", "#fde68a",
  "#fb923c", "#d946ef", "#f43f5e", "#a3e635", "#fb7185",
  "#6366f1", "#f472b6", "#ef4444", "#ec4899", "#7c3aed", "#dc2626",
];
const _CHANNEL_BGS = [
  "#1a0818", "#1a0c06", "#160a1a", "#071a1a", "#0d0a1a",
  "#1a0810", "#1a1100", "#051a0a", "#1a050c", "#1a1a06",
  "#1a0e06", "#150a1a", "#1a0810", "#0d1a06", "#1a090d",
  "#0a0b1a", "#1a0a14", "#1a0606", "#1a0815", "#0f0a1a", "#1a0606",
];
const _CHANNEL_DESCS = [
  "Busty and voluptuous performers.",
  "Anal play and deep penetration.",
  "Internal finishes and creampies.",
  "Solo masturbation and self-play.",
  "Toy play and dildo action.",
  "Girl-on-girl heat.",
  "Interracial couples and scenes.",
  "Real amateur couples and solo.",
  "Asian performers and passion.",
  "Blonde beauties and bombshells.",
  "Latina curves and fire.",
  "Ebony queens in action.",
  "Phat ass, irresistible curves.",
  "Trans and shemale content.",
  "Full-figured, luscious bodies.",
  "Foot worship and fetish.",
  "Experienced, mature women.",
  "Group sex and multi-partner scenes.",
  "Busty, full-chested performers.",
  "Female domination and control.",
  "Bondage, discipline, and S&M.",
];

export const NICHE_CATEGORIES: readonly NicheCategory[] = CHANNELS.map((ch, i) => ({
  slug: channelSlug(ch),
  label: ch as string,
  description: _CHANNEL_DESCS[i] ?? "",
  accent: _CHANNEL_ACCENTS[i] ?? "#ec4899",
  bg: _CHANNEL_BGS[i] ?? "#1a0818",
}));

/** Lookup table by slug — e.g. "big-tits" → NicheCategory. */
export const NICHE_CATEGORY_BY_SLUG: Readonly<Record<string, NicheCategory>> =
  Object.fromEntries(NICHE_CATEGORIES.map((c) => [c.slug, c]));

export function isValidNicheCategory(v: string): boolean {
  return v in NICHE_CATEGORY_BY_SLUG;
}

/** Suggested free-form tags shown in publish/upload quick-pick rows. NOT a
 *  closed set — creators can also type custom tags. */
export const NICHE_TAGS = [
  "#BigTits",
  "#Anal",
  "#Amateur",
  "#MILF",
  "#Lesbian",
  "#Asian",
  "#PAWG",
  "#Latina",
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
