import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";

export interface SnapResult {
  time: number;
  isHard: boolean;
}

/**
 * Pure snap calculation — returns { time, isHard } with NO store side effects.
 * Use this in drag loops where the caller manages indicator updates directly.
 */
export function snapToNearbyPure(micros: number, pps: number, excludeClipId: string): SnapResult {
  const hardThreshold  = Math.round((10 / pps) * 1_000_000);
  const markerThreshold = Math.round((12 / pps) * 1_000_000);
  const softThreshold  = Math.round((8  / pps) * 1_000_000);

  const { globalBpm, playheadPosition } = usePlaybackStore.getState();
  const { markers, tracks } = useProjectStore.getState();

  // ── Priority #0: ClipA.end → ClipB.start (Perfect Cut / Hard Snap) ──
  for (const t of tracks) {
    for (const c of t.clips) {
      if (c.id === excludeClipId) continue;
      const clipEnd = c.startTime + c.duration;
      if (Math.abs(micros - clipEnd) < hardThreshold) {
        return { time: clipEnd, isHard: true };
      }
    }
  }

  // ── Priority #1: User markers (stronger threshold) ──
  for (const marker of markers) {
    if (Math.abs(micros - marker.time) < markerThreshold) {
      return { time: marker.time, isHard: false };
    }
  }

  // ── Priority #2: BPM, playhead, clip starts/ends ──
  let snapped = micros;
  let bestDist = softThreshold;

  if (globalBpm > 0) {
    const beatMicros = Math.round(60_000_000 / globalBpm);
    const nearest = Math.round(micros / beatMicros) * beatMicros;
    const d = Math.abs(micros - nearest);
    if (d < bestDist) { bestDist = d; snapped = nearest; }
  }

  const pd = Math.abs(micros - playheadPosition);
  if (pd < bestDist) { bestDist = pd; snapped = playheadPosition; }

  for (const t of tracks) {
    for (const c of t.clips) {
      if (c.id === excludeClipId) continue;
      for (const edge of [c.startTime, c.startTime + c.duration]) {
        const d = Math.abs(micros - edge);
        if (d < bestDist) { bestDist = d; snapped = edge; }
      }
    }
  }

  return { time: Math.round(snapped), isHard: snapped !== micros };
}

/** Priority-based snap with store side-effect (updates snap indicator).
 *  Use this for non-drag contexts (edge trim, etc.) where store-driven
 *  rendering is acceptable. */
export function snapToNearby(micros: number, pps: number, excludeClipId: string): SnapResult {
  const result = snapToNearbyPure(micros, pps, excludeClipId);
  const didSnap = result.time !== micros;
  usePlaybackStore.getState().setSnapIndicator(didSnap ? result.time : null, result.isHard);
  return result;
}
