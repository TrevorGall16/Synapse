"use client";

import { useState, useEffect, useCallback, type RefObject } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";

interface ZoomSliderProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  trackAreaRef: RefObject<HTMLDivElement | null>;
}

// Logarithmic mapping for usable slider at extreme low zoom
function sliderToZoom(slider: number): number {
  // slider 0..1 maps to zoom 0.001..3 on log scale
  const minLog = Math.log(0.001);
  const maxLog = Math.log(3);
  return Math.exp(minLog + slider * (maxLog - minLog));
}

function zoomToSlider(zoom: number): number {
  const minLog = Math.log(0.001);
  const maxLog = Math.log(3);
  return (Math.log(zoom) - minLog) / (maxLog - minLog);
}

export function ZoomSlider({ scrollContainerRef, trackAreaRef }: ZoomSliderProps) {
  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const setZoom = usePlaybackStore((s) => s.setZoom);

  // Local slider state for visual-first drag; committed to store on pointer-up only
  const [localSlider, setLocalSlider] = useState(() => zoomToSlider(zoomLevel));

  // Sync local state when the committed zoom changes externally (e.g., Ctrl+Wheel)
  useEffect(() => {
    setLocalSlider(zoomToSlider(zoomLevel));
  }, [zoomLevel]);

  // During drag: update local state only + apply CSS scaleX for instant visual feedback
  const onZoomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newSlider = Number(e.target.value);
      setLocalSlider(newSlider);

      if (trackAreaRef.current) {
        const committedZoom = usePlaybackStore.getState().zoomLevel;
        const scale = sliderToZoom(newSlider) / committedZoom;
        trackAreaRef.current.style.transform = `scaleX(${scale})`;
      }
    },
    [trackAreaRef]
  );

  // On pointer-up: commit to store, clear the CSS transform, apply scroll anchor
  const onPointerUp = useCallback(() => {
    const finalZoom = sliderToZoom(localSlider);

    // Clear the CSS transform first — the store update will re-render with correct layout
    if (trackAreaRef.current) {
      trackAreaRef.current.style.transform = "";
    }

    const container = scrollContainerRef.current;
    if (container) {
      const { playheadPosition, pixelsPerSecond: oldPPS } = usePlaybackStore.getState();
      const playheadPx = (playheadPosition / 1_000_000) * oldPPS;
      const playheadScreenX = playheadPx - container.scrollLeft;

      setZoom(finalZoom);

      const clampedZoom = Math.max(0.001, Math.min(3, finalZoom));
      const newPPS = 100 * clampedZoom;
      const newPlayheadPx = (playheadPosition / 1_000_000) * newPPS;
      container.scrollLeft = newPlayheadPx - playheadScreenX;
    } else {
      setZoom(finalZoom);
    }
  }, [localSlider, setZoom, scrollContainerRef, trackAreaRef]);

  const displayZoom = sliderToZoom(localSlider);

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
        className="h-1 w-24 cursor-pointer"
        aria-label="Timeline zoom"
        style={{ accentColor: "#3b82f6" }}
      />
      <span className="text-[10px] text-white/40">+</span>
      <span className="min-w-[3ch] text-right text-[10px] tabular-nums text-white/50">
        {Math.round(displayZoom * 100)}%
      </span>
    </div>
  );
}
