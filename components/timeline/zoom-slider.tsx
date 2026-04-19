"use client";

import { useState, useEffect, useCallback, useMemo, type RefObject } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { timeMicrosToTimelinePx } from "@/lib/utils/coords";

interface ZoomSliderProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  trackAreaRef: RefObject<HTMLDivElement | null>;
}

// ── Zoom math ─────────────────────────────────────────────
// Store invariant: pixelsPerSecond = 100 * zoomLevel.
// Slider [0..1] maps log-scaled to zoomLevel [fitZoom .. 3].
// At slider=0 the project FITS the visible timeline width (true Zoom-to-Fit),
// not an arbitrary squish. For empty/short projects we clamp duration to 10s
// so fitPPS stays finite and sensible.

const MIN_DURATION_SEC_FOR_FIT = 10;
const MAX_ZOOM = 3;

/** Compute the zoomLevel at which the entire project fits the visible width.
 *  Returns a positive finite number; falls back to a conservative default
 *  when inputs are zero/NaN (e.g. container not yet measured). */
function computeFitZoom(visibleWidth: number, totalDurationSec: number): number {
  if (!Number.isFinite(visibleWidth) || visibleWidth <= 0) return 0.001;
  const safeDurationSec = Math.max(totalDurationSec, MIN_DURATION_SEC_FOR_FIT);
  const fitPPS = visibleWidth / safeDurationSec;
  const fitZoom = fitPPS / 100;
  // Never let the fit zoom exceed MAX_ZOOM (happens only on huge viewports +
  // 10s min duration); this keeps the slider bounds consistent.
  return Math.min(Math.max(fitZoom, 0.001), MAX_ZOOM);
}

function sliderToZoom(slider: number, fitZoom: number): number {
  const minLog = Math.log(fitZoom);
  const maxLog = Math.log(MAX_ZOOM);
  return Math.exp(minLog + slider * (maxLog - minLog));
}

function zoomToSlider(zoom: number, fitZoom: number): number {
  const minLog = Math.log(fitZoom);
  const maxLog = Math.log(MAX_ZOOM);
  const span = maxLog - minLog;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.max(0, Math.min(1, (Math.log(zoom) - minLog) / span));
}

export function ZoomSlider({ scrollContainerRef, trackAreaRef }: ZoomSliderProps) {
  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const containerWidth = usePlaybackStore((s) => s.containerWidth);
  const setZoom = usePlaybackStore((s) => s.setZoom);
  const durationMicros = useProjectStore((s) => s.duration);

  // fitZoom is dynamic: recomputes whenever the viewport or project
  // duration changes. Slider=0 always means "fit the project on screen".
  const fitZoom = useMemo(
    () => computeFitZoom(containerWidth, durationMicros / 1_000_000),
    [containerWidth, durationMicros]
  );

  // Local slider state for visual-first drag; committed to store on pointer-up only
  const [localSlider, setLocalSlider] = useState(() => zoomToSlider(zoomLevel, fitZoom));

  // Sync local state when committed zoom changes externally (e.g., Ctrl+Wheel)
  // OR when fitZoom shifts (viewport resize, duration change).
  useEffect(() => {
    setLocalSlider(zoomToSlider(zoomLevel, fitZoom));
  }, [zoomLevel, fitZoom]);

  // Ensure cssZoomScale resets on unmount — prevents stale scale if component
  // is removed mid-drag (e.g., route change, panel collapse).
  useEffect(() => {
    return () => {
      usePlaybackStore.getState().setCssZoomScale(1);
      if (trackAreaRef.current) {
        trackAreaRef.current.style.transform = "";
      }
    };
  }, [trackAreaRef]);

  // During drag: update local state only + apply CSS scaleX for instant visual feedback
  const onZoomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newSlider = Number(e.target.value);
      setLocalSlider(newSlider);

      if (trackAreaRef.current) {
        const committedZoom = usePlaybackStore.getState().zoomLevel;
        const scale = sliderToZoom(newSlider, fitZoom) / committedZoom;
        trackAreaRef.current.style.transform = `scaleX(${scale})`;
        usePlaybackStore.getState().setCssZoomScale(scale);
      }
    },
    [trackAreaRef, fitZoom]
  );

  // On pointer-up: commit to store, clear the CSS transform, apply scroll anchor
  const onPointerUp = useCallback(() => {
    const finalZoom = sliderToZoom(localSlider, fitZoom);

    // Clear the CSS transform first — the store update will re-render with correct layout
    if (trackAreaRef.current) {
      trackAreaRef.current.style.transform = "";
    }
    usePlaybackStore.getState().setCssZoomScale(1);

    const container = scrollContainerRef.current;
    if (container) {
      // Anchor the playhead to its current screen X across the zoom transition
      // so the view doesn't "jump" when snapping into or out of fit mode.
      const { playheadPosition, pixelsPerSecond: oldPPS } = usePlaybackStore.getState();
      const playheadPx = timeMicrosToTimelinePx(playheadPosition, oldPPS);
      const playheadScreenX = playheadPx - container.scrollLeft;

      setZoom(finalZoom);

      const clampedZoom = Math.max(0.001, Math.min(MAX_ZOOM, finalZoom));
      const newPPS = 100 * clampedZoom;
      const newPlayheadPx = timeMicrosToTimelinePx(playheadPosition, newPPS);
      container.scrollLeft = newPlayheadPx - playheadScreenX;
    } else {
      setZoom(finalZoom);
    }
  }, [localSlider, setZoom, scrollContainerRef, trackAreaRef, fitZoom]);

  // Guard: reset transient CSS zoom on pointer cancel, blur, or unmount
  // to prevent stale cssZoomScale from corrupting future pointer math.
  const resetZoom = useCallback(() => {
    if (trackAreaRef.current) {
      trackAreaRef.current.style.transform = "";
    }
    usePlaybackStore.getState().setCssZoomScale(1);
  }, [trackAreaRef]);

  const displayZoom = sliderToZoom(localSlider, fitZoom);
  const atFit = localSlider <= 0.001;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40">-</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={localSlider}
        onChange={onZoomChange}
        onPointerDown={(e) => (e.target as HTMLInputElement).setPointerCapture(e.pointerId)}
        onPointerUp={onPointerUp}
        onPointerCancel={resetZoom}
        onBlur={resetZoom}
        className="h-1 w-24 cursor-pointer"
        aria-label="Timeline zoom"
        style={{ accentColor: "#3b82f6" }}
      />
      <span className="text-[10px] text-white/40">+</span>
      <span className="min-w-[3ch] text-right text-[10px] tabular-nums text-white/50">
        {atFit ? "Fit" : `${Math.round(displayZoom * 100)}%`}
      </span>
    </div>
  );
}
