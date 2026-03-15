"use client";

import { usePlaybackStore } from "@/lib/store/playback-store";
import { getGridInterval } from "@/lib/utils/grid";

export function TimelineGrid() {
  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const scrollLeft = usePlaybackStore((s) => s.scrollLeft);
  const containerWidth = usePlaybackStore((s) => s.containerWidth);

  const interval = getGridInterval(pixelsPerSecond);

  // Viewport-aware: only render lines visible in the scroll window
  const startSec = Math.max(0, Math.floor(scrollLeft / pixelsPerSecond / interval) * interval);
  const endSec = (scrollLeft + containerWidth) / pixelsPerSecond + interval;

  const lines: number[] = [];
  for (let s = startSec; s <= endSec; s += interval) {
    lines.push(s);
  }

  // Major lines at 5x the interval (e.g., every 5s if interval=1, every 30s if interval=5)
  const majorInterval = interval * 5;

  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      {lines.map((sec) => {
        const isMajor = sec % majorInterval === 0 && sec > 0;
        return (
          <div
            key={sec}
            className={`absolute top-0 h-full w-px ${isMajor ? "bg-white/10" : "bg-white/5"}`}
            style={{ transform: `translate3d(${sec * pixelsPerSecond}px, 0, 0)` }}
          />
        );
      })}
    </div>
  );
}
