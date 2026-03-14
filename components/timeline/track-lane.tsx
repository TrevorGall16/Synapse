"use client";

import { useRef, useCallback } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent } from "@/lib/store/types";
import { ClipEventBlock } from "./clip-event";

interface TrackLaneProps {
  trackId: string;
}

export function TrackLane({ trackId }: TrackLaneProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);
  const track = useProjectStore((s) => s.tracks.find((t) => t.id === trackId));

  const pixelsPerSecond = 100 * zoomLevel;

  const positionFromPointer = useCallback(
    (clientX: number) => {
      const el = laneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rawX = clientX - rect.left;
      const micros = Math.round((rawX / pixelsPerSecond) * 1_000_000);
      setPlayhead(micros);
    },
    [pixelsPerSecond, setPlayhead]
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

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const mediaId = e.dataTransfer.getData("mediaId");
      if (!mediaId) return;

      const { mediaPool, addClip } = useProjectStore.getState();
      const media = mediaPool.find((m) => m.id === mediaId);
      if (!media) return;

      const rawX = e.nativeEvent.offsetX;
      const micros = Math.round((rawX / pixelsPerSecond) * 1_000_000);

      const clip: ClipEvent = {
        id: crypto.randomUUID(),
        type: media.type,
        sourceId: mediaId,
        startTime: Math.max(0, micros),
        duration: media.durationMicros,
      };

      addClip(trackId, clip);
    },
    [trackId, pixelsPerSecond]
  );

  const trackColor = track?.color ?? "#666";

  return (
    <div
      ref={laneRef}
      className="relative min-h-[48px] flex-1 cursor-pointer border-b border-white/5 bg-[#1e1e1e]"
      data-track={trackId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {track?.clips.map((clip) => (
        <ClipEventBlock
          key={clip.id}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
          trackColor={trackColor}
        />
      ))}
    </div>
  );
}
