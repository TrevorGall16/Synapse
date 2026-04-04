"use client";

import { usePlaybackStore } from "@/lib/store/playback-store";

/** Vertical guide line while a clip is snapping.
 *  White with white glow = Perfect Cut (end-to-start, hard snap).
 *  Cyan with cyan glow  = crossfade / soft snap.
 *
 *  Always renders a DOM element (display:none when inactive) so that the
 *  clip drag handler can update it via direct DOM writes for lockstep
 *  rendering with the dragged clip. */
export function SnapIndicator() {
  const snapMicros    = usePlaybackStore((s) => s.snapIndicatorMicros);
  const pps           = usePlaybackStore((s) => s.pixelsPerSecond);
  const snapIsHardCut = usePlaybackStore((s) => s.snapIsHardCut);

  const visible = snapMicros !== null;
  const xPx = visible ? (snapMicros / 1_000_000) * pps : 0;

  const color  = snapIsHardCut ? "rgba(255,255,255,0.95)" : "rgba(0,229,255,0.85)";
  const shadow = snapIsHardCut
    ? "0 0 6px 2px rgba(255,255,255,0.6)"
    : "0 0 6px 1px rgba(0,229,255,0.5)";

  return (
    <div
      data-snap-indicator
      className="pointer-events-none absolute top-0 z-20 w-px"
      style={{
        left: xPx,
        height: "100%",
        background: color,
        boxShadow: shadow,
        display: visible ? "block" : "none",
      }}
    />
  );
}
