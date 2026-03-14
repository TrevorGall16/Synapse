"use client";

import { useRef, useCallback } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";

interface TrackLaneProps {
  trackId: string;
}

export function TrackLane({ trackId }: TrackLaneProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);

  const pixelsPerSecond = 100 * zoomLevel;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = laneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const micros = Math.round((rawX / pixelsPerSecond) * 1_000_000);
      setPlayhead(micros);
    },
    [pixelsPerSecond, setPlayhead]
  );

  return (
    <div
      ref={laneRef}
      className="min-h-[48px] flex-1 cursor-pointer border-b border-white/5 bg-[#1e1e1e]"
      data-track={trackId}
      onPointerDown={onPointerDown}
    />
  );
}
