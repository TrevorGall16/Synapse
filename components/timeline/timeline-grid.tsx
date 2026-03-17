"use client";

import { usePlaybackStore } from "@/lib/store/playback-store";
import { getGridInterval } from "@/lib/utils/grid";

export function TimelineGrid() {
  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const scrollLeft = usePlaybackStore((s) => s.scrollLeft);
  const containerWidth = usePlaybackStore((s) => s.containerWidth);
  const globalBpm = usePlaybackStore((s) => s.globalBpm);

  const interval = getGridInterval(pixelsPerSecond);

  // Viewport-aware: only render lines visible in the scroll window
  const startSec = Math.max(0, Math.floor(scrollLeft / pixelsPerSecond / interval) * interval);
  const endSec = (scrollLeft + containerWidth) / pixelsPerSecond + interval;

  const lines: number[] = [];
  for (let s = startSec; s <= endSec; s += interval) {
    lines.push(s);
  }

  // Major lines at 5x the interval
  const majorInterval = interval * 5;

  // BPM beat lines (only if BPM > 0 and zoom is high enough)
  const beatLines: number[] = [];
  if (globalBpm > 0) {
    const beatSec = 60 / globalBpm;
    // Only show BPM lines when they're at least 8px apart
    if (beatSec * pixelsPerSecond >= 8) {
      const beatStart = Math.max(0, Math.floor(scrollLeft / pixelsPerSecond / beatSec) * beatSec);
      const beatEnd = endSec;
      for (let b = beatStart; b <= beatEnd; b += beatSec) {
        beatLines.push(b);
      }
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-0">
      {lines.map((sec) => {
        const isMajor = sec % majorInterval === 0 && sec > 0;
        return (
          <div
            key={`g-${sec}`}
            className={`absolute top-0 h-full w-px ${isMajor ? "bg-white/10" : "bg-white/5"}`}
            style={{ transform: `translate3d(${sec * pixelsPerSecond}px, 0, 0)` }}
          />
        );
      })}
      {beatLines.map((sec) => (
        <div
          key={`b-${sec}`}
          className="absolute top-0 h-full w-px bg-purple-400/15"
          style={{ transform: `translate3d(${sec * pixelsPerSecond}px, 0, 0)` }}
        />
      ))}
    </div>
  );
}
