"use client";

import { useRef, useCallback } from "react";
import type { ClipEvent } from "@/lib/store/types";
import { useProjectStore } from "@/lib/store/project-store";

interface ClipEventBlockProps {
  clip: ClipEvent;
  trackId: string;
  pixelsPerSecond: number;
  trackColor: string;
}

export function ClipEventBlock({ clip, trackId, pixelsPerSecond, trackColor }: ClipEventBlockProps) {
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const media = mediaPool.find((m) => m.id === clip.sourceId);
  const label = media?.name ?? clip.sourceId;

  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, time: 0 });

  const xPx = (clip.startTime / 1_000_000) * pixelsPerSecond;
  const wPx = (clip.duration / 1_000_000) * pixelsPerSecond;

  const hasThumb = media?.previewUrl && (media.mediaKind === "video" || media.mediaKind === "image");

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      isDragging.current = true;
      startPos.current = { x: e.clientX, time: clip.startTime };
    },
    [clip.startTime]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      const deltaX = e.clientX - startPos.current.x;
      const newTime = Math.max(0, startPos.current.time + Math.round((deltaX / pixelsPerSecond) * 1_000_000));
      useProjectStore.getState().updateClipStartTime(clip.id, newTime);
    },
    [clip.id, pixelsPerSecond]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  return (
    <div
      className="absolute top-0 flex h-full cursor-grab items-center overflow-hidden rounded active:cursor-grabbing"
      style={{
        transform: `translate3d(${xPx}px, 0, 0)`,
        width: wPx,
        backgroundColor: trackColor + "40",
        borderLeft: `2px solid ${trackColor}`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Filmstrip thumbnail */}
      {media?.previewUrl && media.mediaKind === "video" && (
        <div className="absolute inset-y-0 left-0 w-16 overflow-hidden bg-black/50">
          <video
            src={media.previewUrl}
            className="h-full w-full object-cover opacity-50"
            muted
            preload="metadata"
          />
        </div>
      )}
      {media?.previewUrl && media.mediaKind === "image" && (
        <div className="absolute inset-y-0 left-0 w-16 overflow-hidden bg-black/50">
          <img
            src={media.previewUrl}
            alt={label}
            className="h-full w-full object-cover opacity-50"
          />
        </div>
      )}
      <span
        className={`truncate text-[10px] font-medium text-white/70 ${hasThumb ? "ml-[68px]" : "px-1.5"}`}
      >
        {label}
      </span>
    </div>
  );
}
