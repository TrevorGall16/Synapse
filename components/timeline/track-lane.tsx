"use client";

import { useRef, useCallback } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent, TrackType } from "@/lib/store/types";
import { ClipEventBlock } from "./clip-event";
import { requestAudioPeaks } from "@/lib/utils/media-extractor";

const TYPE_BG: Record<TrackType, string> = {
  video: "bg-blue-500/5",
  audio: "bg-green-500/5",
  effect: "bg-red-500/5",
  text: "bg-yellow-500/5",
};

interface OverlapInfo {
  key: string;
  xPx: number;
  wPx: number;
  outgoingClipId: string;     // clip whose right edge defines overlap end — right handle trims this
  incomingClipId: string;     // clip whose left  edge defines overlap start — left handle trims this
  outgoingDuration: number;   // media duration cap for right handle
  incomingDuration: number;   // media duration cap for left handle
  currentOverlapMicros: number; // current overlap size in micros
}

function getOverlaps(clips: ClipEvent[], pps: number): OverlapInfo[] {
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
  const result: OverlapInfo[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].startTime + sorted[i - 1].duration;
    if (sorted[i].startTime < prevEnd) {
      const overlapStart = sorted[i].startTime;
      const overlapEnd = Math.min(prevEnd, sorted[i].startTime + sorted[i].duration);
      const currentOverlapMicros = overlapEnd - overlapStart;
      result.push({
        key: `${sorted[i - 1].id}-${sorted[i].id}`,
        xPx: (overlapStart / 1_000_000) * pps,
        wPx: Math.max(6, (currentOverlapMicros / 1_000_000) * pps),
        outgoingClipId: sorted[i - 1].id,
        incomingClipId: sorted[i].id,
        outgoingDuration: sorted[i - 1].duration,
        incomingDuration: sorted[i].duration,
        currentOverlapMicros,
      });
    }
  }
  return result;
}

// ── Draggable Crossfade Overlay ───────────────────────────────────────────────
// Left handle: drags to trim the incoming clip's left edge  → expands/shrinks overlap from left
// Right handle: drags to trim the outgoing clip's right edge → expands/shrinks overlap from right
interface CrossfadeOverlayProps {
  overlap: OverlapInfo;
  pixelsPerSecond: number;
}

function CrossfadeOverlay({ overlap, pixelsPerSecond }: CrossfadeOverlayProps) {
  const leftStartX = useRef(0);
  const rightStartX = useRef(0);
  const leftActive = useRef(false);
  const rightActive = useRef(false);
  const snapshotted = useRef(false);

  const onHandleDown = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      if (!snapshotted.current) {
        useProjectStore.getState().snapshotHistory("Adjust Crossfade");
        snapshotted.current = true;
      }
      if (side === "left") { leftActive.current = true; leftStartX.current = e.clientX; }
      else { rightActive.current = true; rightStartX.current = e.clientX; }
    },
    []
  );

  const onHandleMove = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      const maxOverlapMicros = Math.min(overlap.outgoingDuration, overlap.incomingDuration);

      if (side === "left" && leftActive.current) {
        const deltaX = e.clientX - leftStartX.current;
        let deltaMicros = Math.round((deltaX / pixelsPerSecond) * 1_000_000);
        // Left handle grows overlap leftward (negative delta) or shrinks it (positive delta).
        // Cap: can't expand past max, can't shrink below 0.
        const newOverlap = overlap.currentOverlapMicros - deltaMicros;
        if (newOverlap > maxOverlapMicros) deltaMicros = overlap.currentOverlapMicros - maxOverlapMicros;
        if (newOverlap < 0) deltaMicros = overlap.currentOverlapMicros;
        useProjectStore.getState().trimClip(overlap.incomingClipId, "left", deltaMicros);
        leftStartX.current = e.clientX;
      }
      if (side === "right" && rightActive.current) {
        const deltaX = e.clientX - rightStartX.current;
        let deltaMicros = Math.round((deltaX / pixelsPerSecond) * 1_000_000);
        // Right handle grows overlap rightward (positive delta) or shrinks it (negative delta).
        const newOverlap = overlap.currentOverlapMicros + deltaMicros;
        if (newOverlap > maxOverlapMicros) deltaMicros = maxOverlapMicros - overlap.currentOverlapMicros;
        if (newOverlap < 0) deltaMicros = -overlap.currentOverlapMicros;
        useProjectStore.getState().trimClip(overlap.outgoingClipId, "right", deltaMicros);
        rightStartX.current = e.clientX;
      }
    },
    [overlap.incomingClipId, overlap.outgoingClipId, overlap.currentOverlapMicros, overlap.outgoingDuration, overlap.incomingDuration, pixelsPerSecond]
  );

  const onHandleUp = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (side === "left") { leftActive.current = false; }
      else { rightActive.current = false; }
      if (!leftActive.current && !rightActive.current) snapshotted.current = false;
    },
    []
  );

  return (
    <div
      className="pointer-events-none absolute top-0 z-20"
      style={{ left: overlap.xPx, width: overlap.wPx, height: "100%" }}
    >
      {/* X diagonal lines */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="0" y1="0" x2="100" y2="100" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1="100" y1="0" x2="0" y2="100" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>

      {/* Left drag handle — adjusts incoming clip's start */}
      <div
        className="pointer-events-auto absolute left-0 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center"
        onPointerDown={(e) => onHandleDown("left", e)}
        onPointerMove={(e) => onHandleMove("left", e)}
        onPointerUp={(e) => onHandleUp("left", e)}
      >
        <div className="h-[60%] w-0.5 rounded-full bg-white/70 shadow-[0_0_4px_rgba(255,255,255,0.5)]" />
      </div>

      {/* Right drag handle — adjusts outgoing clip's end */}
      <div
        className="pointer-events-auto absolute right-0 top-0 z-10 flex h-full w-3 cursor-ew-resize items-center justify-center"
        onPointerDown={(e) => onHandleDown("right", e)}
        onPointerMove={(e) => onHandleMove("right", e)}
        onPointerUp={(e) => onHandleUp("right", e)}
      >
        <div className="h-[60%] w-0.5 rounded-full bg-white/70 shadow-[0_0_4px_rgba(255,255,255,0.5)]" />
      </div>
    </div>
  );
}

// ── Track Lane ────────────────────────────────────────────────────────────────
interface TrackLaneProps {
  trackId: string;
  trackHeight?: number;
}

export function TrackLane({ trackId, trackHeight: trackHeightProp }: TrackLaneProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const scrollLeft = usePlaybackStore((s) => s.scrollLeft);
  const containerWidth = usePlaybackStore((s) => s.containerWidth);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);

  const track = useProjectStore((s) => s.tracks.find((t) => t.id === trackId));
  const trackHeight = trackHeightProp ?? track?.height ?? 60;

  const startTimeVisible = Math.round((scrollLeft / pixelsPerSecond) * 1_000_000);
  const endTimeVisible = Math.round(((scrollLeft + containerWidth) / pixelsPerSecond) * 1_000_000);

  const positionFromPointer = useCallback(
    (clientX: number) => {
      const el = laneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPlayhead(Math.round(((clientX - rect.left) / pixelsPerSecond) * 1_000_000));
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

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const mediaId = e.dataTransfer.getData("mediaId");
      if (!mediaId) return;

      const { mediaPool, addClip, tracks } = useProjectStore.getState();
      const media = mediaPool.find((m) => m.id === mediaId);
      if (!media) return;

      const currentTrack = tracks.find((t) => t.id === trackId);
      if (!currentTrack) return;

      if (media.type === "video" && currentTrack.type !== "video") return;
      if (media.type === "audio" && currentTrack.type !== "audio") return;

      const rawX = e.nativeEvent.offsetX;
      const startTime = Math.max(0, Math.round((rawX / pixelsPerSecond) * 1_000_000));

      if (media.type === "video" && currentTrack.type === "video") {
        const groupId = crypto.randomUUID();
        addClip(trackId, { id: crypto.randomUUID(), trackId, sourceId: mediaId, groupId, startTime, duration: media.duration, mediaOffset: 0 });
        const audioTrack = useProjectStore.getState().tracks.find((t) => t.type === "audio");
        if (audioTrack) {
          addClip(audioTrack.id, { id: crypto.randomUUID(), trackId: audioTrack.id, sourceId: mediaId, groupId, startTime, duration: media.duration, mediaOffset: 0 });
          if (media.previewUrl) requestAudioPeaks(media.previewUrl, media.id);
        }
      } else {
        addClip(trackId, { id: crypto.randomUUID(), trackId, sourceId: mediaId, startTime, duration: media.duration, mediaOffset: 0 });
        if (media.type === "audio" && media.previewUrl) requestAudioPeaks(media.previewUrl, media.id);
      }
    },
    [trackId, pixelsPerSecond]
  );

  const trackColor = track?.color ?? "#666";
  const isEmpty = !track?.clips.length;
  const overlaps = getOverlaps(track?.clips ?? [], pixelsPerSecond);

  return (
    <div
      ref={laneRef}
      className={`relative shrink-0 cursor-pointer border-b border-white/10 ${TYPE_BG[track?.type ?? "video"]}`}
      style={{ height: trackHeight }}
      data-track={trackId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="select-none text-[10px] tracking-widest text-white/15 uppercase">
            Drag Media Here
          </span>
        </div>
      )}

      {track?.clips.map((clip) => {
        const clipEnd = clip.startTime + clip.duration;
        const isVisible = clipEnd > startTimeVisible && clip.startTime < endTimeVisible;
        if (!isVisible) {
          const xPx = (clip.startTime / 1_000_000) * pixelsPerSecond;
          const wPx = (clip.duration / 1_000_000) * pixelsPerSecond;
          return <div key={clip.id} className="absolute top-0 h-full" style={{ transform: `translate3d(${xPx}px, 0, 0)`, width: wPx }} />;
        }
        return (
          <ClipEventBlock
            key={clip.id}
            clip={clip}
            trackId={trackId}
            pixelsPerSecond={pixelsPerSecond}
            trackColor={trackColor}
            trackHeight={trackHeight}
          />
        );
      })}

      {/* Crossfade X overlays — only shown for real crossfades (>50ms overlap).
          Hard snaps / micro-overlaps show no X since they're treated as clean cuts. */}
      {overlaps.filter((o) => o.currentOverlapMicros > 50_000).map((overlap) => (
        <CrossfadeOverlay key={overlap.key} overlap={overlap} pixelsPerSecond={pixelsPerSecond} />
      ))}
    </div>
  );
}
