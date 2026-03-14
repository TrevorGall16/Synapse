"use client";

import { useRef, useCallback, type RefObject } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";

function formatTimecode(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

interface TimelineRulerProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function TimelineRuler({ scrollContainerRef }: TimelineRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const duration = useProjectStore((s) => s.duration);
  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);

  const pixelsPerSecond = 100 * zoomLevel;
  const totalWidth = (duration / 1_000_000) * pixelsPerSecond;

  // Dynamic tick interval based on zoom
  const tickInterval = getTickInterval(pixelsPerSecond);
  const totalSeconds = duration / 1_000_000;

  // Visible ticks only
  const container = scrollContainerRef.current;
  const scrollLeft = container?.scrollLeft ?? 0;
  const viewWidth = container?.clientWidth ?? totalWidth;
  const startSec = Math.max(0, Math.floor(scrollLeft / pixelsPerSecond / tickInterval) * tickInterval);
  const endSec = Math.min(totalSeconds, (scrollLeft + viewWidth) / pixelsPerSecond + tickInterval);

  const ticks: number[] = [];
  for (let s = startSec; s <= endSec; s += tickInterval) {
    ticks.push(s);
  }

  const positionFromPointer = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      const scrollEl = scrollContainerRef.current;
      if (!el || !scrollEl) return;
      const rect = el.getBoundingClientRect();
      const rawX = clientX - rect.left + scrollEl.scrollLeft;
      const micros = Math.round((rawX / pixelsPerSecond) * 1_000_000);
      setPlayhead(micros);
    },
    [pixelsPerSecond, setPlayhead, scrollContainerRef]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      positionFromPointer(e.clientX);
    },
    [positionFromPointer]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      positionFromPointer(e.clientX);
    },
    [positionFromPointer]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  return (
    <div
      ref={rulerRef}
      className="relative h-6 shrink-0 cursor-pointer border-b border-white/10 bg-[#1a1a1a]"
      style={{ width: totalWidth }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {ticks.map((seconds) => (
        <div
          key={seconds}
          className="absolute top-0 flex h-full flex-col justify-end"
          style={{ transform: `translate3d(${seconds * pixelsPerSecond}px, 0, 0)` }}
        >
          <span className="mb-0.5 px-1 text-[9px] tabular-nums text-white/40">
            {formatTimecode(seconds)}
          </span>
          <div className="h-2 w-[1px] bg-white/20" />
        </div>
      ))}
    </div>
  );
}

function getTickInterval(pixelsPerSecond: number): number {
  if (pixelsPerSecond > 500) return 1 / 60;
  if (pixelsPerSecond > 50) return 1;
  if (pixelsPerSecond > 5) return 10;
  return 60;
}
