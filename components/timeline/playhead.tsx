"use client";

import { usePlaybackStore } from "@/lib/store/playback-store";
import { QA_LABELS_ENABLED } from "@/lib/dev/qa-labels";

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
      {/* QA zone tag — emitted only when QA_LABELS_ENABLED is true. Anchored
          beside the triangle so the badge tracks the playhead as it scrubs. */}
      {QA_LABELS_ENABLED && (
        <span
          className="pointer-events-none absolute left-1.5 top-0 z-50 bg-red-500 text-white text-[10px] font-mono px-1"
          aria-hidden
        >
          PLAYHEAD
        </span>
      )}
    </div>
  );
}
