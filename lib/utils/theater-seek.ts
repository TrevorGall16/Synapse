import type { ClipEvent } from "@/lib/store/types";

/**
 * Theater seek / playback-coord conversions.
 *
 * LOCK: Theater seek parity (paused vs playing).
 *
 * A single source of truth so the playbar computes *identical* results in both
 * states — the old inline math in TheaterPlayer.tsx was drifting because tick
 * was overwriting `phRef` from `v.currentTime` (media space) while the loop
 * bounds and seek target were authored in timeline space. For clips with
 * `mediaOffset > 0` (Ruler Selection publishes), that conflation reset the
 * playhead to 0:00 every tick.
 */

export interface ClipWithUrl extends ClipEvent {
  url: string;
}

export interface SeekTarget {
  /** Target in TIMELINE microseconds. Always within [demoStartUs, demoStartUs+demoDurUs). */
  timelineUs: number;
  /** Target in MEDIA seconds for the active clip. */
  mediaSec: number;
  /** 0..1 — how far along the demo window the pointer is. */
  ratio: number;
  /** The clip that contains `timelineUs`, or null if the pointer lands in a gap. */
  targetClip: ClipWithUrl | null;
}

export interface Rectish {
  left: number;
  width: number;
}

/**
 * Pure seek-target math. Identical output regardless of play/pause state —
 * any branching on `isPlaying` would be a parity bug.
 */
export function computeSeekTarget(
  clientX: number,
  rect: Rectish,
  demoStartUs: number,
  demoDurUs: number,
  clips: readonly ClipWithUrl[],
): SeekTarget | null {
  if (rect.width <= 0 || demoDurUs <= 0) return null;
  const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
  const ratio = x / rect.width;
  const timelineUs = Math.round(demoStartUs + ratio * demoDurUs);

  const targetClip = clips.find(
    (c) => timelineUs >= c.startTime && timelineUs < c.startTime + c.duration,
  ) ?? null;

  const mediaSec = targetClip
    ? (timelineUs - targetClip.startTime + (targetClip.mediaOffset ?? 0)) / 1_000_000
    : 0;

  return { timelineUs, mediaSec, ratio, targetClip };
}

/**
 * Convert media-space `v.currentTime` (seconds) to TIMELINE microseconds using
 * the active clip's offset. This is how the tick's loop-window check must
 * interpret the video element — ignoring `mediaOffset` was the root cause of
 * the 0:00 reset regression.
 */
export function timelineUsFromMedia(activeClip: ClipEvent | null | undefined, mediaCurrentSec: number): number {
  if (!activeClip) return Math.round(mediaCurrentSec * 1_000_000);
  const mediaUs = Math.round(mediaCurrentSec * 1_000_000);
  return activeClip.startTime + (mediaUs - (activeClip.mediaOffset ?? 0));
}

/**
 * Inverse of `timelineUsFromMedia` — given a desired timeline position, what
 * `v.currentTime` should the active clip seek to? Used for loop-window reset.
 */
export function mediaSecFromTimeline(activeClip: ClipEvent | null | undefined, timelineUs: number): number {
  if (!activeClip) return Math.max(0, timelineUs / 1_000_000);
  const mediaUs = timelineUs - activeClip.startTime + (activeClip.mediaOffset ?? 0);
  return Math.max(0, mediaUs / 1_000_000);
}

/** True if `timelineUs` is outside the demo window (triggers a loop reset). */
export function isOutsideDemoWindow(
  timelineUs: number,
  demoStartUs: number,
  demoDurUs: number,
  trailingSlackUs = 50_000,
): boolean {
  const endUs = demoStartUs + demoDurUs;
  return timelineUs < demoStartUs || timelineUs >= endUs - trailingSlackUs;
}
