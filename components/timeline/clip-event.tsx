"use client";

import { useRef, useCallback } from "react";
import type { ClipEvent } from "@/lib/store/types";
import { useProjectStore } from "@/lib/store/project-store";
import { Settings } from "lucide-react";
import { ClipFilmstrip } from "./clip-filmstrip";
import { ClipWaveform } from "./clip-waveform";

interface ClipEventBlockProps {
  clip: ClipEvent;
  trackId: string;
  pixelsPerSecond: number;
  trackColor: string;
  trackHeight: number;
}

export function ClipEventBlock({ clip, trackId, pixelsPerSecond, trackColor, trackHeight }: ClipEventBlockProps) {
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const tracks = useProjectStore((s) => s.tracks);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const media = mediaPool.find((m) => m.id === clip.sourceId);
  const label = media?.name ?? clip.sourceId;
  const track = tracks.find((t) => t.id === trackId);
  const isSelected = selectedClipIds.includes(clip.id);

  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0, time: 0, trackId: "" });
  const accumY = useRef(0);

  const xPx = (clip.startTime / 1_000_000) * pixelsPerSecond;
  const wPx = (clip.duration / 1_000_000) * pixelsPerSecond;

  // Fade overlay widths
  const fadeInPx = clip.fadeInDuration ? (clip.fadeInDuration / 1_000_000) * pixelsPerSecond : 0;
  const fadeOutPx = clip.fadeOutDuration ? (clip.fadeOutDuration / 1_000_000) * pixelsPerSecond : 0;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();

      // Select this clip (+ all grouped clips)
      const { setSelectedClipIds, tracks: allTracks } = useProjectStore.getState();
      const groupIds: string[] = [clip.id];
      if (clip.groupId) {
        for (const t of allTracks) {
          for (const c of t.clips) {
            if (c.groupId === clip.groupId && c.id !== clip.id) {
              groupIds.push(c.id);
            }
          }
        }
      }
      if (e.shiftKey) {
        const existing = useProjectStore.getState().selectedClipIds;
        setSelectedClipIds([...existing, ...groupIds]);
      } else {
        setSelectedClipIds(groupIds);
      }

      e.currentTarget.setPointerCapture(e.pointerId);
      isDragging.current = true;
      accumY.current = 0;
      startPos.current = { x: e.clientX, y: e.clientY, time: clip.startTime, trackId };
    },
    [clip.id, clip.groupId, clip.startTime, trackId]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;

      const deltaX = e.clientX - startPos.current.x;
      const deltaTime = Math.round((deltaX / pixelsPerSecond) * 1_000_000);

      accumY.current += e.movementY;
      const trackJumps = Math.trunc(accumY.current / trackHeight);

      if (deltaTime !== 0 || trackJumps !== 0) {
        useProjectStore.getState().moveClip(clip.id, deltaTime, trackJumps);
        startPos.current.x = e.clientX;
        startPos.current.time = clip.startTime + deltaTime;
        if (trackJumps !== 0) {
          accumY.current -= trackJumps * trackHeight;
        }
      }
    },
    [clip.id, clip.startTime, pixelsPerSecond, trackHeight]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = false;
      accumY.current = 0;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  return (
    <div
      className={`absolute top-0 flex h-full cursor-grab select-none items-center overflow-hidden rounded active:cursor-grabbing ${
        isSelected ? "ring-2 ring-white" : ""
      }`}
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
      {/* Filmstrip for video clips */}
      {track?.type === "video" && media?.previewUrl && (
        <ClipFilmstrip clip={clip} media={media} clipWidthPx={wPx} />
      )}

      {/* Waveform for audio clips */}
      {track?.type === "audio" && (
        <ClipWaveform sourceId={clip.sourceId} clipWidthPx={wPx} trackColor={trackColor} trackHeight={trackHeight} />
      )}

      {/* Fade-in triangle overlay (top-left) */}
      {fadeInPx > 0 && (
        <svg
          className="pointer-events-none absolute top-0 left-0 h-full"
          style={{ width: fadeInPx }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <polygon points="0,0 100,100 0,100" fill="rgba(0,0,0,0.5)" />
        </svg>
      )}

      {/* Fade-out triangle overlay (top-right) */}
      {fadeOutPx > 0 && (
        <svg
          className="pointer-events-none absolute top-0 right-0 h-full"
          style={{ width: fadeOutPx }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <polygon points="100,0 100,100 0,100" fill="rgba(0,0,0,0.5)" />
        </svg>
      )}

      {/* Label */}
      <span className="relative z-10 truncate px-1.5 text-[10px] font-medium text-white/80 drop-shadow-sm">
        {label}
      </span>

      {/* Settings gear for text/effect clips */}
      {(track?.type === "text" || track?.type === "effect") && (
        <button
          className="absolute right-1 top-1 z-20 rounded p-0.5 text-white/40 transition-colors hover:bg-white/15 hover:text-white"
          aria-label="Clip settings"
          onPointerDown={(e) => {
            e.stopPropagation();
            useProjectStore.getState().setInspectingClipId(clip.id);
          }}
        >
          <Settings size={12} />
        </button>
      )}
    </div>
  );
}
