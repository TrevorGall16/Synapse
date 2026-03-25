import type { FeedPost } from "./store/feed-store";
import type { ClipEvent } from "./store/types";

// ── Public types ──────────────────────────────────────────────────────────────
export interface TrendingTag     { tag: string;        count: number }
export interface TrendingEffect  { effectType: string; count: number }
export interface TrendingCreator {
  handle: string; initial: string; hue: number;
  postCount: number; totalLikes: number;
}
export interface TrendingData {
  tags:     TrendingTag[];
  effects:  TrendingEffect[];
  creators: TrendingCreator[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function inc(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function top5<T>(map: Map<string, number>, toObj: (key: string, count: number) => T): T[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => toObj(k, v));
}

function collectEffectsFromClip(clip: ClipEvent, effectMap: Map<string, number>) {
  const et = String(clip.fxParams?.effectType ?? "");
  if (et && et !== "none") inc(effectMap, et);
  for (const embedded of clip.embeddedEffectClips ?? []) {
    collectEffectsFromClip(embedded, effectMap);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
/** Aggregate tag usage, effect type usage, and creator metrics from a post array.
 *  Safe to call with an empty array — returns empty top-5 lists.
 */
export function getTrendingData(posts: FeedPost[]): TrendingData {
  const tagMap    = new Map<string, number>();
  const effectMap = new Map<string, number>();
  const creatorMap = new Map<string, TrendingCreator>();

  for (const post of posts) {
    // ── Tags ────────────────────────────────────────────────────────────────
    for (const tag of post.tags) inc(tagMap, tag);

    // ── Effects ─────────────────────────────────────────────────────────────
    const snap = post.projectSnapshot;
    if (snap) {
      for (const track of snap.tracks) {
        for (const clip of track.clips) {
          if (track.type === "effect") {
            collectEffectsFromClip(clip, effectMap);
          } else if (track.type === "video") {
            for (const efx of clip.embeddedEffectClips ?? []) {
              collectEffectsFromClip(efx, effectMap);
            }
          }
        }
      }
    }

    // ── Creators ─────────────────────────────────────────────────────────────
    const { handle, initial, hue } = post.user;
    const prev = creatorMap.get(handle) ?? { handle, initial, hue, postCount: 0, totalLikes: 0 };
    creatorMap.set(handle, { ...prev, postCount: prev.postCount + 1, totalLikes: prev.totalLikes + post.likes });
  }

  return {
    tags:     top5(tagMap,    (tag,        count) => ({ tag, count })),
    effects:  top5(effectMap, (effectType, count) => ({ effectType, count })),
    creators: [...creatorMap.values()].sort((a, b) => b.totalLikes - a.totalLikes).slice(0, 5),
  };
}
