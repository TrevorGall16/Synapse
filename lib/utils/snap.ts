import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";

export interface SnapResult {
  time: number;
  isHard: boolean;
}

/** Priority-based snap:
 *  #0 — end-to-start Perfect Cut (10px) → white indicator, hard snap lock
 *  #1 — user markers (12px)
 *  #2 — BPM beats, playhead, clip starts/ends (8px)
 *
 *  Returns { time, isHard } and updates the snap indicator in the playback store. */
export function snapToNearby(micros: number, pps: number, excludeClipId: string): SnapResult {
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
      // dragging clip's start snaps to another clip's end
      if (Math.abs(micros - clipEnd) < hardThreshold) {
        usePlaybackStore.getState().setSnapIndicator(clipEnd, true);
        return { time: clipEnd, isHard: true };
      }
    }
  }

  // ── Priority #1: User markers (stronger threshold) ──
  for (const marker of markers) {
    if (Math.abs(micros - marker.time) < markerThreshold) {
      usePlaybackStore.getState().setSnapIndicator(marker.time, false);
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

  const didSnap = snapped !== micros;
  usePlaybackStore.getState().setSnapIndicator(didSnap ? snapped : null, false);
  return { time: Math.round(snapped), isHard: false };
}
