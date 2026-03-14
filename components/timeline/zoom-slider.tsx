"use client";

import { usePlaybackStore } from "@/lib/store/playback-store";

export function ZoomSlider() {
  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const setZoom = usePlaybackStore((s) => s.setZoom);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-white/40">-</span>
      <input
        type="range"
        min={0.1}
        max={10}
        step={0.1}
        value={zoomLevel}
        onChange={(e) => setZoom(Number(e.target.value))}
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
