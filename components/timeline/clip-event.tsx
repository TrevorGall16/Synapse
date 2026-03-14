"use client";

import type { ClipEvent } from "@/lib/store/types";
import { useProjectStore } from "@/lib/store/project-store";

interface ClipEventBlockProps {
  clip: ClipEvent;
  pixelsPerSecond: number;
  trackColor: string;
}

export function ClipEventBlock({ clip, pixelsPerSecond, trackColor }: ClipEventBlockProps) {
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const media = mediaPool.find((m) => m.id === clip.sourceId);
  const label = media?.name ?? clip.sourceId;

  const xPx = (clip.startTime / 1_000_000) * pixelsPerSecond;
  const wPx = (clip.duration / 1_000_000) * pixelsPerSecond;

  return (
    <div
      className="absolute top-0 flex h-full items-center overflow-hidden rounded px-1.5"
      style={{
        transform: `translate3d(${xPx}px, 0, 0)`,
        width: wPx,
        backgroundColor: trackColor + "40",
        borderLeft: `2px solid ${trackColor}`,
      }}
    >
      <span className="truncate text-[10px] font-medium text-white/70">
        {label}
      </span>
    </div>
  );
}
