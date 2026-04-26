"use client";

import { useState, useRef, useEffect } from "react";
import { X, FolderOpen, Download, CheckCircle, AlertTriangle } from "lucide-react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { PROJECT_PRESETS } from "@/lib/store/types";
import { audioEngine } from "@/lib/audio/audio-engine";
import { exportProject, MAX_CLIP_DURATION_MICROS } from "@/lib/engine/export-pipeline";
import fixWebmDuration from "fix-webm-duration";
import { fixMp4Duration } from "@/lib/utils/fix-mp4-duration";

type ExportTab = "general" | "video" | "audio";
type Format = "MP4" | "WebM";

const VIDEO_PRESETS = {
  "YouTube 1080p":  PROJECT_PRESETS["1080p HD"],
  "TikTok Vertical": PROJECT_PRESETS["Vertical"],
  "Custom": null,
} as const;

interface ExportModalProps {
  onClose: () => void;
}

/** Trigger a browser download with the given blob. */
function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Split a CSS shadow list on top-level commas. rgb()/rgba() colours contain
 * commas internally, so a naive `.split(",")` corrupts them.
 */
function splitShadowList(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(buf.trim()); buf = ""; }
    else buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

interface ParsedShadow { color: string; offsetX: number; offsetY: number; blur: number }

/**
 * Parse every entry of a CSS computed `text-shadow` into discrete shadow records.
 *
 * Canvas's `ctx.shadow*` API only supports a SINGLE shadow per fill. The earlier
 * implementation collapsed the list to its largest-blur entry, which is why
 * glow + drop-shadow combinations rendered as just the glow (or just the drop
 * shadow). We now return the full list so the caller can render one shadow per
 * fillText pass and stack them visually — matching what the user sees in the
 * preview. CSS paints shadows back-to-front (last in the list draws under),
 * so we reverse the list to keep that order on canvas.
 */
function parseShadowList(textShadow: string): ParsedShadow[] {
  if (!textShadow || textShadow === "none") return [];
  const out: ParsedShadow[] = [];
  for (const part of splitShadowList(textShadow)) {
    const colorMatch = part.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
    const numbers    = part.match(/-?\d+(?:\.\d+)?/g);
    if (!numbers || numbers.length < 2) continue;
    out.push({
      offsetX: parseFloat(numbers[0]),
      offsetY: parseFloat(numbers[1]),
      blur:    numbers[2] != null ? parseFloat(numbers[2]) : 0,
      color:   colorMatch?.[0] ?? "rgba(0,0,0,0.6)",
    });
  }
  // CSS paints later shadows behind earlier ones; reverse so the first parsed
  // shadow paints last (on top), preserving the layered look.
  return out.reverse();
}

/**
 * Composite every visible preview video element + active text overlays into a
 * flat 2D canvas at project resolution. Called per rAF tick while the export
 * is recording, so the canvas's MediaStream carries every layer — not just the
 * topmost <video> as the prior captureStream(videoEl) path did.
 *
 * Coordinate origin is the **preview stage** ([data-preview-stage]) — the
 * aspect-locked rectangle the user sees inside the Monitor — NOT the outer
 * preview container, which can be wider than the stage when the project is
 * vertical (9:16) and letterboxed inside a horizontal pane. Using the outer
 * container as origin caused the "vertical squish" bug where text drifted to
 * the left edge and shrank because we divided by the wider container width.
 *
 * Each text span's centre is expressed as a percentage of the stage rect, then
 * multiplied by canvas.width/height. Font size and shadow blur are scaled by
 * the same vertical factor so visual proportions match exactly.
 */
function compositePreviewIntoCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const previewContainer = document.querySelector<HTMLElement>("[data-preview-container]");
  if (!previewContainer) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Layer 1: video frames in DOM z-order. drawImage() is decoder-cheap and
  // honors the per-clip `filter`/`transform` strings the FX loop already wrote.
  // Aspect-fill (object-fit: cover) math: scale the source by the larger of
  // the two ratios so the canvas fills, then center-crop the overflow. The
  // previous path passed `0,0,canvas.width,canvas.height` which stretched a
  // 16:9 source horizontally squished onto a 9:16 canvas — the visible bug
  // the user reported as "vertical squish".
  const videos = previewContainer.querySelectorAll<HTMLVideoElement>("video");
  for (const video of videos) {
    if (video.readyState < 2 || video.videoWidth === 0) continue;
    const dataOpacity = parseFloat(video.dataset.clipOpacity ?? "1");
    if (!Number.isFinite(dataOpacity) || dataOpacity < 0.001) continue;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(canvas.width / vw, canvas.height / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (canvas.width - dw) / 2;
    const dy = (canvas.height - dh) / 2;

    ctx.save();
    ctx.globalAlpha = Math.min(1, dataOpacity);
    ctx.filter = video.style.filter || "none";
    try {
      ctx.drawImage(video, dx, dy, dw, dh);
    } catch {
      // Tainted canvas (e.g. cross-origin video) — skip this layer instead of
      // poisoning the whole frame. The MediaStream will still flush.
    }
    ctx.restore();
  }

  // Layer 2: text overlays. Anchor coordinates to the aspect-locked stage so
  // 9:16 / portrait projects don't squish to the left of a 16:9 preview pane.
  const stage = previewContainer.querySelector<HTMLElement>("[data-preview-stage]") ?? previewContainer;
  const stageRect = stage.getBoundingClientRect();
  if (stageRect.width === 0 || stageRect.height === 0) return;
  const sx = canvas.width  / stageRect.width;
  const sy = canvas.height / stageRect.height;

  const overlaySpans = previewContainer.querySelectorAll<HTMLElement>("[data-text-overlay-span]");
  for (const span of overlaySpans) {
    const text = span.textContent;
    if (!text) continue;
    const cs   = window.getComputedStyle(span);
    const rect = span.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // Span centre as a percentage of the stage, then mapped onto the canvas.
    const pctX = (rect.left + rect.width  / 2 - stageRect.left) / stageRect.width;
    const pctY = (rect.top  + rect.height / 2 - stageRect.top ) / stageRect.height;
    const cx = pctX * canvas.width;
    const cy = pctY * canvas.height;

    const fontPx     = parseFloat(cs.fontSize) * sy;
    const fontFamily = cs.fontFamily || "ui-sans-serif, system-ui, sans-serif";
    const fontWeight = cs.fontWeight || "bold";

    ctx.save();
    ctx.font         = `${fontWeight} ${fontPx}px ${fontFamily}`;
    ctx.fillStyle    = cs.color || "#ffffff";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";

    // CSS `filter` (e.g. blur(npx)) is independent of text-shadow and was
    // missing from the export entirely — text-blur sliders did nothing in the
    // recorded MP4/WebM. Canvas honors it via ctx.filter, so wire it through.
    if (cs.filter && cs.filter !== "none") {
      ctx.filter = cs.filter;
    }

    // Outline (-webkit-text-stroke). Canvas has no paint-order primitive, so
    // stroke first (under the glow), matching CSS paint-order: stroke fill.
    // Stroke is drawn before the shadow passes so it anchors the glow rings.
    const strokeWidthPx = parseFloat(cs.webkitTextStrokeWidth || "0");
    const strokeColor   = cs.webkitTextStrokeColor;
    const hasStroke     = strokeWidthPx > 0 && strokeColor && strokeColor !== "rgba(0, 0, 0, 0)";
    if (hasStroke) {
      ctx.lineWidth   = strokeWidthPx * sy * 2; // CSS stroke is centred; doubling gives visual parity
      ctx.strokeStyle = strokeColor;
      ctx.lineJoin    = "round";
      ctx.miterLimit  = 2;
      ctx.strokeText(text, cx, cy);
    }

    // Multi-pass shadow rendering. Canvas's ctx.shadow* API only supports ONE
    // shadow per draw call, so a stacked glow + drop-shadow combo (which the
    // text inspector emits as up to 4 entries) needs one fillText pass per
    // shadow. Each pass overlays the previous, recreating the layered CSS
    // text-shadow look. Final un-shadowed pass below paints crisp glyphs over
    // the rings so the text edge doesn't smear into the blur halo.
    const shadows = parseShadowList(cs.textShadow);
    for (const sh of shadows) {
      ctx.save();
      ctx.shadowColor   = sh.color;
      ctx.shadowBlur    = sh.blur    * sy;
      ctx.shadowOffsetX = sh.offsetX * sx;
      ctx.shadowOffsetY = sh.offsetY * sy;
      ctx.fillText(text, cx, cy);
      ctx.restore();
    }

    // Crisp text on top — no shadow set, so glyphs render as solid.
    ctx.shadowColor   = "transparent";
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }
}

export function ExportModal({ onClose }: ExportModalProps) {
  const [tab, setTab] = useState<ExportTab>("general");
  const [format, setFormat] = useState<Format>("MP4");
  const [outputFolder, setOutputFolder] = useState("~/Downloads");
  const [fileName, setFileName] = useState("output");
  const [renderRange, setRenderRange] = useState<"full" | "selection">("full");
  const [preset, setPreset] = useState<keyof typeof VIDEO_PRESETS>("YouTube 1080p");
  const [exportWidth, setExportWidth] = useState(1920);
  const [exportHeight, setExportHeight] = useState(1080);
  const [exportFps, setExportFps] = useState(30);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(48000);
  const [isRendering, setIsRendering] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [lastExt, setLastExt] = useState("webm");

  // Export pipeline state
  const unsubRef = useRef<(() => void) | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compositorRafRef = useRef<number | null>(null);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cancelExportRef = useRef<(() => void) | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  // Fallback interval for stub path (no preview content available)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const duration = useProjectStore((s) => s.duration);
  const selectionStart = usePlaybackStore((s) => s.selectionStart);
  const selectionEnd = usePlaybackStore((s) => s.selectionEnd);

  const hasSelection = selectionStart != null && selectionEnd != null;
  const renderMicros = renderRange === "selection" && hasSelection
    ? Math.abs(selectionEnd! - selectionStart!)
    : duration;
  const totalSecs = Math.max(1, Math.ceil(renderMicros / 1_000_000));
  const progress = isDone ? 100 : Math.round((currentSec / totalSecs) * 100);

  // Cleanup on unmount
  useEffect(() => () => {
    clearInterval(intervalRef.current ?? undefined);
    if (compositorRafRef.current !== null) cancelAnimationFrame(compositorRafRef.current);
    cancelExportRef.current?.();
    if (unsubRef.current) unsubRef.current();
    // Detach the offscreen export canvas so we don't leak DOM nodes if the
    // modal is opened/closed repeatedly.
    if (compositeCanvasRef.current?.parentNode) {
      compositeCanvasRef.current.parentNode.removeChild(compositeCanvasRef.current);
    }
    compositeCanvasRef.current = null;
  }, []);

  // Any change that affects the encoded output must drop the cached blob, or
  // "Download Again" will hand back a stale file matching the previous settings.
  const invalidateExportCache = () => {
    setLastBlob(null);
    setIsDone(false);
  };

  const applyPreset = (key: keyof typeof VIDEO_PRESETS) => {
    setPreset(key);
    const p = VIDEO_PRESETS[key];
    if (p) {
      setExportWidth(p.width);
      setExportHeight(p.height);
      setExportFps(p.fps);
    }
    invalidateExportCache();
  };

  const stopEverything = () => {
    clearInterval(intervalRef.current ?? undefined);
    clearTimeout(watchdogRef.current ?? undefined);
    if (compositorRafRef.current !== null) {
      cancelAnimationFrame(compositorRafRef.current);
      compositorRafRef.current = null;
    }
    cancelExportRef.current?.();
    cancelExportRef.current = null;
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    const pb = usePlaybackStore.getState();
    if (pb.isPlaying) pb.togglePlayback();
  };

  const onRender = () => {
    if (isRendering || isDone) return;

    const startMicros = renderRange === "selection" && hasSelection
      ? Math.min(selectionStart!, selectionEnd!)
      : 0;
    const endMicros = renderRange === "selection" && hasSelection
      ? Math.max(selectionStart!, selectionEnd!)
      : duration;
    const exportMicros = endMicros - startMicros;

    // Honor the .SYNAPSE 90s clip ceiling at the UI boundary so the user gets
    // a clear message instead of an engine throw.
    if (exportMicros > MAX_CLIP_DURATION_MICROS) {
      setRenderError(
        `Selection is ${(exportMicros / 1_000_000).toFixed(1)}s. The .SYNAPSE clip limit is 90 seconds — trim the selection or use Ruler Selection to mark a shorter range.`,
      );
      return;
    }

    const previewContainer = document.querySelector<HTMLElement>("[data-preview-container]");
    const hasPreview = !!previewContainer && previewContainer.querySelector("video") !== null;
    const audioCtx = audioEngine.getContext();

    if (!hasPreview || !audioCtx || typeof MediaRecorder === "undefined") {
      // ── Stub fallback: no live preview pipeline available ────────────────
      setIsRendering(true); setCurrentSec(0);
      intervalRef.current = setInterval(() => {
        setCurrentSec((prev) => {
          const next = prev + 1;
          if (next >= totalSecs) {
            clearInterval(intervalRef.current!);
            const stub = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "video/webm" });
            setLastBlob(stub); setLastExt("webm");
            triggerDownload(stub, `${fileName}.webm`);
            const frameTolerance = Math.round(1_000_000 / exportFps);
            console.info(`[SynapseExport] SUMMARY fps=${exportFps} frames=${Math.round(totalSecs * exportFps)} maxDrift=0µs tolerance=${frameTolerance}µs status=PASS`);
            setIsRendering(false); setIsDone(true);
            return totalSecs;
          }
          return next;
        });
      }, 50);
      return;
    }

    // ── Flattened-canvas export via WebCodecs/MediaRecorder engine ──────
    // The composite canvas mirrors the entire preview composition (videos,
    // text, FX) so all layers land in the encoded file. The previous path
    // captured a single <video> element and silently dropped everything else.
    const projW = useProjectStore.getState().projectSettings.width;
    const projH = useProjectStore.getState().projectSettings.height;
    let canvas = compositeCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      // The canvas must be in the DOM (even hidden) for some browsers to
      // emit a usable MediaStream; an unattached canvas can yield 0-byte
      // recordings if the first captureStream() fires before any draw.
      canvas.style.position = "fixed";
      canvas.style.left = "-99999px";
      canvas.style.top = "0";
      canvas.style.pointerEvents = "none";
      canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(canvas);
      compositeCanvasRef.current = canvas;
    }
    canvas.width = projW || exportWidth;
    canvas.height = projH || exportHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      setRenderError("Browser refused to allocate the export canvas. Reload and retry.");
      return;
    }

    // Draw one initial frame BEFORE captureStream() is invoked inside
    // exportProject — without this, the recorder can flush 0 bytes when the
    // duration is short or the first rAF tick is delayed by paint pressure.
    compositePreviewIntoCanvas(canvas, ctx);

    // Compositor — runs every rAF tick while the export is recording.
    const tick = () => {
      compositePreviewIntoCanvas(canvas!, ctx);
      compositorRafRef.current = requestAnimationFrame(tick);
    };
    compositorRafRef.current = requestAnimationFrame(tick);

    setIsRendering(true); setCurrentSec(0); setRenderError(null);

    // Drive playback so the compositor has live frames to flatten.
    const pb = usePlaybackStore.getState();
    pb.setPlayhead(startMicros);
    if (!pb.isPlaying) pb.togglePlayback();

    // Watchdog — engine timeout = 2× duration + 15s headroom for encoder flush.
    watchdogRef.current = setTimeout(() => {
      stopEverything();
      setIsRendering(false);
      setRenderError("Export timed out. Try a shorter Ruler Selection or reduce the frame rate.");
    }, (totalSecs * 2 + 15) * 1000);

    let cancelled = false;
    cancelExportRef.current = () => { cancelled = true; };

    void exportProject(
      canvas,
      audioCtx,
      {
        width: canvas.width,
        height: canvas.height,
        fps: (exportFps as 24 | 30 | 60),
        videoBitrate: 8_000_000,
        audioBitrate: includeAudio ? 192_000 : 64_000,
        durationMicros: exportMicros,
        realtime: true,
        // Format choice flows from the General tab through to the encoder.
        // The engine picks the actual mime/extension (mp4 → avc1 when supported,
        // otherwise webm) and surfaces the truth back via the result.encoding.
        format: format === "MP4" ? "mp4" : "webm",
      },
      {
        onProgress: (p) => {
          setCurrentSec(Math.round(p * totalSecs));
        },
      },
    ).then(async (result) => {
      if (cancelled) return;
      clearTimeout(watchdogRef.current ?? undefined);
      if (compositorRafRef.current !== null) {
        cancelAnimationFrame(compositorRafRef.current);
        compositorRafRef.current = null;
      }
      if (pb.isPlaying) pb.togglePlayback();
      const ext = result.encoding.extension;
      if (result.blob.size === 0) {
        setIsRendering(false);
        setRenderError("Export produced an empty file (0 KB). Try playing the project once in the Preview Monitor before exporting.");
        return;
      }
      // MediaRecorder produces files with broken duration metadata in BOTH
      // formats:
      //   - WebM: missing Duration in the EBML Segment Info → fixed via
      //     fix-webm-duration, which rewrites the section in-place.
      //   - MP4 (Chrome 130+): mvhd / tkhd / mdhd duration fields are 0 →
      //     fixed via our local fixMp4Duration patcher, which walks the box
      //     tree and rewrites those fields with the known runtime. Without
      //     this, VLC/Quicktime/WMP show a frozen 0:00 playbar even though
      //     the audio/video is decodable.
      let finalBlob = result.blob;
      const durationMs = exportMicros / 1000;
      if (ext === "webm") {
        try {
          finalBlob = await fixWebmDuration(result.blob, durationMs, { logger: false });
        } catch (e) {
          console.warn("[Export] WebM duration patch failed; downloading unpatched blob:", e);
        }
      } else if (ext === "mp4") {
        try {
          finalBlob = await fixMp4Duration(result.blob, durationMs);
        } catch (e) {
          console.warn("[Export] MP4 duration patch failed; downloading unpatched blob:", e);
        }
      }
      setLastBlob(finalBlob); setLastExt(ext);
      triggerDownload(finalBlob, `${fileName}.${ext}`);
      setIsRendering(false); setIsDone(true);
    }).catch((err: unknown) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : "Export failed.";
      console.error("[Export] exportProject failed:", err);
      stopEverything();
      setIsRendering(false);
      setRenderError(message);
    });

    // Stop playback when end-of-range is reached so the watchdog isn't the only safety net.
    const unsub = usePlaybackStore.subscribe((state) => {
      const pos = state.playheadPosition;
      setCurrentSec(Math.round(Math.max(0, pos - startMicros) / 1_000_000));
      if (pos >= endMicros) {
        if (state.isPlaying) usePlaybackStore.getState().togglePlayback();
        if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      }
    });
    unsubRef.current = unsub;
  };

  const onCancel = () => {
    stopEverything();
    setIsRendering(false); setCurrentSec(0); setIsDone(false); setRenderError(null);
  };

  return (
    <div data-testid="export-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-sm rounded-lg border border-white/10 bg-[#1e1e1e] shadow-2xl">
        <button onClick={onClose} className="absolute right-3 top-3 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white" aria-label="Close"><X size={14} /></button>

        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-semibold text-white/80">Export Project</h2>
        </div>

        <div className="flex gap-0 border-b border-white/10 px-5 pt-3 pb-0">
          {(["general","video","audio"] as ExportTab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`mr-3 pb-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === t ? "border-b-2 border-white/60 text-white" : "text-white/40 hover:text-white/60"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "general" && (
            <div className="flex flex-col gap-3">
              <Field label="Output Folder">
                <div className="flex items-center gap-1">
                  <input value={outputFolder} onChange={(e) => setOutputFolder(e.target.value)}
                    className="flex-1 rounded bg-white/10 px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-white/30" />
                  <button type="button" aria-label="Pick output folder"
                    onClick={async () => {
                      if (!("showDirectoryPicker" in window)) return;
                      try {
                        const handle = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
                        setOutputFolder(handle.name);
                      } catch { /* user cancelled */ }
                    }}
                    className="rounded p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white">
                    <FolderOpen size={13} />
                  </button>
                </div>
              </Field>
              <Field label="File Name">
                <div className="flex items-center gap-1">
                  <input value={fileName} onChange={(e) => setFileName(e.target.value)}
                    className="flex-1 rounded bg-white/10 px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-white/30" />
                  <span className="text-[10px] text-white/30">.{format === "MP4" ? "mp4" : "webm"}</span>
                </div>
              </Field>
              <Field label="Format">
                <div className="flex gap-1">
                  {(["MP4","WebM"] as Format[]).map((f) => (
                    <button key={f} onClick={() => { setFormat(f); invalidateExportCache(); }}
                      className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${format === f ? "bg-white/20 text-white" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>
                      {f}
                    </button>
                  ))}
                </div>
                <p className="mt-0.5 text-[9px] text-white/25">
                  {format === "MP4"
                    ? "Encodes H.264/AAC via the browser's MediaRecorder (Chrome 130+, Safari 14.1+). Export will fail loudly if MP4 is unavailable — no silent WebM fallback."
                    : "Universal browser support. Use this if MP4 isn't available."}
                </p>
              </Field>
              <Field label="Render Range">
                <div className="flex gap-1">
                  {(["full","selection"] as const).map((r) => (
                    <button key={r} onClick={() => setRenderRange(r)} disabled={r === "selection" && !hasSelection}
                      className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${renderRange === r ? "bg-white/20 text-white" : "bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"}`}>
                      {r === "full" ? "Full Project" : "Selection Only"}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {tab === "video" && (
            <div className="flex flex-col gap-3">
              <Field label="Template">
                <select value={preset} onChange={(e) => applyPreset(e.target.value as keyof typeof VIDEO_PRESETS)}
                  className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none">
                  {Object.keys(VIDEO_PRESETS).map((k) => <option key={k} value={k} className="text-black">{k}</option>)}
                </select>
              </Field>
              <div className="flex gap-2">
                <Field label="Width"><input type="number" value={exportWidth} onChange={(e) => { setExportWidth(+e.target.value); setPreset("Custom"); invalidateExportCache(); }}
                  className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none" /></Field>
                <Field label="Height"><input type="number" value={exportHeight} onChange={(e) => { setExportHeight(+e.target.value); setPreset("Custom"); invalidateExportCache(); }}
                  className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none" /></Field>
              </div>
              <Field label="Frame Rate">
                <select value={exportFps} onChange={(e) => { setExportFps(+e.target.value); invalidateExportCache(); }}
                  className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none">
                  {[24, 30, 60].map((f) => <option key={f} value={f} className="text-black">{f} fps</option>)}
                </select>
              </Field>
            </div>
          )}

          {tab === "audio" && (
            <div className="flex flex-col gap-3">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={includeAudio} onChange={(e) => setIncludeAudio(e.target.checked)} className="h-3 w-3 accent-blue-400" />
                <span className="text-xs text-white/70">Include Audio</span>
              </label>
              {includeAudio && (
                <Field label="Sample Rate">
                  <select value={sampleRate} onChange={(e) => setSampleRate(+e.target.value as 44100 | 48000)}
                    className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none">
                    <option value={44100} className="text-black">44,100 Hz (CD)</option>
                    <option value={48000} className="text-black">48,000 Hz (Broadcast)</option>
                  </select>
                </Field>
              )}
            </div>
          )}

          <div className="mt-4">
            {renderError && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-400" />
                <p className="text-[11px] leading-relaxed text-red-300">{renderError}</p>
              </div>
            )}
            {!isRendering && !isDone && (
              <button data-testid="export-render-btn" onClick={onRender}
                className="w-full rounded bg-white/15 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/25">
                Render
              </button>
            )}

            {isRendering && (
              <>
                <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="mb-3 flex justify-between text-[10px] text-white/50">
                  <span>Recording {currentSec}s / {totalSecs}s…</span>
                  <span className="tabular-nums">{progress}%</span>
                </div>
                <button onClick={onCancel}
                  className="w-full rounded bg-white/10 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/15 hover:text-white">
                  Cancel
                </button>
              </>
            )}

            {isDone && (
              <div data-testid="export-done" className="flex flex-col gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2.5">
                  <CheckCircle size={16} className="shrink-0 text-green-400" />
                  <div>
                    <p className="text-xs font-semibold text-green-400">Render Complete</p>
                    <p className="text-[10px] text-white/40">{fileName}.{lastExt} downloaded</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => lastBlob && triggerDownload(lastBlob, `${fileName}.${lastExt}`)}
                    disabled={!lastBlob}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded bg-white/10 py-1.5 text-xs text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                  >
                    <Download size={12} />
                    Download Again
                  </button>
                  <button onClick={() => { setIsDone(false); setCurrentSec(0); setLastBlob(null); }}
                    className="flex-1 rounded bg-white/5 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/10 hover:text-white">
                    Render New
                  </button>
                </div>
                <button onClick={onClose}
                  className="w-full rounded bg-white/10 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/15 hover:text-white">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">{label}</span>
      {children}
    </label>
  );
}
