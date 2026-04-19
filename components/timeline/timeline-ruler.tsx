"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { getGridInterval } from "@/lib/utils/grid";
import { pointerToMicros, timeMicrosToTimelinePx } from "@/lib/utils/coords";

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
      const scrollEl = scrollContainerRef.current;
      if (!scrollEl) return 0;
      // Canonical pointer math — reads scrollLeft + rect from the outer scroll
      // container, never an inner stretched content node. See lib/utils/coords.ts.
      const rawMicros = Math.round(pointerToMicros(clientX, scrollEl, pixelsPerSecond));
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

  /** Hit-test against bracket handles using the pointer's clientX directly.
   *  Uses pointerToMicros so the math stays consistent with everything else. */
  const hitTestBracketAt = useCallback(
    (clientX: number): "start" | "end" | null => {
      const scrollEl = scrollContainerRef.current;
      if (!scrollEl) return null;
      const { selectionStart: ss, selectionEnd: se } = usePlaybackStore.getState();
      if (ss == null || se == null) return null;
      // Convert each bracket micros to timeline-px, then compare to the
      // pointer's timeline-px (derived via the same canonical formula).
      const pointerPx = (pointerToMicros(clientX, scrollEl, pixelsPerSecond) / 1_000_000) * pixelsPerSecond;
      const leftPx = timeMicrosToTimelinePx(Math.min(ss, se), pixelsPerSecond);
      const rightPx = timeMicrosToTimelinePx(Math.max(ss, se), pixelsPerSecond);
      if (Math.abs(pointerPx - leftPx) <= 10) return "start";
      if (Math.abs(pointerPx - rightPx) <= 10) return "end";
      return null;
    },
    [pixelsPerSecond, scrollContainerRef]
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    const bracket = hitTestBracketAt(e.clientX);

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
  }, [hitTestBracketAt, microsFromClientX, setPlayhead, scrollContainerRef]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    // Update cursor based on bracket proximity (only when not actively dragging)
    if (!isDragging.current && rulerRef.current) {
      rulerRef.current.style.cursor = hitTestBracketAt(e.clientX) ? "col-resize" : "pointer";
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
  }, [hitTestBracketAt, microsFromClientX, setSelection, setPlayhead]);

  const endDrag = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    draggingBracket.current = null;
    if (!isSelecting.current) {
      clearSelection();
    } else {
      const { selectionStart: s, selectionEnd: en } = usePlaybackStore.getState();
      if (s != null && en != null) setSelection(Math.min(s, en), Math.max(s, en));
    }
    isSelecting.current = false;
    // Pointer capture is released even if the pointer left the element —
    // that's the whole point of capture. Matching release keeps the OS happy.
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }, [clearSelection, setSelection]);

  const onPointerUp = endDrag;
  const onPointerCancel = endDrag;

  const onPointerLeave = useCallback(() => {
    // The drag itself survives pointerleave thanks to setPointerCapture;
    // this handler only resets the idle cursor.
    if (!isDragging.current && rulerRef.current) {
      rulerRef.current.style.cursor = "pointer";
    }
  }, []);

  // Selection geometry is derived from the authoritative micros every render,
  // using the same canonical timeline-px mapping as clip rendering. This keeps
  // the blue highlight + yellow brackets aligned with the exact published trim
  // range at every zoom/scroll state — no drift, no re-entry from UI state.
  const hasSelection = selectionStart != null && selectionEnd != null;
  const selStartMicros = hasSelection ? Math.min(selectionStart!, selectionEnd!) : 0;
  const selEndMicros = hasSelection ? Math.max(selectionStart!, selectionEnd!) : 0;
  const selLeft = hasSelection ? timeMicrosToTimelinePx(selStartMicros, pixelsPerSecond) : 0;
  const selRight = hasSelection ? timeMicrosToTimelinePx(selEndMicros, pixelsPerSecond) : 0;
  const selWidth = Math.max(0, selRight - selLeft);
  const hudLeft = Math.max(40, Math.min(selLeft + selWidth / 2, totalWidth - 60));

  return (
    <div
      ref={rulerRef}
      // `select-none` + `touch-none` prevent the browser from starting a
      // native text-selection or pan gesture while we handle pointer events
      // directly. Without these, dragging across tick labels highlights the
      // numerals and tears the timeline.
      className="relative h-6 shrink-0 cursor-pointer select-none touch-none border-b border-white/10 bg-[#1a1a1a]"
      style={{ width: totalWidth, userSelect: "none", WebkitUserSelect: "none", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
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
