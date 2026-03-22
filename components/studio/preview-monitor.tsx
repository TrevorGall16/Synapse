"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { audioEngine } from "@/lib/audio/audio-engine";
import { PreviewVideoLayer } from "./preview-video-layer";
import { PreviewFxMaskOverlay } from "./preview-fx-mask-overlay";
import type { ClipEvent, Track, MediaPoolItem } from "@/lib/store/types";
import {
  formatTimecode,
  buildFxFilter,
  buildVideoClipFilter,
  buildTextStyle,
  buildPanCropStyle,
  computeTunnelClipPath,
  MICROS_PER_SECOND,
} from "@/lib/utils/preview-helpers";
import { collectSvgDefs, buildFeatheredMask } from "@/lib/utils/svg-filters";
import { SkipBack, SkipForward, ChevronLeft, ChevronRight, Play, Pause } from "lucide-react";

type PreviewQuality = "Draft" | "Auto" | "Good" | "Best";
type ZoomMode = "Fit" | "25%" | "50%" | "100%" | "200%";
const FRAME_MICROS = 16_666;

// Module-level predicate — no React deps, reused in both render scope and rAF closure
function isMasked(c: ClipEvent): boolean {
  const m = c.fxParams?.fxMask as { maskType?: string } | undefined;
  return !!m?.maskType && m.maskType !== "none";
}

export function PreviewMonitor() {
  const [quality, setQuality] = useState<PreviewQuality>("Auto");
  const [zoom, setZoom] = useState<ZoomMode>("Fit");
  const fxRafRef = useRef(0);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const playheadPosition = usePlaybackStore((s) => s.playheadPosition);
  const togglePlayback = usePlaybackStore((s) => s.togglePlayback);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);
  const masterVolume = usePlaybackStore((s) => s.masterVolume);
  const duration = useProjectStore((s) => s.duration);
  const tracks = useProjectStore((s) => s.tracks);
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const projectSettings = useProjectStore((s) => s.projectSettings);
  const aspectRatio = `${projectSettings.width}/${projectSettings.height}`;
  const zoomFactor = zoom === "Fit" ? null : parseFloat(zoom) / 100;
  const canvasStyle: React.CSSProperties = zoomFactor === null
    ? { position: "absolute", inset: 0 }
    : {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: Math.round(projectSettings.width * zoomFactor),
        height: Math.round(projectSettings.height * zoomFactor),
        overflow: "hidden",
      };

  // ── Memoized derived state (prevents redundant work on every 60fps re-render) ──
  const videoTracks = useMemo(() => tracks.filter((t) => t.type === "video"), [tracks]);

  const activeVideoLayers = useMemo(() => {
    const layers: { clip: ClipEvent; track: Track; media: MediaPoolItem }[] = [];
    for (const vt of videoTracks) {
      // Sort so we can detect immediately-adjacent clips (no black-frame gap)
      const sorted = [...vt.clips].sort((a, b) => a.startTime - b.startTime);
      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        const next = sorted[i + 1];
        // Frame-continuity: if the next clip starts within 1 frame of this clip's end,
        // extend the effective end to meet the next clip's start — prevents a black frame
        // at the transition when clips are snapped together.
        const clipEnd = c.startTime + c.duration;
        const gapToNext = next ? next.startTime - clipEnd : Infinity;
        const effectiveEnd = (gapToNext > 0 && gapToNext < FRAME_MICROS) ? next!.startTime : clipEnd;

        if (playheadPosition >= c.startTime && playheadPosition < effectiveEnd) {
          const media = mediaPool.find((m) => m.id === c.sourceId);
          if (media?.previewUrl) layers.push({ clip: c, track: vt, media });
        }
      }
    }
    return layers;
  }, [videoTracks, mediaPool, playheadPosition]);

  const layersWithOpacity = useMemo(() => {
    const result: { clip: ClipEvent; track: Track; media: MediaPoolItem; opacity: number }[] = [];
    const byTrack = new Map<string, typeof activeVideoLayers>();
    for (const layer of activeVideoLayers) {
      const arr = byTrack.get(layer.track.id) ?? [];
      arr.push(layer);
      byTrack.set(layer.track.id, arr);
    }
    for (const [, layers] of byTrack) {
      if (layers.length === 1) { result.push({ ...layers[0], opacity: 1 }); continue; }
      const sorted = [...layers].sort((a, b) => a.clip.startTime - b.clip.startTime);
      const [outgoing, incoming] = [sorted[0], sorted[1]];
      const overlapDuration = (outgoing.clip.startTime + outgoing.clip.duration) - incoming.clip.startTime;
      if (overlapDuration > 0) {
        const progress = Math.max(0, Math.min(1, (playheadPosition - incoming.clip.startTime) / overlapDuration));
        result.push({ ...outgoing, opacity: 1 - progress }, { ...incoming, opacity: progress });
      } else {
        result.push({ ...outgoing, opacity: 1 }, { ...incoming, opacity: 1 });
      }
    }
    return result;
  }, [activeVideoLayers, playheadPosition]);

  const activeTextClips = useMemo(() => {
    const result: ClipEvent[] = [];
    for (const tt of tracks.filter((t) => t.type === "text")) {
      for (const c of tt.clips) {
        if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration) result.push(c);
      }
    }
    return result;
  }, [tracks, playheadPosition]);

  const activeEffectClips = useMemo(() => {
    const result: ClipEvent[] = [];
    for (const et of tracks.filter((t) => t.type === "effect")) {
      for (const c of et.clips) {
        if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration) result.push(c);
      }
    }
    return result;
  }, [tracks, playheadPosition]);

  const maskedEffectClips = useMemo(
    () => activeEffectClips.filter((c) => !c.fxParams?.effectDisabled && isMasked(c)),
    [activeEffectClips]
  );

  // Stable string key — changes when ANY fxParam slider changes, triggering immediate canvas redraw
  const fxKey = useMemo(
    () => activeEffectClips.map((c) => `${c.id}:${JSON.stringify(c.fxParams)}`).join(","),
    [activeEffectClips]
  );

  // ── Audio sync ────────────────────────────────────────────
  const audioSyncKey = useMemo(() => tracks.map((t) =>
    `${t.id}:${t.isMuted}:${t.isSolo}:${t.opacityOrVolume}:${t.audioPan ?? 0}:${t.reverbWet ?? 0}:${t.reverbRoomSize ?? 30}:${t.delayMs ?? 0}:${t.delayFeedback ?? 0}`
  ).join("|"), [tracks]);

  // String key that changes only when active clip boundaries are crossed, not every 60fps tick
  const activeClipLevelKey = useMemo(() => {
    const opacityMap = new Map<string, number>();
    for (const l of layersWithOpacity) opacityMap.set(l.clip.id, l.opacity);
    return tracks.map((t) => {
      for (const c of t.clips) {
        if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration)
          return `${t.id}:${Math.round((c.level ?? 100) * (opacityMap.get(c.id) ?? 1))}`;
      }
      return `${t.id}:none`;
    }).join("|");
  }, [tracks, layersWithOpacity, playheadPosition]);

  useEffect(() => {
    audioEngine.setMasterVolume(masterVolume);
    const opacityMap = new Map<string, number>();
    for (const l of layersWithOpacity) opacityMap.set(l.clip.id, l.opacity);
    for (const t of tracks) {
      if (!audioEngine.hasTrack(t.id)) continue;
      let clipLevel = 100;
      for (const c of t.clips) {
        if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration) {
          clipLevel = (c.level ?? 100) * (opacityMap.get(c.id) ?? 1); break;
        }
      }
      const at = (t.type === "video" ? tracks.find((a) => a.type === "audio" && a.id === t.id.replace("video", "audio")) : null) ?? t;
      audioEngine.syncTrackState(t.id, { volume: at.opacityOrVolume, muted: at.isMuted ?? false, solo: at.isSolo ?? false, pan: at.audioPan ?? 0, clipLevel, reverbWet: at.reverbWet ?? 0, reverbRoomSize: at.reverbRoomSize ?? 30, delayMs: at.delayMs ?? 0, delayFeedback: at.delayFeedback ?? 0 });
    }
  }, [masterVolume, audioSyncKey, activeClipLevelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 60fps FX animation loop ──────────────────────────────
  const hasTimedFx = activeEffectClips.some((c) => ["strobe","flash","hue-rotate","glitch","hypno-tunnel"].includes(String(c.fxParams?.effectType ?? "")));

  // Stable string key for layer FX/panCrop params — avoids rAF restart on unrelated renders
  const layersKey = useMemo(() =>
    layersWithOpacity.map((l) => `${l.clip.id}:${JSON.stringify(l.clip.fxParams)}:${JSON.stringify(l.clip.panCrop)}`).join(","),
  [layersWithOpacity]);

  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container) return;

    const applyFilter = (pos: number) => {
      const freshTracks = useProjectStore.getState().tracks;
      const freshEffects: ClipEvent[] = [];
      for (const et of freshTracks.filter((t) => t.type === "effect")) {
        for (const c of et.clips) {
          if (pos >= c.startTime && pos < c.startTime + c.duration) freshEffects.push(c);
        }
      }
      const unmasked = freshEffects.filter((c) => !isMasked(c));
      const masked = freshEffects.filter(isMasked);

      let combined: string;
      let glitchTransform: string | undefined, mirrorTransform: string | undefined;
      if (quality === "Draft") {
        combined = "blur(1px)";
      } else {
        const fxResult = buildFxFilter(unmasked, pos);
        glitchTransform = fxResult.glitchTransform;
        mirrorTransform = fxResult.mirrorTransform;
        const topClip = layersWithOpacity[layersWithOpacity.length - 1]?.clip;
        const parts = [fxResult.filter !== "none" ? fxResult.filter : "", buildVideoClipFilter(topClip)].filter(Boolean);
        if (fxResult.chromaticId) parts.push(`url(#${fxResult.chromaticId})`);
        if (fxResult.pixelateId) parts.push(`url(#${fxResult.pixelateId})`);
        combined = parts.join(" ") || "none";
      }

      container.querySelectorAll("video").forEach((v) => {
        const el = v as HTMLElement;
        el.style.filter = [combined, el.dataset.trackFilter || ""].filter(Boolean).join(" ") || "none";
        const base = el.dataset.pancropTransform || "";
        const transforms: string[] = base ? [base] : [];
        if (glitchTransform) transforms.push(glitchTransform);
        else if (mirrorTransform) transforms.push(mirrorTransform);
        el.style.transform = transforms.join(" ") || "none";
      });

      // Canvas-based masked FX: draw the topmost video frame into each mask canvas,
      // then apply the CSS filter (blur/hue-rotate/etc.) to the canvas element.
      // Canvases marked [data-fxmask-self-managed] run their own rAF (multi-mask path) — skip them here.
      const topVideo = container.querySelector<HTMLVideoElement>("video:last-of-type");
      const { width: projW, height: projH } = useProjectStore.getState().projectSettings;

      container.querySelectorAll<HTMLCanvasElement>("[data-fxmask-canvas]").forEach((canvas) => {
        // Skip canvases that own their rendering loop (multi-mask Canvas 2D path)
        if (canvas.dataset.fxmaskSelfManaged) return;

        const clipId = canvas.dataset.fxmaskClipid;
        const clip = masked.find((c) => c.id === clipId);
        if (!clip) return;

        // Use project resolution for the canvas so polygon % coords map cleanly to whole pixels.
        // CSS scales the canvas to fill the display area; aspect ratio is already correct.
        if (canvas.width !== projW || canvas.height !== projH) {
          canvas.width = projW;
          canvas.height = projH;
        }
        if (!canvas.width || !canvas.height) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Draw the current video frame
        if (topVideo && topVideo.readyState >= 2) {
          ctx.drawImage(topVideo, 0, 0, canvas.width, canvas.height);
        }

        // Apply the effect as CSS filter on the canvas (works on canvas content, not backdrop)
        const r = buildFxFilter([clip], pos);
        canvas.style.filter = r.filter !== "none" ? r.filter : "none";

        // Ensure clip-path stays in sync with stored value (in case of React re-render)
        const cp = canvas.dataset.fxmaskClippath ?? "";
        if (cp) canvas.style.clipPath = cp;
      });
    };

    applyFilter(playheadPosition);
    if (hasTimedFx && isPlaying) {
      const tick = () => { applyFilter(usePlaybackStore.getState().playheadPosition); fxRafRef.current = requestAnimationFrame(tick); };
      fxRafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(fxRafRef.current);
    }
  }, [fxKey, hasTimedFx, isPlaying, playheadPosition, quality, layersKey]);

  // ── SVG defs ──────────────────────────────────────────────
  const svgDefs = useMemo(() => collectSvgDefs(activeEffectClips), [activeEffectClips]);

  // Stable key for panCrop-only changes — avoids featheredMaskDefs recompute on opacity updates
  const featheredMaskKey = useMemo(() =>
    layersWithOpacity.map((l) => `${l.clip.id}:${JSON.stringify(l.clip.panCrop)}`).join(","),
  [layersWithOpacity]);

  const featheredMaskDefs = useMemo(() => {
    const defs: string[] = [];
    for (const layer of layersWithOpacity) {
      const pc = layer.clip.panCrop;
      if (!pc?.maskType || pc.maskType === "none" || (pc.maskFeather ?? 0) <= 0) continue;
      defs.push(buildFeatheredMask(`feather-mask-${layer.clip.id}`, pc.maskType, {
        x: pc.maskX ?? 50, y: pc.maskY ?? 50, width: pc.maskWidth ?? 100, height: pc.maskHeight ?? 100,
        featherPx: (pc.maskFeather ?? 0) / 100, points: pc.maskPoints, invert: pc.maskInvert,
      }));
    }
    return defs.join("\n");
  }, [featheredMaskKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const combinedSvgDefs = [svgDefs, featheredMaskDefs].filter(Boolean).join("\n");

  const hypnoTunnel = useMemo(() => buildFxFilter(activeEffectClips, playheadPosition).hypnoTunnel ?? undefined, [activeEffectClips, playheadPosition]);
  // tunnelClipPath depends only on mask geometry, not playhead position — use fxKey to avoid per-frame recompute
  const tunnelClipPath = useMemo(() => computeTunnelClipPath(activeEffectClips), [fxKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">Preview</h2>
        <div className="flex items-center gap-2">
          <select value={zoom} onChange={(e) => setZoom(e.target.value as ZoomMode)} aria-label="Preview zoom"
            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60 outline-none transition-colors hover:bg-white/15">
            {(["Fit","25%","50%","100%","200%"] as const).map((z) => <option key={z} value={z} className="text-black">{z}</option>)}
          </select>
          <select value={quality} onChange={(e) => setQuality(e.target.value as PreviewQuality)} aria-label="Preview quality"
            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60 outline-none transition-colors hover:bg-white/15">
            {(["Draft","Auto","Good","Best"] as const).map((q) => <option key={q} value={q} className="text-black">{q}</option>)}
          </select>
        </div>
      </div>

      <div ref={videoContainerRef} data-preview-container className="relative flex-1 overflow-hidden bg-black">
        {combinedSvgDefs && (
          <svg style={{ position: "absolute", width: 0, height: 0, overflow: "visible" }} aria-hidden>
            <defs dangerouslySetInnerHTML={{ __html: combinedSvgDefs }} />
          </svg>
        )}

        {/* Canvas: zoom-controlled. Fit = fills container; pixel modes = exact project dimensions. */}
        <div style={canvasStyle}>
          {layersWithOpacity.length > 0 ? (
            layersWithOpacity.map((layer) => {
              const pcResult = buildPanCropStyle(layer.clip.panCrop, layer.clip.id);
              const t = layer.track;
              const trackIdx = videoTracks.indexOf(t);
              const zIndex = videoTracks.length - trackIdx;
              const tFilters: string[] = [];
              if (t.trackBrightness != null && t.trackBrightness !== 100) tFilters.push(`brightness(${t.trackBrightness / 100})`);
              if (t.trackContrast != null && t.trackContrast !== 100) tFilters.push(`contrast(${t.trackContrast / 100})`);
              if (t.trackSaturate != null && t.trackSaturate !== 100) tFilters.push(`saturate(${t.trackSaturate / 100})`);
              if (t.trackHueRotate != null && t.trackHueRotate !== 0) tFilters.push(`hue-rotate(${t.trackHueRotate}deg)`);
              return (
                <PreviewVideoLayer key={layer.clip.id} media={layer.media} clip={layer.clip} trackId={layer.track.id}
                  opacity={layer.opacity} zIndex={zIndex} trackFilter={tFilters.join(" ")}
                  panCropStyle={pcResult.style} isPlaying={isPlaying} playheadPosition={playheadPosition}
                  aspectRatio={aspectRatio} hypnoTunnel={hypnoTunnel} tunnelClipPath={tunnelClipPath} />
              );
            })
          ) : (
            /* Empty canvas placeholder — exact project size in pixel modes, constrained in Fit */
            <div className="absolute inset-0 flex items-center justify-center">
              {zoomFactor === null
                ? <div className="w-full max-w-lg rounded bg-[#111111]" style={{ aspectRatio }} />
                : <div className="absolute inset-0 rounded bg-[#111111]" />}
            </div>
          )}

          {maskedEffectClips.map((c) => (
            <PreviewFxMaskOverlay key={`fxm-${c.id}`} clip={c} aspectRatio={aspectRatio} zIndex={videoTracks.length + 2} />
          ))}

          {activeTextClips.map((tc) => {
            const result = buildTextStyle(tc, playheadPosition);
            if (!result) return null;
            return <div key={tc.id} className="pointer-events-none absolute inset-0"><span style={result.style}>{result.displayText}</span></div>;
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-1 border-t border-white/10 px-4 py-2">
        <TransportBtn icon={<SkipBack size={14} />} label="Go to start" onClick={() => setPlayhead(0)} />
        <TransportBtn icon={<ChevronLeft size={14} />} label="Prev frame" onClick={() => setPlayhead(playheadPosition - FRAME_MICROS)} />
        <TransportBtn icon={isPlaying ? <Pause size={14} /> : <Play size={14} />} label={isPlaying ? "Pause" : "Play"} onClick={togglePlayback} accent />
        <TransportBtn icon={<ChevronRight size={14} />} label="Next frame" onClick={() => setPlayhead(playheadPosition + FRAME_MICROS)} />
        <TransportBtn icon={<SkipForward size={14} />} label="Go to end" onClick={() => setPlayhead(duration)} />
        <span className="ml-3 text-xs tabular-nums text-white/50">{formatTimecode(playheadPosition)}</span>
      </div>
    </div>
  );
}

function TransportBtn({ icon, label, onClick, accent }: { icon: React.ReactNode; label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label}
      className={`rounded p-1.5 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${accent ? "bg-white/15 text-white hover:bg-white/25" : "text-white/50 hover:bg-white/10 hover:text-white"}`}
    >{icon}</button>
  );
}
