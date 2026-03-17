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
} from "@/lib/utils/preview-helpers";
import { collectSvgDefs } from "@/lib/utils/svg-filters";
import {
  SkipBack, SkipForward, ChevronLeft, ChevronRight, Play, Pause,
} from "lucide-react";

type PreviewQuality = "Draft" | "Auto" | "Good" | "Best";

const FRAME_MICROS = 16_666;

const QUALITY_STYLES: Record<PreviewQuality, React.CSSProperties> = {
  Draft: { maxWidth: 480, imageRendering: "pixelated" as const },
  Auto: { maxWidth: 720 },
  Good: { maxWidth: 1080 },
  Best: {},
};

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

  // ── Compute crossfade opacity per layer ──────────────────
  const layersWithOpacity = useMemo(() => {
    // Group by track to detect same-track overlaps
    const byTrack = new Map<string, typeof activeVideoLayers>();
    for (const layer of activeVideoLayers) {
      const arr = byTrack.get(layer.track.id) ?? [];
      arr.push(layer);
      byTrack.set(layer.track.id, arr);
    }

    const result: { clip: ClipEvent; track: Track; media: (typeof mediaPool)[number]; opacity: number }[] = [];

    for (const [, layers] of byTrack) {
      if (layers.length === 1) {
        result.push({ ...layers[0], opacity: 1 });
      } else {
        // Two clips overlapping — compute crossfade
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
          result.push({ ...outgoing, opacity: 1 - progress });
          result.push({ ...incoming, opacity: progress });
        } else {
          result.push({ ...outgoing, opacity: 1 });
          result.push({ ...incoming, opacity: 1 });
        }
      }
    }

    return result;
  }, [activeVideoLayers.map((l) => `${l.clip.id}:${l.clip.startTime}`).join(","), playheadPosition]);

  // ── Sync AudioEngine with track state ───────────────────
  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
    for (const layer of activeVideoLayers) {
      const t = layer.track;
      if (audioEngine.hasTrack(t.id)) {
        audioEngine.syncTrackState(t.id, {
          volume: t.opacityOrVolume,
          muted: t.isMuted ?? false,
          solo: t.isSolo ?? false,
          pan: t.audioPan ?? 0,
          clipLevel: layer.clip.level ?? 100,
          reverbWet: t.reverbWet ?? 0,
          reverbRoomSize: t.reverbRoomSize ?? 30,
          delayMs: t.delayMs ?? 0,
          delayFeedback: t.delayFeedback ?? 0,
        });
      }
    }
  }, [masterVolume, activeVideoLayers.length, playheadPosition]);

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

  // ── 60fps FX animation loop (bypasses React state) ──────
  const fxKey = activeEffectClips.map((c) => c.id).join(",");
  const hasTimedFx = activeEffectClips.some((c) => {
    const t = String(c.fxParams?.effectType ?? "none");
    return t === "strobe" || t === "flash" || t === "hue-rotate" || t === "glitch";
  });

  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container) return;

    const applyFilter = (pos: number) => {
      const fxResult = buildFxFilter(activeEffectClips, pos);
      // Combine effect-track FX with per-clip video FX for the top layer
      const topClip = layersWithOpacity[layersWithOpacity.length - 1]?.clip;
      const clipFx = buildVideoClipFilter(topClip);
      const draftBlur = quality === "Draft" ? "blur(1px)" : "";
      const parts = [fxResult.filter !== "none" ? fxResult.filter : "", clipFx, draftBlur].filter(Boolean);
      fxFilterRef.current = parts.join(" ") || "none";

      // Apply glitch transform
      const videos = container.querySelectorAll("video");
      videos.forEach((v) => {
        (v as HTMLElement).style.filter = fxFilterRef.current;
        if (fxResult.glitchTransform) {
          (v as HTMLElement).style.transform = fxResult.glitchTransform;
        }
      });
    };

    if (activeEffectClips.length === 0 && !layersWithOpacity.some((l) => l.clip.fxParams)) {
      // No FX at all — just apply quality blur if needed
      const draftBlur = quality === "Draft" ? "blur(1px)" : "";
      fxFilterRef.current = draftBlur || "none";
      const videos = container.querySelectorAll("video");
      videos.forEach((v) => { (v as HTMLElement).style.filter = fxFilterRef.current; });
      return;
    }

    if (!hasTimedFx || !isPlaying) {
      applyFilter(playheadPosition);
      return;
    }

    // 60fps rAF loop for temporal FX
    const tick = () => {
      const pos = usePlaybackStore.getState().playheadPosition;
      applyFilter(pos);
      fxRafRef.current = requestAnimationFrame(tick);
    };
    fxRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(fxRafRef.current);
  }, [fxKey, hasTimedFx, isPlaying, playheadPosition, quality]);

  // ── SVG defs for advanced FX ────────────────────────────
  const svgDefs = useMemo(
    () => collectSvgDefs(activeEffectClips),
    [fxKey]
  );

  // ── Quality style ───────────────────────────────────────
  const qualityStyle = QUALITY_STYLES[quality];

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

      <div ref={videoContainerRef} className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {/* SVG defs for advanced FX (chromatic aberration, inverted masks) */}
        {svgDefs && (
          <svg className="absolute h-0 w-0" aria-hidden>
            <defs dangerouslySetInnerHTML={{ __html: svgDefs }} />
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
                filter={fxFilterRef.current}
                trackFilter={tFilters.join(" ")}
                panCropStyle={pcResult.style}
                qualityStyle={qualityStyle}
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
