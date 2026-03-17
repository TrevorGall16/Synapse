"use client";

import { useRef, useCallback, useState } from "react";
import type { ClipEvent } from "@/lib/store/types";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { Settings, Crop, Volume2 } from "lucide-react";
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
  const isEdgeDragging = useRef<"left" | "right" | false>(false);
  const isLevelDragging = useRef(false);
  const isStretchDragging = useRef(false);
  const isFadeDragging = useRef<"in" | "out" | false>(false);
  const edgeStartX = useRef(0);
  const edgeOrigDuration = useRef(0);
  const levelStartY = useRef(0);
  const levelStartVal = useRef(100);
  const fadeStartX = useRef(0);
  const startPos = useRef({ x: 0, y: 0, time: 0, trackId: "" });
  const accumY = useRef(0);
  const [levelTooltip, setLevelTooltip] = useState<number | null>(null);

  const xPx = (clip.startTime / 1_000_000) * pixelsPerSecond;
  const wPx = (clip.duration / 1_000_000) * pixelsPerSecond;
  const clipLevel = clip.level ?? 100;

  // Fade overlay widths
  const fadeInPx = clip.fadeInDuration ? (clip.fadeInDuration / 1_000_000) * pixelsPerSecond : 0;
  const fadeOutPx = clip.fadeOutDuration ? (clip.fadeOutDuration / 1_000_000) * pixelsPerSecond : 0;

  // ── Main clip drag ─────────────────────────────────────
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

      // Move playhead to click position within clip
      const rect = e.currentTarget.getBoundingClientRect();
      const clickTime = clip.startTime + Math.round(
        ((e.clientX - rect.left) / pixelsPerSecond) * 1_000_000
      );
      usePlaybackStore.getState().setPlayhead(clickTime);

      e.currentTarget.setPointerCapture(e.pointerId);
      isDragging.current = true;
      accumY.current = 0;
      startPos.current = { x: e.clientX, y: e.clientY, time: clip.startTime, trackId };
    },
    [clip.id, clip.groupId, clip.startTime, trackId, pixelsPerSecond]
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

  // ── Edge trim handlers (left/right — trim only) ────────
  const onEdgeDown = useCallback(
    (edge: "left" | "right", e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      isEdgeDragging.current = edge;
      edgeStartX.current = e.clientX;
    },
    []
  );

  const onEdgeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isEdgeDragging.current) return;
      const deltaX = e.clientX - edgeStartX.current;
      const deltaMicros = Math.round((deltaX / pixelsPerSecond) * 1_000_000);
      useProjectStore.getState().trimClip(clip.id, isEdgeDragging.current, deltaMicros);
      edgeStartX.current = e.clientX;
    },
    [clip.id, pixelsPerSecond]
  );

  const onEdgeUp = useCallback(
    (e: React.PointerEvent) => {
      isEdgeDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  // ── Top-edge level drag (opacity/volume) ───────────────
  const onLevelDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      isLevelDragging.current = true;
      levelStartY.current = e.clientY;
      levelStartVal.current = clip.level ?? 100;
    },
    [clip.level]
  );

  const onLevelMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isLevelDragging.current) return;
      const deltaY = e.clientY - levelStartY.current;
      const deltaLevel = -(deltaY / trackHeight) * 100;
      const newLevel = Math.max(0, Math.min(100, Math.round(levelStartVal.current + deltaLevel)));
      useProjectStore.getState().setClipLevel(clip.id, newLevel);
      setLevelTooltip(newLevel);
    },
    [clip.id, trackHeight]
  );

  const onLevelUp = useCallback(
    (e: React.PointerEvent) => {
      isLevelDragging.current = false;
      setLevelTooltip(null);
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  // ── Fade handle drag ────────────────────────────────────
  const onFadeDown = useCallback(
    (edge: "in" | "out", e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      isFadeDragging.current = edge;
      fadeStartX.current = e.clientX;
    },
    []
  );

  const onFadeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isFadeDragging.current) return;
      const deltaX = e.clientX - fadeStartX.current;
      const deltaMicros = Math.round((deltaX / pixelsPerSecond) * 1_000_000);
      const store = useProjectStore.getState();
      if (isFadeDragging.current === "in") {
        const cur = clip.fadeInDuration ?? 0;
        store.setClipFade(clip.id, "in", Math.max(0, cur + deltaMicros));
      } else {
        const cur = clip.fadeOutDuration ?? 0;
        store.setClipFade(clip.id, "out", Math.max(0, cur - deltaMicros));
      }
      fadeStartX.current = e.clientX;
    },
    [clip.id, clip.fadeInDuration, clip.fadeOutDuration, pixelsPerSecond]
  );

  const onFadeUp = useCallback(
    (e: React.PointerEvent) => {
      isFadeDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  // ── Bottom-right corner stretch handle ─────────────────
  const onStretchDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      isStretchDragging.current = true;
      edgeStartX.current = e.clientX;
      edgeOrigDuration.current = clip.duration;
    },
    [clip.duration]
  );

  const onStretchMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isStretchDragging.current) return;
      const deltaX = e.clientX - edgeStartX.current;
      const deltaMicros = Math.round((deltaX / pixelsPerSecond) * 1_000_000);
      useProjectStore.getState().timeStretchClip(clip.id, edgeOrigDuration.current + deltaMicros);
    },
    [clip.id, pixelsPerSecond]
  );

  const onStretchUp = useCallback(
    (e: React.PointerEvent) => {
      isStretchDragging.current = false;
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

      {/* Fade-in triangle overlay (top-left) — draggable */}
      {fadeInPx > 0 && (
        <svg
          className="absolute top-0 left-0 z-20 h-full cursor-ew-resize"
          style={{ width: Math.max(fadeInPx, 6) }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          onPointerDown={(e) => onFadeDown("in", e)}
          onPointerMove={onFadeMove}
          onPointerUp={onFadeUp}
        >
          <polygon points="0,0 100,100 0,100" fill="rgba(0,0,0,0.5)" />
          <line x1="100" y1="100" x2="0" y2="0" stroke="white" strokeWidth="2" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      {/* Fade-out triangle overlay (top-right) — draggable */}
      {fadeOutPx > 0 && (
        <svg
          className="absolute top-0 right-0 z-20 h-full cursor-ew-resize"
          style={{ width: Math.max(fadeOutPx, 6) }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          onPointerDown={(e) => onFadeDown("out", e)}
          onPointerMove={onFadeMove}
          onPointerUp={onFadeUp}
        >
          <polygon points="100,0 100,100 0,100" fill="rgba(0,0,0,0.5)" />
          <line x1="0" y1="100" x2="100" y2="0" stroke="white" strokeWidth="2" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      {/* Level line (opacity/volume indicator) */}
      <div
        className="pointer-events-none absolute left-0 z-10 w-full border-t border-yellow-400/70"
        style={{ top: `${100 - clipLevel}%` }}
      />

      {/* Level badge / drag tooltip */}
      {(clipLevel !== 100 || levelTooltip !== null) && (
        <span className="absolute right-1 top-0 z-10 text-[8px] tabular-nums text-yellow-400/80">
          {levelTooltip ?? clipLevel}%
        </span>
      )}

      {/* Label + rate badge */}
      <span className="relative z-10 truncate px-1.5 text-[10px] font-medium text-white/80 drop-shadow-sm">
        {label}
        {clip.playbackRate != null && clip.playbackRate !== 1 && (
          <span className="ml-1 rounded bg-white/20 px-0.5 text-[8px] tabular-nums">
            {Math.round(clip.playbackRate * 100)}%
          </span>
        )}
      </span>

      {/* Inspector button (type-specific icon) */}
      <button
        className="absolute right-1 top-1 z-20 rounded p-0.5 text-white/40 transition-colors hover:bg-white/15 hover:text-white"
        aria-label="Clip settings"
        onPointerDown={(e) => {
          e.stopPropagation();
          const store = useProjectStore.getState();
          store.setInspectingClipId(clip.id);
          store.setActiveUISection("inspector");
        }}
      >
        {track?.type === "video" ? <Crop size={12} /> : track?.type === "audio" ? <Volume2 size={12} /> : <Settings size={12} />}
      </button>

      {/* Top-edge level drag handle */}
      <div
        className="absolute left-0 top-0 z-30 h-2.5 w-full cursor-ns-resize"
        onPointerDown={onLevelDown}
        onPointerMove={onLevelMove}
        onPointerUp={onLevelUp}
      />

      {/* Edge trim handles */}
      <div
        className="absolute left-0 top-0 z-20 h-full w-2 cursor-ew-resize"
        onPointerDown={(e) => onEdgeDown("left", e)}
        onPointerMove={onEdgeMove}
        onPointerUp={onEdgeUp}
      />
      <div
        className="absolute right-0 top-0 z-20 w-2 cursor-ew-resize"
        style={{ height: "calc(100% - 10px)" }}
        onPointerDown={(e) => onEdgeDown("right", e)}
        onPointerMove={onEdgeMove}
        onPointerUp={onEdgeUp}
      />

      {/* Bottom-right corner: time-stretch handle */}
      <div
        className="absolute right-0 bottom-0 z-40 h-2.5 w-2.5 cursor-nwse-resize rounded-tl bg-white/20"
        onPointerDown={onStretchDown}
        onPointerMove={onStretchMove}
        onPointerUp={onStretchUp}
      />
    </div>
  );
}
