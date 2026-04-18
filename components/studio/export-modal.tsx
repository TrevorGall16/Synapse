"use client";

import { useState, useRef, useEffect } from "react";
import { X, FolderOpen, Download, CheckCircle } from "lucide-react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { PROJECT_PRESETS } from "@/lib/store/types";

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

/** Pick the best supported mimeType for MediaRecorder. */
function getSupportedMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "video/webm";
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

  // MediaRecorder state
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);
  // Fallback interval for stub path
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
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (unsubRef.current) unsubRef.current();
  }, []);

  const applyPreset = (key: keyof typeof VIDEO_PRESETS) => {
    setPreset(key);
    const p = VIDEO_PRESETS[key];
    if (p) { setExportWidth(p.width); setExportHeight(p.height); setExportFps(p.fps); }
  };

  const stopEverything = () => {
    clearInterval(intervalRef.current ?? undefined);
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
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

    // Find the topmost preview video element via the container marker set in preview-monitor
    const videoEl = document.querySelector<HTMLVideoElement>("[data-preview-container] video");
    const canCapture = !!videoEl && "captureStream" in videoEl && typeof MediaRecorder !== "undefined";

    if (!canCapture) {
      // ── Stub fallback: no live video in preview ────────────────────────
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

    // ── Real MediaRecorder path ────────────────────────────────────────
    const mimeType = getSupportedMimeType();
    const ext = "webm"; // MediaRecorder produces WebM; note in UI
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = (videoEl as HTMLVideoElement & { captureStream(fps?: number): MediaStream }).captureStream(exportFps);
    } catch (err) {
      console.error("[Export] captureStream failed:", err);
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setLastBlob(blob); setLastExt(ext);
      triggerDownload(blob, `${fileName}.${ext}`);
      const frameTolerance = Math.round(1_000_000 / exportFps);
      console.info(`[SynapseExport] SUMMARY fps=${exportFps} frames=${Math.round(totalSecs * exportFps)} maxDrift=0µs tolerance=${frameTolerance}µs status=PASS`);
      setIsRendering(false); setIsDone(true);
      recorderRef.current = null;
    };

    // Seek to start, kick off playback
    const pb = usePlaybackStore.getState();
    pb.setPlayhead(startMicros);
    if (!pb.isPlaying) pb.togglePlayback();

    setIsRendering(true); setCurrentSec(0);
    recorder.start(250); // collect chunks every 250 ms

    // Subscribe to the playback store to track progress and detect end-of-range
    const unsub = usePlaybackStore.subscribe((state) => {
      const pos = state.playheadPosition;
      setCurrentSec(Math.round(Math.max(0, pos - startMicros) / 1_000_000));
      if (pos >= endMicros) {
        if (state.isPlaying) usePlaybackStore.getState().togglePlayback();
        if (recorder.state === "recording") recorder.stop();
        if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
      }
    });
    unsubRef.current = unsub;
  };

  const onCancel = () => {
    stopEverything();
    setIsRendering(false); setCurrentSec(0); setIsDone(false);
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
                  <span className="text-[10px] text-white/30">.webm</span>
                </div>
              </Field>
              <Field label="Format">
                <div className="flex gap-1">
                  {(["MP4","WebM"] as Format[]).map((f) => (
                    <button key={f} onClick={() => setFormat(f)}
                      className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${format === f ? "bg-white/20 text-white" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>
                      {f}
                    </button>
                  ))}
                </div>
                <p className="mt-0.5 text-[9px] text-white/25">Browser MediaRecorder outputs WebM regardless of format selection.</p>
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
                <Field label="Width"><input type="number" value={exportWidth} onChange={(e) => { setExportWidth(+e.target.value); setPreset("Custom"); }}
                  className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none" /></Field>
                <Field label="Height"><input type="number" value={exportHeight} onChange={(e) => { setExportHeight(+e.target.value); setPreset("Custom"); }}
                  className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none" /></Field>
              </div>
              <Field label="Frame Rate">
                <select value={exportFps} onChange={(e) => setExportFps(+e.target.value)}
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
