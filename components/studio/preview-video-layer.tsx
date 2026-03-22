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
  /** Pre-roll: renders hidden to warm the decoder 500ms before the clip enters the crossfade window. */
  isPreroll?: boolean;
}

export function PreviewVideoLayer({
  media, clip, trackId, opacity, zIndex, trackFilter, panCropStyle,
  isPlaying, playheadPosition, aspectRatio, hypnoTunnel, tunnelClipPath, isPreroll,
}: PreviewVideoLayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const connectedRef = useRef(false);

  // Connect to AudioEngine once video element mounts — skipped for pre-roll (silent warmup)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || connectedRef.current || isPreroll) return;
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
  }, [trackId, isPreroll]);

  // Pre-roll: seek to clip entry point and play muted to fill the decoder's frame buffer
  useEffect(() => {
    if (!isPreroll) return;
    const video = videoRef.current;
    if (!video) return;
    const startSecs = clip.mediaOffset / MICROS_PER_SECOND;
    if (Math.abs(video.currentTime - startSecs) > 0.1) video.currentTime = startSecs;
    video.muted = true;
    video.play().catch(() => {});
  }, [isPreroll, clip.mediaOffset]);

  // Play/pause sync — active layers only
  useEffect(() => {
    if (isPreroll) return;
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, isPreroll]);

  // Time sync + pitch — active layers only
  useEffect(() => {
    if (isPreroll) return;
    const video = videoRef.current;
    if (!video) return;
    const localTime = (playheadPosition - clip.startTime) / MICROS_PER_SECOND;

    const pitch = Number(clip.fxParams?.pitch ?? 0);
    const rate = (clip.playbackRate ?? 1) * Math.pow(2, pitch / 12);
    video.playbackRate = Math.max(0.25, Math.min(4, rate));
    (video as HTMLVideoElement & { preservesPitch: boolean }).preservesPitch = false;

    if (!isPlaying) {
      if (Math.abs(video.currentTime - localTime) > 0.05) video.currentTime = localTime;
    } else {
      if (Math.abs(video.currentTime - localTime) > 0.25) video.currentTime = localTime;
    }
  }, [playheadPosition, clip.startTime, clip.playbackRate, clip.fxParams?.pitch, isPlaying, isPreroll]);

  // Level × crossfade opacity — pre-roll is fully transparent
  const visualOpacity = isPreroll ? 0 : opacity * ((clip.level ?? 100) / 100);

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        zIndex: isPreroll ? -1 : zIndex,
        opacity: visualOpacity,
        // Promote each video layer to its own GPU compositor layer upfront.
        // This prevents the mid-crossfade promotion stutter that causes the FPS drop.
        willChange: "opacity",
        backfaceVisibility: "hidden",
        transform: "translateZ(0)",
      }}
    >
      {/* Aspect wrapper clips tunnel and video to the display area,
          preventing spill onto pillarbox/letterbox bars */}
      <div className="relative h-full max-w-full overflow-hidden" style={{ aspectRatio }}>
        <video
          ref={videoRef}
          key={media.id}
          src={media.previewUrl}
          className="absolute inset-0 h-full w-full"
          style={panCropStyle}
          data-track-filter={isPreroll ? "" : (trackFilter || "")}
          data-pancrop-transform={isPreroll ? "" : (panCropStyle.transform ?? "")}
          playsInline
          preload="auto"
        />

        {/* Hypno-tunnel overlay — only on active (non-preroll) layers */}
        {!isPreroll && hypnoTunnel && (
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
