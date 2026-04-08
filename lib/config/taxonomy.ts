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

/**
 * Global niche tags used for filtering, publishing, and search. These are the
 * canonical user-facing hashtags. Order is intentional — used as the default
 * display order for pill rows / quick-picks.
 */
export const NICHE_TAGS = [
  "#Blonde",
  "#Brunette",
  "#Curvy",
  "#Latex",
  "#HighSensation",
  "#Cinematic",
  "#Glitch",
  "#SlowMo",
  "#Aesthetic",
] as const;

export type NicheTag = (typeof NICHE_TAGS)[number];

const NICHE_TAG_SET = new Set<string>(NICHE_TAGS.map((t) => t.toLowerCase()));

/** Normalize a raw user-entered tag ("blonde" / "Blonde" / "#blonde") → "#Blonde". */
export function normalizeTag(raw: string): string {
  const trimmed = raw.trim().replace(/^#+/, "");
  if (!trimmed) return "";
  const lower = `#${trimmed.toLowerCase()}`;
  const canonical = NICHE_TAGS.find((t) => t.toLowerCase() === lower);
  return canonical ?? `#${trimmed}`;
}

/** True if this tag is part of the global taxonomy. */
export function isValidTag(tag: string): boolean {
  return NICHE_TAG_SET.has(tag.trim().toLowerCase());
}
