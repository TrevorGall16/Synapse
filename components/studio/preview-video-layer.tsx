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
  /** Crossfade direction — "out" = fading away, "in" = fading in. Undefined outside crossfades. */
  fadeDirection?: "in" | "out";
}

export function PreviewVideoLayer({
  media, clip, trackId, opacity, zIndex, trackFilter, panCropStyle,
  isPlaying, playheadPosition, aspectRatio, hypnoTunnel, tunnelClipPath, isPreroll, fadeDirection,
}: PreviewVideoLayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const connectedRef = useRef(false);

  // Set preservesPitch=false immediately on mount so the decoder stays warm during fade-out.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    (video as HTMLVideoElement & { preservesPitch: boolean }).preservesPitch = false;
    (video as HTMLVideoElement & { mozPreservesPitch?: boolean }).mozPreservesPitch = false;
  }, []);

  // Pre-roll: hint to the browser to prioritize network fetching for the incoming clip
  useEffect(() => {
    if (!isPreroll) return;
    const video = videoRef.current;
    if (!video) return;
    video.setAttribute("fetchpriority", "high");
    video.setAttribute("importance", "high");
  }, [isPreroll]);

  // Connect to AudioEngine once video element mounts.
  // Skipped for pre-roll (silent warmup) and outgoing crossfade layers (audio is already handled
  // by the outgoing clip's existing node; we disconnect it below when fadeDirection="out").
  useEffect(() => {
    const video = videoRef.current;
    if (!video || connectedRef.current || isPreroll || fadeDirection === "out") return;
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
  }, [trackId, isPreroll, fadeDirection]);

  // Outgoing crossfade: mute audio and lock playbackRate=1.0 to prevent browser catch-up frame drops.
  // The connection effect cleanup already handles AudioEngine disconnect when fadeDirection changes.
  useEffect(() => {
    if (fadeDirection !== "out") return;
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = 1.0;
    video.muted = true;
  }, [fadeDirection]);

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

  // Time sync + pitch — active layers only.
  // Outgoing clip: bypass pitch and clamp rate=1.0 to prevent the browser boosting speed to catch up,
  // which causes decode queue spikes visible as dropped frames during the crossfade.
  useEffect(() => {
    if (isPreroll) return;
    const video = videoRef.current;
    if (!video) return;
    const localTime = (playheadPosition - clip.startTime) / MICROS_PER_SECOND;

    if (fadeDirection === "out") {
      // Outgoing clip: freeze at 1.0 — no pitch shifting, no rate adjustment
      video.playbackRate = 1.0;
    } else {
      const pitch = Number(clip.fxParams?.pitch ?? 0);
      const rate = (clip.playbackRate ?? 1) * Math.pow(2, pitch / 12);
      video.playbackRate = Math.max(0.25, Math.min(4, rate));
    }
    (video as HTMLVideoElement & { preservesPitch: boolean }).preservesPitch = false;

    if (!isPlaying) {
      if (Math.abs(video.currentTime - localTime) > 0.05) video.currentTime = localTime;
    } else {
      if (Math.abs(video.currentTime - localTime) > 0.25) video.currentTime = localTime;
    }
  }, [playheadPosition, clip.startTime, clip.playbackRate, clip.fxParams?.pitch, isPlaying, isPreroll, fadeDirection]);

  // Level × crossfade opacity — pre-roll is fully transparent
  const visualOpacity = isPreroll ? 0 : opacity * ((clip.level ?? 100) / 100);
  const isInCrossfade = !!fadeDirection;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        zIndex: isPreroll ? -1 : zIndex,
        opacity: visualOpacity,
        // Promote each video layer to its own GPU compositor layer upfront.
        willChange: isInCrossfade ? "opacity, transform" : "opacity",
        backfaceVisibility: "hidden",
        transform: "translateZ(0)",
      }}
    >
      {/* Aspect wrapper: contain:strict confines layout/paint/composite to this subtree,
          preventing crossfade opacity changes from triggering reflows in surrounding elements.
          overflow:hidden clips the tunnel and video to the display area. */}
      <div
        className="relative h-full max-w-full overflow-hidden"
        style={{
          aspectRatio,
          contain: "strict",
          // Promote aspect wrapper to its own layer during crossfade so the
          // compositor can blend the two decoders without involving the main thread.
          ...(isInCrossfade && { willChange: "opacity, transform", transform: "translateZ(0)" }),
        }}
      >
        <video
          ref={videoRef}
          key={media.id}
          src={media.previewUrl}
          className="absolute inset-0 h-full w-full"
          style={{
            ...panCropStyle,
            // During crossfade: push the video element itself onto a dedicated compositor layer.
            // will-change alone promotes it without altering the panCrop transform value.
            ...(isInCrossfade && { willChange: "opacity, transform" }),
          }}
          data-track-filter={isPreroll ? "" : (trackFilter || "")}
          data-pancrop-transform={isPreroll ? "" : (panCropStyle.transform ?? "")}
          data-clip-opacity={isPreroll ? "0" : String(visualOpacity)}
          playsInline
          preload="auto"
          onPlay={(e) => {
            // Keep decoder active during fade-out — prevents the browser from
            // deprioritizing the outgoing clip's decoder as opacity approaches 0.
            const v = e.currentTarget as HTMLVideoElement & { preservesPitch: boolean };
            v.preservesPitch = false;
          }}
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
