"use client";

import { useRef, useEffect } from "react";
import type { ClipEvent, MediaPoolItem } from "@/lib/store/types";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { audioEngine } from "@/lib/audio/audio-engine";

const MICROS_PER_SECOND = 1_000_000;

interface PreviewVideoLayerProps {
  media: MediaPoolItem;
  clip: ClipEvent;
  trackId: string;
  opacity: number;
  filter: string;
  trackFilter: string;
  panCropStyle: React.CSSProperties;
  qualityStyle: React.CSSProperties;
  isPlaying: boolean;
  playheadPosition: number;
}

export function PreviewVideoLayer({
  media, clip, trackId, opacity, filter, trackFilter, panCropStyle,
  qualityStyle, isPlaying, playheadPosition,
}: PreviewVideoLayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const connectedRef = useRef(false);

  // Connect to AudioEngine once video element mounts
  useEffect(() => {
    const video = videoRef.current;
    if (!video || connectedRef.current) return;
    audioEngine.init();
    audioEngine.ensureResumed();
    if (!audioEngine.hasTrack(trackId)) {
      audioEngine.connectSource(trackId, video);
    }
    connectedRef.current = true;
  }, [trackId]);

  // Play/pause sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying]);

  // Time sync + pitch
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const localTime = (playheadPosition - clip.startTime) / MICROS_PER_SECOND;

    // Pitch: convert semitones to playbackRate
    const pitch = Number(clip.fxParams?.pitch ?? 0);
    const rate = (clip.playbackRate ?? 1) * Math.pow(2, pitch / 12);
    video.playbackRate = Math.max(0.25, Math.min(4, rate));
    (video as HTMLVideoElement & { preservesPitch: boolean }).preservesPitch = false;

    if (!isPlaying) {
      if (Math.abs(video.currentTime - localTime) > 0.05) video.currentTime = localTime;
    } else {
      if (Math.abs(video.currentTime - localTime) > 0.25) video.currentTime = localTime;
    }
  }, [playheadPosition, clip.startTime, clip.playbackRate, clip.fxParams?.pitch, isPlaying]);

  // Level → opacity binding: visual opacity = crossfade opacity × clip level
  const visualOpacity = opacity * ((clip.level ?? 100) / 100);

  return (
    <video
      ref={videoRef}
      key={media.id}
      src={media.previewUrl}
      className="absolute inset-0 h-full w-full object-contain"
      style={{
        filter: [filter, trackFilter].filter(Boolean).join(" ") || undefined,
        opacity: visualOpacity,
        ...panCropStyle,
        ...qualityStyle,
      }}
      playsInline
      preload="auto"
    />
  );
}
