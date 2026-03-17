"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { audioEngine } from "@/lib/audio/audio-engine";
import { PreviewVideoLayer } from "./preview-video-layer";
import type { ClipEvent, Track } from "@/lib/store/types";
import {
  formatTimecode,
  buildFxFilter,
  buildVideoClipFilter,
  buildTextStyle,
  buildPanCropStyle,
  MICROS_PER_SECOND,
} from "@/lib/utils/preview-helpers";
import { collectSvgDefs, buildFeatheredMask } from "@/lib/utils/svg-filters";
import {
  SkipBack, SkipForward, ChevronLeft, ChevronRight, Play, Pause,
} from "lucide-react";

type PreviewQuality = "Draft" | "Auto" | "Good" | "Best";

const FRAME_MICROS = 16_666;

// ── PreviewMonitor Component ──────────────────────────────
export function PreviewMonitor() {
  const [quality, setQuality] = useState<PreviewQuality>("Auto");
  const fxRafRef = useRef(0);
  const fxFilterRef = useRef("none");
  const videoContainerRef = useRef<HTMLDivElement>(null);

  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const playheadPosition = usePlaybackStore((s) => s.playheadPosition);
  const togglePlayback = usePlaybackStore((s) => s.togglePlayback);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);
  const masterVolume = usePlaybackStore((s) => s.masterVolume);
  const duration = useProjectStore((s) => s.duration);
  const tracks = useProjectStore((s) => s.tracks);
  const mediaPool = useProjectStore((s) => s.mediaPool);

  // ── Find ALL active video clips (for crossfade) ─────────
  const videoTracks = tracks.filter((t) => t.type === "video");
  const activeVideoLayers: { clip: ClipEvent; track: Track; media: (typeof mediaPool)[number] }[] = [];
  for (const vt of videoTracks) {
    for (const c of vt.clips) {
      if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration) {
        const media = mediaPool.find((m) => m.id === c.sourceId);
        if (media?.previewUrl) {
          activeVideoLayers.push({ clip: c, track: vt, media });
        }
      }
    }
  }

  // ── Compute crossfade opacity per layer (no memo — must see fresh clip data) ──
  const layersWithOpacity: { clip: ClipEvent; track: Track; media: (typeof mediaPool)[number]; opacity: number }[] = [];
  {
    const byTrack = new Map<string, typeof activeVideoLayers>();
    for (const layer of activeVideoLayers) {
      const arr = byTrack.get(layer.track.id) ?? [];
      arr.push(layer);
      byTrack.set(layer.track.id, arr);
    }
    for (const [, layers] of byTrack) {
      if (layers.length === 1) {
        layersWithOpacity.push({ ...layers[0], opacity: 1 });
      } else {
        const sorted = [...layers].sort((a, b) => a.clip.startTime - b.clip.startTime);
        const outgoing = sorted[0];
        const incoming = sorted[1];
        const overlapStart = incoming.clip.startTime;
        const overlapEnd = outgoing.clip.startTime + outgoing.clip.duration;
        const overlapDuration = overlapEnd - overlapStart;
        if (overlapDuration > 0) {
          const progress = Math.max(0, Math.min(1,
            (playheadPosition - overlapStart) / overlapDuration
          ));
          layersWithOpacity.push({ ...outgoing, opacity: 1 - progress });
          layersWithOpacity.push({ ...incoming, opacity: progress });
        } else {
          layersWithOpacity.push({ ...outgoing, opacity: 1 });
          layersWithOpacity.push({ ...incoming, opacity: 1 });
        }
      }
    }
  }

  // ── Sync AudioEngine with track state ───────────────────
  // Build a key that captures ALL audio-relevant track state so changes trigger sync
  const audioSyncKey = tracks.map((t) =>
    `${t.id}:${t.isMuted}:${t.isSolo}:${t.opacityOrVolume}:${t.audioPan ?? 0}:${t.reverbWet ?? 0}:${t.reverbRoomSize ?? 30}:${t.delayMs ?? 0}:${t.delayFeedback ?? 0}`
  ).join("|");

  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
    // Build opacity map from crossfade layers for audio ducking
    const opacityMap = new Map<string, number>();
    for (const l of layersWithOpacity) opacityMap.set(l.clip.id, l.opacity);

    // Sync ALL tracks that have audio chains (video+audio tracks)
    for (const t of tracks) {
      if (!audioEngine.hasTrack(t.id)) continue;
      // Find the active clip level for this track (use first active clip, else 100)
      let clipLevel = 100;
      for (const c of t.clips) {
        if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration) {
          clipLevel = (c.level ?? 100) * (opacityMap.get(c.id) ?? 1);
          break;
        }
      }
      audioEngine.syncTrackState(t.id, {
        volume: t.opacityOrVolume,
        muted: t.isMuted ?? false,
        solo: t.isSolo ?? false,
        pan: t.audioPan ?? 0,
        clipLevel,
        reverbWet: t.reverbWet ?? 0,
        reverbRoomSize: t.reverbRoomSize ?? 30,
        delayMs: t.delayMs ?? 0,
        delayFeedback: t.delayFeedback ?? 0,
      });
    }
  }, [masterVolume, audioSyncKey, playheadPosition]);

  // ── Collect active text clips ───────────────────────────
  const textTracks = tracks.filter((t) => t.type === "text");
  const activeTextClips: ClipEvent[] = [];
  for (const tt of textTracks) {
    for (const c of tt.clips) {
      if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration) {
        activeTextClips.push(c);
      }
    }
  }

  // ── Collect active effect clips ─────────────────────────
  const effectTracks = tracks.filter((t) => t.type === "effect");
  const activeEffectClips: ClipEvent[] = [];
  for (const et of effectTracks) {
    for (const c of et.clips) {
      if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration) {
        activeEffectClips.push(c);
      }
    }
  }

  // ── 60fps FX animation loop (direct DOM writes, bypasses React) ──
  const fxKey = activeEffectClips.map((c) => c.id).join(",");
  const hasTimedFx = activeEffectClips.some((c) => {
    const t = String(c.fxParams?.effectType ?? "none");
    return t === "strobe" || t === "flash" || t === "hue-rotate" || t === "glitch" || t === "hypno-tunnel";
  });

  // Apply FX via direct DOM manipulation — NOT via React style props.
  // This prevents React re-renders from overwriting 60fps filter updates.
  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container) return;

    const applyFilter = (pos: number) => {
      // Read fresh effect clips from store (closure may be stale during rAF)
      const freshTracks = useProjectStore.getState().tracks;
      const freshEffects: ClipEvent[] = [];
      for (const et of freshTracks.filter((t) => t.type === "effect")) {
        for (const c of et.clips) {
          if (pos >= c.startTime && pos < c.startTime + c.duration) {
            freshEffects.push(c);
          }
        }
      }

      // Draft mode: skip expensive FX pipeline, just apply blur
      let combined: string;
      let glitchTransform: string | undefined;
      let mirrorTransform: string | undefined;
      if (quality === "Draft") {
        combined = "blur(1px)";
      } else {
        const fxResult = buildFxFilter(freshEffects, pos);
        glitchTransform = fxResult.glitchTransform;
        mirrorTransform = fxResult.mirrorTransform;
        const topClip = layersWithOpacity[layersWithOpacity.length - 1]?.clip;
        const clipFx = buildVideoClipFilter(topClip);
        const parts = [fxResult.filter !== "none" ? fxResult.filter : "", clipFx].filter(Boolean);
        combined = parts.join(" ") || "none";
      }

      const videos = container.querySelectorAll("video");
      videos.forEach((v) => {
        const el = v as HTMLElement;
        // Merge our FX filter with existing trackFilter (from data attr)
        const trackF = el.dataset.trackFilter || "";
        el.style.filter = [combined, trackF].filter(Boolean).join(" ") || "none";
        // Build transform: panCrop base → mirror → glitch
        const base = el.dataset.pancropTransform || "";
        if (glitchTransform) {
          el.style.transform = [base, glitchTransform].filter(Boolean).join(" ");
        } else if (mirrorTransform) {
          el.style.transform = [base, mirrorTransform].filter(Boolean).join(" ");
        } else {
          el.style.transform = base;
        }
      });
    };

    // Always apply once for the current frame (covers paused state + static FX)
    applyFilter(playheadPosition);

    // If temporal FX are active and playing, run a high-freq rAF loop
    if (hasTimedFx && isPlaying) {
      const tick = () => {
        const pos = usePlaybackStore.getState().playheadPosition;
        applyFilter(pos);
        fxRafRef.current = requestAnimationFrame(tick);
      };
      fxRafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(fxRafRef.current);
    }
  }, [fxKey, hasTimedFx, isPlaying, playheadPosition, quality,
      layersWithOpacity.map((l) => `${l.clip.id}:${JSON.stringify(l.clip.fxParams)}:${JSON.stringify(l.clip.panCrop)}`).join(",")]);

  // ── SVG defs for advanced FX + feathered masks ─────────
  const featheredMaskDefs = useMemo(() => {
    const defs: string[] = [];
    for (const layer of layersWithOpacity) {
      const pc = layer.clip.panCrop;
      if (!pc || !pc.maskType || pc.maskType === "none") continue;
      const feather = pc.maskFeather ?? 0;
      if (feather <= 0) continue;
      const maskId = `feather-mask-${layer.clip.id}`;
      defs.push(buildFeatheredMask(maskId, pc.maskType, {
        x: pc.maskX ?? (pc.maskType === "rect" ? (pc.maskX ?? 50) - (pc.maskWidth ?? 100) / 2 : 0),
        y: pc.maskY ?? (pc.maskType === "rect" ? (pc.maskY ?? 50) - (pc.maskHeight ?? 100) / 2 : 0),
        width: pc.maskWidth ?? 100,
        height: pc.maskHeight ?? 100,
        featherPx: feather / 100,
        points: pc.maskPoints,
        invert: pc.maskInvert,
      }));
    }
    return defs.join("\n");
  }, [layersWithOpacity.map((l) => `${l.clip.id}:${JSON.stringify(l.clip.panCrop)}`).join(",")]);

  const svgDefs = useMemo(
    () => collectSvgDefs(activeEffectClips),
    [fxKey]
  );
  const combinedSvgDefs = [svgDefs, featheredMaskDefs].filter(Boolean).join("\n");

  // ── Compute hypno-tunnel overlay for active effects ────
  const hypnoOverlay = useMemo(() => {
    for (const c of activeEffectClips) {
      if (c.fxParams?.effectDisabled) continue;
      if (String(c.fxParams?.effectType) === "hypno-tunnel") {
        const intensity = (Number(c.fxParams?.intensity ?? 50) / 100) * ((c.level ?? 100) / 100);
        const speed = Number(c.fxParams?.speed ?? 50);
        const elapsed = (playheadPosition - c.startTime) / MICROS_PER_SECOND;
        const spacing = Math.sin(elapsed * speed * 0.1) * 20 + 30;
        const ringWidth = 8 * intensity;
        return { spacing, width: ringWidth, intensity };
      }
    }
    return null;
  }, [activeEffectClips, playheadPosition]);

  return (
    <div className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">Preview</h2>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as PreviewQuality)}
          aria-label="Preview quality"
          className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60 outline-none transition-colors hover:bg-white/15 focus-visible:ring-1 focus-visible:ring-white/40"
        >
          <option value="Draft" className="text-black">Draft</option>
          <option value="Auto" className="text-black">Auto</option>
          <option value="Good" className="text-black">Good</option>
          <option value="Best" className="text-black">Best</option>
        </select>
      </div>

      <div ref={videoContainerRef} className="flex flex-1 items-center justify-center overflow-hidden bg-black">
        {/* SVG defs for advanced FX (chromatic aberration, inverted masks, feathered masks) */}
        {combinedSvgDefs && (
          <svg className="absolute h-0 w-0" aria-hidden>
            <defs dangerouslySetInnerHTML={{ __html: combinedSvgDefs }} />
          </svg>
        )}

        {/* Video layers with crossfade */}
        {layersWithOpacity.length > 0 ? (
          layersWithOpacity.map((layer) => {
            const pcResult = buildPanCropStyle(layer.clip.panCrop, layer.clip.id);
            const t = layer.track;
            const tFilters: string[] = [];
            if (t.trackBrightness != null && t.trackBrightness !== 100) tFilters.push(`brightness(${t.trackBrightness / 100})`);
            if (t.trackContrast != null && t.trackContrast !== 100) tFilters.push(`contrast(${t.trackContrast / 100})`);
            if (t.trackSaturate != null && t.trackSaturate !== 100) tFilters.push(`saturate(${t.trackSaturate / 100})`);
            if (t.trackHueRotate != null && t.trackHueRotate !== 0) tFilters.push(`hue-rotate(${t.trackHueRotate}deg)`);
            return (
              <PreviewVideoLayer
                key={layer.clip.id}
                media={layer.media}
                clip={layer.clip}
                trackId={layer.track.id}
                opacity={layer.opacity}
                trackFilter={tFilters.join(" ")}
                panCropStyle={pcResult.style}
                isPlaying={isPlaying}
                playheadPosition={playheadPosition}
              />
            );
          })
        ) : (
          <div className="aspect-video w-full max-w-lg rounded bg-[#111111]" />
        )}

        {/* Text clip overlays */}
        {activeTextClips.map((tc) => {
          const result = buildTextStyle(tc, playheadPosition);
          if (!result) return null;
          return (
            <div key={tc.id} className="pointer-events-none absolute inset-0">
              <span style={result.style}>{result.displayText}</span>
            </div>
          );
        })}

        {/* Hypno-tunnel overlay */}
        {hypnoOverlay && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `repeating-radial-gradient(circle at 50% 50%, transparent 0px, transparent ${hypnoOverlay.spacing}px, rgba(0,0,0,${hypnoOverlay.intensity}) ${hypnoOverlay.spacing}px, rgba(0,0,0,${hypnoOverlay.intensity}) ${hypnoOverlay.spacing + hypnoOverlay.width}px)`,
              mixBlendMode: "multiply",
            }}
          />
        )}
      </div>

      {/* Transport toolbar */}
      <div className="flex shrink-0 items-center justify-center gap-1 border-t border-white/10 px-4 py-2">
        <TransportButton icon={<SkipBack size={14} />} label="Go to start" onClick={() => setPlayhead(0)} />
        <TransportButton icon={<ChevronLeft size={14} />} label="Previous frame" onClick={() => setPlayhead(playheadPosition - FRAME_MICROS)} />
        <TransportButton icon={isPlaying ? <Pause size={14} /> : <Play size={14} />} label={isPlaying ? "Pause" : "Play"} onClick={togglePlayback} accent />
        <TransportButton icon={<ChevronRight size={14} />} label="Next frame" onClick={() => setPlayhead(playheadPosition + FRAME_MICROS)} />
        <TransportButton icon={<SkipForward size={14} />} label="Go to end" onClick={() => setPlayhead(duration)} />
        <span className="ml-3 text-xs tabular-nums text-white/50">{formatTimecode(playheadPosition)}</span>
      </div>
    </div>
  );
}

function TransportButton({ icon, label, onClick, accent }: {
  icon: React.ReactNode; label: string; onClick: () => void; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick} aria-label={label}
      className={`rounded p-1.5 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
        accent ? "bg-white/15 text-white hover:bg-white/25" : "text-white/50 hover:bg-white/10 hover:text-white"
      }`}
    >{icon}</button>
  );
}
