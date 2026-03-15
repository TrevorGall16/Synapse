"use client";

import { useCallback, type RefObject } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";

interface ZoomSliderProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
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

export function ZoomSlider({ scrollContainerRef }: ZoomSliderProps) {
  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const setZoom = usePlaybackStore((s) => s.setZoom);

  const sliderValue = zoomToSlider(zoomLevel);

  const onZoomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newZoom = sliderToZoom(Number(e.target.value));
      const container = scrollContainerRef.current;

      if (container) {
        const { playheadPosition, pixelsPerSecond: oldPPS } = usePlaybackStore.getState();
        const playheadPx = (playheadPosition / 1_000_000) * oldPPS;
        const playheadScreenX = playheadPx - container.scrollLeft;

        setZoom(newZoom);

        const clampedZoom = Math.max(0.001, Math.min(3, newZoom));
        const newPPS = 100 * clampedZoom;
        const newPlayheadPx = (playheadPosition / 1_000_000) * newPPS;
        container.scrollLeft = newPlayheadPx - playheadScreenX;
      } else {
        setZoom(newZoom);
      }
    },
    [setZoom, scrollContainerRef]
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40">-</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={sliderValue}
        onChange={onZoomChange}
        className="h-1 w-24 cursor-pointer"
        aria-label="Timeline zoom"
        style={{ accentColor: "#3b82f6" }}
      />
      <span className="text-[10px] text-white/40">+</span>
      <span className="min-w-[3ch] text-right text-[10px] tabular-nums text-white/50">
        {Math.round(zoomLevel * 100)}%
      </span>
    </div>
  );
}
