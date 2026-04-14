"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { getGridInterval } from "@/lib/utils/grid";

function formatTimecode(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDurationHMSF(micros: number, fps: number): string {
  const totalSec = Math.abs(micros) / 1_000_000;
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = Math.floor(totalSec % 60);
  const ff = Math.floor((totalSec % 1) * fps);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}:${String(ff).padStart(2, "0")}`;
}

interface TimelineRulerProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

/** Returns the raw X position (relative to scroll origin) for a clientX pointer event. */
function rawXFromClient(clientX: number, el: HTMLDivElement, scrollEl: HTMLDivElement): number {
  return clientX - el.getBoundingClientRect().left + scrollEl.scrollLeft;
}

export function TimelineRuler({ scrollContainerRef }: TimelineRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isSelecting = useRef(false);
  // "start" | "end" = dragging an existing bracket; null = free drag / new selection
  const draggingBracket = useRef<"start" | "end" | null>(null);
  const startClientX = useRef(0);
  const startMicros = useRef(0);

  const duration = useProjectStore((s) => s.duration);
  const fps = useProjectStore((s) => s.projectSettings.fps);
  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);
  const setSelection = usePlaybackStore((s) => s.setSelection);
  const clearSelection = usePlaybackStore((s) => s.clearSelection);
  const selectionStart = usePlaybackStore((s) => s.selectionStart);
  const selectionEnd = usePlaybackStore((s) => s.selectionEnd);
  const totalWidth = (duration / 1_000_000) * pixelsPerSecond;

  const tickInterval = getGridInterval(pixelsPerSecond);
  const totalSeconds = duration / 1_000_000;

  // Subscribe to scroll + resize on the external scroll container so tick
  // virtualization reacts without reading the ref during render. Storing the
  // metrics in state keeps the render body pure (react-hooks/refs).
  const [metrics, setMetrics] = useState({ scrollLeft: 0, viewWidth: 0 });
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const update = () => setMetrics({
      scrollLeft: container.scrollLeft,
      viewWidth: container.clientWidth,
    });
    update();
    container.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => {
      container.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollContainerRef]);

  const { scrollLeft, viewWidth: measuredViewWidth } = metrics;
  const viewWidth = measuredViewWidth || totalWidth;
  const startSec = Math.max(0, Math.floor(scrollLeft / pixelsPerSecond / tickInterval) * tickInterval);
  const endSec = Math.min(totalSeconds, (scrollLeft + viewWidth) / pixelsPerSecond + tickInterval);

  const ticks: number[] = [];
  for (let s = startSec; s <= endSec; s += tickInterval) ticks.push(s);

  const microsFromClientX = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      const scrollEl = scrollContainerRef.current;
      if (!el || !scrollEl) return 0;
      const rawX = rawXFromClient(clientX, el, scrollEl);
      const rawMicros = Math.round((rawX / pixelsPerSecond) * 1_000_000);
      let micros = rawMicros;

      const snapThreshold = Math.round((8 / pixelsPerSecond) * 1_000_000);
      const tracks = useProjectStore.getState().tracks;
      let bestDist = snapThreshold;
      for (const t of tracks) {
        for (const c of t.clips) {
          for (const edge of [c.startTime, c.startTime + c.duration]) {
            const d = Math.abs(rawMicros - edge);
            if (d < bestDist) { bestDist = d; micros = edge; }
          }
        }
      }
      const { selectionStart: ss, selectionEnd: se } = usePlaybackStore.getState();
      if (ss != null) { const d = Math.abs(rawMicros - ss); if (d < bestDist) { bestDist = d; micros = ss; } }
      if (se != null) { const d = Math.abs(rawMicros - se); if (d < bestDist) { micros = se; } }

      return Math.max(0, Math.min(micros, duration));
    },
    [pixelsPerSecond, scrollContainerRef, duration]
  );

  /** Check if rawX is within 10px of a bracket, return which one or null. */
  const hitTestBracket = useCallback(
    (rawX: number): "start" | "end" | null => {
      const { selectionStart: ss, selectionEnd: se } = usePlaybackStore.getState();
      if (ss == null || se == null) return null;
      const leftPx = (Math.min(ss, se) / 1_000_000) * pixelsPerSecond;
      const rightPx = (Math.max(ss, se) / 1_000_000) * pixelsPerSecond;
      if (Math.abs(rawX - leftPx) <= 10) return "start";
      if (Math.abs(rawX - rightPx) <= 10) return "end";
      return null;
    },
    [pixelsPerSecond]
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = rulerRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!el || !scrollEl) return;

    const rawX = rawXFromClient(e.clientX, el, scrollEl);
    const bracket = hitTestBracket(rawX);

    if (bracket) {
      // Dragging an existing bracket — don't start a new selection
      draggingBracket.current = bracket;
      isDragging.current = true;
      isSelecting.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Normal ruler click: set playhead, potentially start a new selection
    draggingBracket.current = null;
    const micros = microsFromClientX(e.clientX);
    setPlayhead(micros);
    isDragging.current = true;
    isSelecting.current = false;
    startClientX.current = e.clientX;
    startMicros.current = micros;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [hitTestBracket, microsFromClientX, setPlayhead, scrollContainerRef]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = rulerRef.current;
    const scrollEl = scrollContainerRef.current;

    // Update cursor based on bracket proximity (only when not actively dragging)
    if (!isDragging.current && el && scrollEl) {
      const rawX = rawXFromClient(e.clientX, el, scrollEl);
      el.style.cursor = hitTestBracket(rawX) ? "col-resize" : "pointer";
    }

    if (!isDragging.current) return;

    const micros = microsFromClientX(e.clientX);

    if (draggingBracket.current) {
      // Extend / shrink an existing bracket
      const { selectionStart: ss, selectionEnd: se } = usePlaybackStore.getState();
      if (draggingBracket.current === "start") {
        setSelection(micros, se ?? micros);
      } else {
        setSelection(ss ?? micros, micros);
      }
      setPlayhead(micros);
      return;
    }

    // New selection drag
    if (Math.abs(e.clientX - startClientX.current) > 5) {
      isSelecting.current = true;
      setSelection(startMicros.current, micros);
      setPlayhead(micros);
    }
  }, [hitTestBracket, microsFromClientX, setSelection, setPlayhead, scrollContainerRef]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    draggingBracket.current = null;
    if (!isSelecting.current) {
      clearSelection();
    } else {
      const { selectionStart: s, selectionEnd: en } = usePlaybackStore.getState();
      if (s != null && en != null) setSelection(Math.min(s, en), Math.max(s, en));
    }
    isSelecting.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, [clearSelection, setSelection]);

  const onPointerLeave = useCallback(() => {
    if (!isDragging.current && rulerRef.current) {
      rulerRef.current.style.cursor = "pointer";
    }
  }, []);

  // Pre-compute selection geometry for rendering
  const hasSelection = selectionStart != null && selectionEnd != null;
  const selLeft = hasSelection ? (Math.min(selectionStart!, selectionEnd!) / 1_000_000) * pixelsPerSecond : 0;
  const selRight = hasSelection ? (Math.max(selectionStart!, selectionEnd!) / 1_000_000) * pixelsPerSecond : 0;
  const selWidth = selRight - selLeft;
  const hudLeft = Math.max(40, Math.min(selLeft + selWidth / 2, totalWidth - 60));

  return (
    <div
      ref={rulerRef}
      className="relative h-6 shrink-0 cursor-pointer border-b border-white/10 bg-[#1a1a1a]"
      style={{ width: totalWidth }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {/* Selection zone */}
      {hasSelection && (
        <>
          <div className="pointer-events-none absolute top-0 h-full bg-blue-500/30" style={{ left: selLeft, width: selWidth }} />
          {/* Left bracket — wider hit target for drag */}
          <div
            className="absolute top-0 h-full w-[2px] bg-yellow-400/90"
            style={{ left: selLeft }}
          />
          {/* Right bracket */}
          <div
            className="absolute top-0 h-full w-[2px] bg-yellow-400/90"
            style={{ left: selRight - 2 }}
          />
          {/* Timecode HUD */}
          <div
            className="pointer-events-none absolute -top-0 bottom-0 flex items-center"
            style={{ left: hudLeft }}
          >
            <span className="-translate-x-1/2 rounded bg-[#2a2a2a] px-1.5 py-0.5 text-[9px] tabular-nums text-yellow-300 ring-1 ring-yellow-400/30 whitespace-nowrap">
              {formatDurationHMSF(selectionEnd! - selectionStart!, fps)}
            </span>
          </div>
        </>
      )}

      {ticks.map((seconds) => (
        <div key={seconds} className="absolute top-0 flex h-full flex-col justify-end"
          style={{ transform: `translate3d(${seconds * pixelsPerSecond}px, 0, 0)` }}>
          <span className="mb-0.5 px-1 text-[9px] tabular-nums text-white/40">{formatTimecode(seconds)}</span>
          <div className="h-2 w-[1px] bg-white/20" />
        </div>
      ))}
    </div>
  );
}
