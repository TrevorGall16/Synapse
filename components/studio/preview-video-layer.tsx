"use client";

import { useRef, useEffect } from "react";
import type { ClipEvent, MediaPoolItem } from "@/lib/store/types";
import { MICROS_PER_SECOND, type FxResult } from "@/lib/utils/preview-helpers";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { audioEngine } from "@/lib/audio/audio-engine";

interface PreviewVideoLayerProps {
  media: MediaPoolItem;
  clip: ClipEvent;
  trackId: string;
  opacity: number;
  zIndex: number;
  trackFilter: string;
  panCropStyle: React.CSSProperties;
  isPlaying: boolean;
  playheadPosition: number;
  aspectRatio: string;
  hypnoTunnel?: FxResult["hypnoTunnel"];
  tunnelClipPath?: string;
}

export function PreviewVideoLayer({
  media, clip, trackId, opacity, zIndex, trackFilter, panCropStyle,
  isPlaying, playheadPosition, aspectRatio, hypnoTunnel, tunnelClipPath,
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
    return () => {
      audioEngine.disconnectTrack(trackId);
      connectedRef.current = false;
    };
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
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex, opacity: visualOpacity, willChange: "opacity, transform" }}
    >
      {/* aspect wrapper clips tunnel and video to the display area,
          preventing spill onto pillarbox/letterbox bars */}
      <div className="relative h-full max-w-full overflow-hidden" style={{ aspectRatio }}>
        <video
          ref={videoRef}
          key={media.id}
          src={media.previewUrl}
          className="absolute inset-0 h-full w-full"
          style={panCropStyle}
          data-track-filter={trackFilter || ""}
          data-pancrop-transform={panCropStyle.transform ?? ""}
          playsInline
          preload="auto"
        />

        {/* Hypno-tunnel overlay — circular (border-radius:50%) so rotation shows no corners.
            300%/300% at -100%/-100% offset covers the full 16:9 area at any rotation angle. */}
        {hypnoTunnel && (
          <div
            className="pointer-events-none absolute"
            style={{
              width: "300%", height: "300%", top: "-100%", left: "-100%",
              borderRadius: "50%",
              background: `repeating-radial-gradient(circle at 50% 50%, transparent 0px, transparent ${hypnoTunnel.spacing}px, rgba(255,255,255,${hypnoTunnel.opacity}) ${hypnoTunnel.spacing}px, rgba(255,255,255,${hypnoTunnel.opacity}) ${hypnoTunnel.spacing + hypnoTunnel.width}px)`,
              mixBlendMode: "screen",
              transform: `rotate(${hypnoTunnel.rotation}deg)`,
              clipPath: tunnelClipPath,
            }}
          />
        )}
      </div>
    </div>
  );
}
