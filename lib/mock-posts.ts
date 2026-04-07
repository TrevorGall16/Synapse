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

// ── Static mock catalog — mirrors app/page.tsx and app/video/[id]/page.tsx ───
export const MOCK_POSTS: FeedPost[] = [
  { id: "1", user: { handle: "aurora_vj",    initial: "A", hue: 270 }, title: "Strobing Bass Drop Edit",   tags: ["#techno","#hypnotic"],    bg: "#1a0a2e", accent: "#7c3aed", duration: "0:42", likes: 2847, comments: 142, featured: true  },
  { id: "2", user: { handle: "neon_cut",     initial: "N", hue: 340 }, title: "RGB Glitch Cascade",        tags: ["#glitch","#edm"],         bg: "#1a0818", accent: "#ec4899", duration: "0:30", likes: 1923, comments: 88,  featured: false },
  { id: "3", user: { handle: "spectral_x",  initial: "S", hue: 200 }, title: "Hypno Tunnel Loop",         tags: ["#psy","#loop"],           bg: "#071a1a", accent: "#06b6d4", duration: "1:04", likes: 3410, comments: 211, featured: false },
  { id: "4", user: { handle: "hue.shift",   initial: "H", hue: 30  }, title: "Chromatic Aberration Pack", tags: ["#vfx","#bass"],           bg: "#1a1100", accent: "#f59e0b", duration: "0:55", likes: 891,  comments: 47,  featured: false },
  { id: "5", user: { handle: "deep.freq",   initial: "D", hue: 150 }, title: "Pixel Sort Waveform",       tags: ["#experimental","#lo-fi"], bg: "#051a0a", accent: "#22c55e", duration: "0:37", likes: 2104, comments: 93,  featured: false },
  { id: "6", user: { handle: "void_signal", initial: "V", hue: 0   }, title: "Infrared Strobe Cut",       tags: ["#industrial","#harsh"],   bg: "#1a0500", accent: "#ef4444", duration: "0:28", likes: 1650, comments: 72,  featured: false },
  { id: "7", user: { handle: "prismatic",   initial: "P", hue: 300 }, title: "Kaleidoscope Crossfade",    tags: ["#ambient","#visual"],     bg: "#160a1a", accent: "#a855f7", duration: "2:10", likes: 4201, comments: 317, featured: true  },
  { id: "8", user: { handle: "lo.form",     initial: "L", hue: 185 }, title: "Scan Line Retro Mix",       tags: ["#retrowave","#vhs"],      bg: "#071018", accent: "#38bdf8", duration: "1:20", likes: 1389, comments: 61,  featured: false },
  { id: "9", user: { handle: "bpmviz",      initial: "B", hue: 45  }, title: "Beat-Sync Flash Grid",      tags: ["#dnb","#reactive"],       bg: "#180e00", accent: "#fb923c", duration: "0:48", likes: 3027, comments: 184, featured: false },
];

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
  aurora_vj:   { displayName: "Aurora VJ",   bio: "Strobing visuals & hypnotic loops.",             hue: 270, followers: 8420,  following: 312, postCount: 47, totalLikes: 2600, remixes: 12 },
  neon_cut:    { displayName: "Neon Cut",    bio: "RGB splits and glitch art. EDM edit machine.",   hue: 340, followers: 5130,  following: 198, postCount: 31, totalLikes: 1400, remixes: 8  },
  spectral_x:  { displayName: "Spectral X",  bio: "Psy visuals, tunnel loops, trippy transitions.", hue: 200, followers: 11200, following: 427, postCount: 63, totalLikes: 4800, remixes: 21 },
  "hue.shift": { displayName: "Hue Shift",   bio: "Chromatic aberration and VFX packs.",            hue: 30,  followers: 2980,  following: 155, postCount: 18, totalLikes: 690,  remixes: 4  },
  "deep.freq": { displayName: "Deep Freq",   bio: "Pixel sorting, lo-fi, experimental cuts.",       hue: 150, followers: 6740,  following: 281, postCount: 39, totalLikes: 2100, remixes: 11 },
  void_signal: { displayName: "Void Signal", bio: "Industrial noise, infrared palette.",            hue: 0,   followers: 4890,  following: 167, postCount: 28, totalLikes: 1350, remixes: 6  },
  prismatic:   { displayName: "Prismatic",   bio: "Kaleidoscope edits, ambient crossfades.",        hue: 300, followers: 14300, following: 503, postCount: 82, totalLikes: 7800, remixes: 31 },
  "lo.form":   { displayName: "Lo Form",     bio: "Retrowave, VHS grain, scan-line aesthetics.",    hue: 185, followers: 3720,  following: 224, postCount: 22, totalLikes: 930,  remixes: 5  },
  bpmviz:      { displayName: "BPM Viz",     bio: "Beat-synced flash grids. DnB reactive visuals.", hue: 45,  followers: 9160,  following: 390, postCount: 54, totalLikes: 3650, remixes: 17 },
};

export function findMockCreator(username: string): MockCreator | null {
  return CREATOR_MAP[username] ?? null;
}
