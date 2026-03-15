"use client";

import { usePlaybackStore } from "@/lib/store/playback-store";

const MICROS_PER_SECOND = 1_000_000;

export function Playhead() {
  const playheadPosition = usePlaybackStore((s) => s.playheadPosition);
  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const leftPx = (playheadPosition / MICROS_PER_SECOND) * pixelsPerSecond;

  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-20"
      style={{ transform: `translate3d(${leftPx}px, 0, 0)` }}
    >
      {/* Triangle head */}
      <div
        className="absolute -left-[5px] top-0 h-0 w-0"
        style={{
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "6px solid #ef4444",
        }}
      />
      {/* Vertical line */}
      <div className="h-full w-[1px] bg-red-500" />
    </div>
  );
}
