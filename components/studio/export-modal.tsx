"use client";

import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";

type Format = "MP4" | "WebM";
type Quality = "Draft" | "Pro" | "High";

interface ExportModalProps {
  onClose: () => void;
}

export function ExportModal({ onClose }: ExportModalProps) {
  const [format, setFormat] = useState<Format>("MP4");
  const [quality, setQuality] = useState<Quality>("Pro");
  const [renderSelectionOnly, setRenderSelectionOnly] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const duration = useProjectStore((s) => s.duration);
  const projectFps = useProjectStore((s) => s.projectFps);
  const selectionStart = usePlaybackStore((s) => s.selectionStart);
  const selectionEnd = usePlaybackStore((s) => s.selectionEnd);

  const hasSelection = selectionStart != null && selectionEnd != null;
  const renderDurationMicros = renderSelectionOnly && hasSelection
    ? Math.abs(selectionEnd! - selectionStart!)
    : duration;
  const totalFrames = Math.max(1, Math.round((renderDurationMicros / 1_000_000) * projectFps));
  const progress = isDone ? 100 : Math.round((currentFrame / totalFrames) * 100);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const onRender = () => {
    if (isRendering || isDone) return;
    setIsRendering(true);
    setCurrentFrame(0);

    intervalRef.current = setInterval(() => {
      setCurrentFrame((prev) => {
        const next = prev + 1;
        if (next >= totalFrames) {
          clearInterval(intervalRef.current!);
          setIsRendering(false);
          setIsDone(true);
          return totalFrames;
        }
        return next;
      });
    }, 50);
  };

  const onCancel = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsRendering(false);
    setCurrentFrame(0);
    setIsDone(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-sm rounded-lg border border-white/10 bg-[#1e1e1e] p-6 shadow-2xl">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X size={14} />
        </button>

        <h2 className="mb-4 text-sm font-semibold text-white/80">Export Project</h2>

        {/* Format */}
        <div className="mb-3">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-white/40">Format</span>
          <div className="flex gap-1">
            {(["MP4", "WebM"] as Format[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  format === f ? "bg-white/20 text-white" : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Quality */}
        <div className="mb-3">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-white/40">Quality</span>
          <div className="flex gap-1">
            {(["Draft", "Pro", "High"] as Quality[]).map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  quality === q ? "bg-white/20 text-white" : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Render selection only */}
        {hasSelection && (
          <label className="mb-4 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={renderSelectionOnly}
              onChange={(e) => setRenderSelectionOnly(e.target.checked)}
              className="h-3 w-3 cursor-pointer accent-blue-400"
              disabled={isRendering}
            />
            <span className="text-[11px] text-white/60">Render Selection Only</span>
          </label>
        )}

        {/* Render button */}
        {!isRendering && !isDone && (
          <button
            onClick={onRender}
            className="mb-3 w-full rounded bg-white/15 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/25"
          >
            Render
          </button>
        )}

        {/* Progress bar */}
        {(isRendering || isDone) && (
          <div className="mb-2">
            <div className="mb-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${isDone ? "bg-green-500" : "bg-blue-500"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/50">
                {isDone ? "Done!" : `Baking frame ${currentFrame} / ${totalFrames}...`}
              </span>
              <span className="text-[10px] tabular-nums text-white/40">{progress}%</span>
            </div>
          </div>
        )}

        {/* Cancel / Done close */}
        {(isRendering || isDone) && (
          <button
            onClick={isDone ? onClose : onCancel}
            className="w-full rounded bg-white/10 py-1.5 text-xs text-white/50 transition-colors hover:bg-white/15 hover:text-white"
          >
            {isDone ? "Close" : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
