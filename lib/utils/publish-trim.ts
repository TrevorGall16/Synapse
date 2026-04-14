import type { Track, ClipEvent } from "@/lib/store/types";

/**
 * Rebase and trim clips to a publish selection window [selOffset, selOffset+duration)
 * (all values in MICROSECONDS on the project timeline).
 *
 * Clips that straddle the selection boundary must have `mediaOffset` advanced
 * (head trim) or `duration` shrunk (tail trim) so the published snapshot plays
 * only the portion that was visible under the ruler selection. Without this,
 * the snapshot plays the full source clip shifted in time ("time slip").
 */
export function trimClipsToSelection<T extends ClipEvent>(
  clip: T,
  selOffset: number,
  selDuration: number,
): T {
  const selEnd = selOffset + selDuration;
  const headTrim = Math.max(0, selOffset - clip.startTime);
  const tailTrim = Math.max(0, (clip.startTime + clip.duration) - selEnd);
  const newDuration = clip.duration - headTrim - tailTrim;
  return {
    ...clip,
    startTime: Math.max(0, clip.startTime - selOffset),
    mediaOffset: (clip.mediaOffset ?? 0) + headTrim,
    duration: newDuration,
  };
}

export function trimTracksToSelection(
  tracks: Track[],
  selOffset: number,
  selDuration: number,
): Track[] {
  if (selOffset === 0 && selDuration <= 0) return tracks;
  const selEnd = selOffset + selDuration;
  return tracks.map((t) => ({
    ...t,
    clips: t.clips
      .filter((c) => c.startTime < selEnd && c.startTime + c.duration > selOffset)
      .map((c) => trimClipsToSelection(c, selOffset, selDuration))
      .filter((c) => c.duration > 0),
  }));
}
