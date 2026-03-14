"use client";

import { useCallback, type RefObject } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";

interface ZoomSliderProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function ZoomSlider({ scrollContainerRef }: ZoomSliderProps) {
  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const setZoom = usePlaybackStore((s) => s.setZoom);

  const onZoomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newZoom = Number(e.target.value);
      const container = scrollContainerRef.current;

      if (container) {
        const { playheadPosition } = usePlaybackStore.getState();
        const oldPPS = 100 * zoomLevel;
        const playheadPx = (playheadPosition / 1_000_000) * oldPPS;
        const playheadScreenX = playheadPx - container.scrollLeft;

        setZoom(newZoom);

        const clampedZoom = Math.max(0.1, Math.min(3, newZoom));
        const newPPS = 100 * clampedZoom;
        const newPlayheadPx = (playheadPosition / 1_000_000) * newPPS;
        container.scrollLeft = newPlayheadPx - playheadScreenX;
      } else {
        setZoom(newZoom);
      }
    },
    [zoomLevel, setZoom, scrollContainerRef]
  );

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40">-</span>
      <input
        type="range"
        min={0.1}
        max={3}
        step={0.1}
        value={zoomLevel}
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
