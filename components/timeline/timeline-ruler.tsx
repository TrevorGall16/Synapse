"use client";

import { useRef, useCallback, type RefObject } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { getGridInterval } from "@/lib/utils/grid";

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
  const isSelecting = useRef(false);
  const startClientX = useRef(0);
  const startMicros = useRef(0);

  const duration = useProjectStore((s) => s.duration);
  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);
  const setSelection = usePlaybackStore((s) => s.setSelection);
  const clearSelection = usePlaybackStore((s) => s.clearSelection);
  const selectionStart = usePlaybackStore((s) => s.selectionStart);
  const selectionEnd = usePlaybackStore((s) => s.selectionEnd);
  const totalWidth = (duration / 1_000_000) * pixelsPerSecond;

  const tickInterval = getGridInterval(pixelsPerSecond);
  const totalSeconds = duration / 1_000_000;

  const container = scrollContainerRef.current;
  const scrollLeft = container?.scrollLeft ?? 0;
  const viewWidth = container?.clientWidth ?? totalWidth;
  const startSec = Math.max(0, Math.floor(scrollLeft / pixelsPerSecond / tickInterval) * tickInterval);
  const endSec = Math.min(totalSeconds, (scrollLeft + viewWidth) / pixelsPerSecond + tickInterval);

  const ticks: number[] = [];
  for (let s = startSec; s <= endSec; s += tickInterval) {
    ticks.push(s);
  }

  const microsFromClientX = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      const scrollEl = scrollContainerRef.current;
      if (!el || !scrollEl) return 0;
      const rect = el.getBoundingClientRect();
      const rawX = clientX - rect.left + scrollEl.scrollLeft;
      let micros = Math.round((rawX / pixelsPerSecond) * 1_000_000);

      const snapThresholdMicros = Math.round((8 / pixelsPerSecond) * 1_000_000);
      const tracks = useProjectStore.getState().tracks;
      let bestDist = snapThresholdMicros;
      for (const t of tracks) {
        for (const c of t.clips) {
          for (const edge of [c.startTime, c.startTime + c.duration]) {
            const d = Math.abs(micros - edge);
            if (d < bestDist) { bestDist = d; micros = edge; }
          }
        }
      }
      return Math.max(0, Math.min(micros, duration));
    },
    [pixelsPerSecond, scrollContainerRef, duration]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const micros = microsFromClientX(e.clientX);
      setPlayhead(micros);
      isDragging.current = true;
      isSelecting.current = false;
      startClientX.current = e.clientX;
      startMicros.current = micros;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [microsFromClientX, setPlayhead]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      const micros = microsFromClientX(e.clientX);
      const movedPx = Math.abs(e.clientX - startClientX.current);

      if (movedPx > 5) {
        isSelecting.current = true;
        setSelection(startMicros.current, micros);
        setPlayhead(micros);
      }
    },
    [microsFromClientX, setSelection, setPlayhead]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = false;
      if (!isSelecting.current) {
        clearSelection();
      } else {
        // Normalize so start < end
        const s = usePlaybackStore.getState().selectionStart ?? 0;
        const en = usePlaybackStore.getState().selectionEnd ?? 0;
        setSelection(Math.min(s, en), Math.max(s, en));
      }
      isSelecting.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [clearSelection, setSelection]
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
      {/* Blue selection zone */}
      {selectionStart != null && selectionEnd != null && (
        <div
          className="pointer-events-none absolute top-0 h-full bg-blue-500/30"
          style={{
            left: `${(Math.min(selectionStart, selectionEnd) / 1_000_000) * pixelsPerSecond}px`,
            width: `${(Math.abs(selectionEnd - selectionStart) / 1_000_000) * pixelsPerSecond}px`,
          }}
        />
      )}

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
