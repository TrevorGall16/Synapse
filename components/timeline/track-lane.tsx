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

interface TrackLaneProps {
  trackId: string;
}

export function TrackLane({ trackId }: TrackLaneProps) {
  const laneRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const scrollLeft = usePlaybackStore((s) => s.scrollLeft);
  const containerWidth = usePlaybackStore((s) => s.containerWidth);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);

  const track = useProjectStore((s) => s.tracks.find((t) => t.id === trackId));
  const trackHeight = track?.height ?? 60;

  // ── Viewport math ──────────────────────────────────────
  const startTimeVisible = Math.round((scrollLeft / pixelsPerSecond) * 1_000_000);
  const endTimeVisible = Math.round(((scrollLeft + containerWidth) / pixelsPerSecond) * 1_000_000);

  // ── Playhead scrub via pointer ─────────────────────────
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

  // ── Drop handler ───────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

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

      // Strict type validation
      if (media.type === "video" && currentTrack.type !== "video") return;
      if (media.type === "audio" && currentTrack.type !== "audio") return;

      const rawX = e.nativeEvent.offsetX;
      const startTime = Math.max(0, Math.round((rawX / pixelsPerSecond) * 1_000_000));

      if (media.type === "video" && currentTrack.type === "video") {
        // Linked A/V generation with shared groupId
        const groupId = crypto.randomUUID();

        const videoClip: ClipEvent = {
          id: crypto.randomUUID(),
          trackId,
          sourceId: mediaId,
          groupId,
          startTime,
          duration: media.duration,
          mediaOffset: 0,
        };
        addClip(trackId, videoClip);

        const audioTrack = useProjectStore.getState().tracks.find((t) => t.type === "audio");
        if (audioTrack) {
          const audioClip: ClipEvent = {
            id: crypto.randomUUID(),
            trackId: audioTrack.id,
            sourceId: mediaId,
            groupId,
            startTime,
            duration: media.duration,
            mediaOffset: 0,
          };
          addClip(audioTrack.id, audioClip);

          // Trigger off-thread peak extraction
          if (media.previewUrl) {
            requestAudioPeaks(media.previewUrl, media.id);
          }
        }
      } else {
        const clip: ClipEvent = {
          id: crypto.randomUUID(),
          trackId,
          sourceId: mediaId,
          startTime,
          duration: media.duration,
          mediaOffset: 0,
        };
        addClip(trackId, clip);

        // Trigger peak extraction for audio-only drops
        if (media.type === "audio" && media.previewUrl) {
          requestAudioPeaks(media.previewUrl, media.id);
        }
      }
    },
    [trackId, pixelsPerSecond]
  );

  const trackColor = track?.color ?? "#666";

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
      {track?.clips.map((clip) => {
        const clipEnd = clip.startTime + clip.duration;
        const isVisible = clipEnd > startTimeVisible && clip.startTime < endTimeVisible;

        if (!isVisible) {
          // Lightweight placeholder — holds position, no heavy children
          const xPx = (clip.startTime / 1_000_000) * pixelsPerSecond;
          const wPx = (clip.duration / 1_000_000) * pixelsPerSecond;
          return (
            <div
              key={clip.id}
              className="absolute top-0 h-full"
              style={{
                transform: `translate3d(${xPx}px, 0, 0)`,
                width: wPx,
              }}
            />
          );
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
    </div>
  );
}
