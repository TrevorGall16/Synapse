"use client";

import { useRef, useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { requestAudioPeaks } from "@/lib/utils/media-extractor";

interface ClipWaveformProps {
  sourceId: string;
  clipWidthPx: number;
  trackHeight: number;
}

/** Neon cyan→purple waveform rendered at 1px column precision.
 *  Hot peaks (amplitude > 70%) receive an extra bright-cyan highlight pass,
 *  giving a "beat detector" visual effect for BPM sync. */
export function ClipWaveform({ sourceId, clipWidthPx, trackHeight }: ClipWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const media = useProjectStore((s) => s.mediaPool.find((m) => m.id === sourceId));
  const peaks = media?.peakManifest;

  // Trigger peak extraction if not yet computed
  useEffect(() => {
    if (!media?.previewUrl || peaks) return;
    requestAudioPeaks(media.previewUrl, media.id);
  }, [media?.previewUrl, media?.id, peaks]);

  // Draw waveform whenever peaks, size, or theme changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || peaks.length === 0 || clipWidthPx < 1) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(clipWidthPx);
    const H = trackHeight;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const midY = H / 2;
    const HOT_THRESH = 0.7; // peaks above 70% get bright-cyan highlight

    // ── Main waveform body (filled polygon, cyan→purple gradient) ──
    const bodyGrad = ctx.createLinearGradient(0, 0, 0, H);
    bodyGrad.addColorStop(0,   "rgba(0,229,255,0.85)");  // neon cyan top
    bodyGrad.addColorStop(0.5, "rgba(168,85,247,0.60)"); // purple mid
    bodyGrad.addColorStop(1,   "rgba(0,229,255,0.85)");  // neon cyan bottom

    ctx.beginPath();
    ctx.moveTo(0, midY);
    for (let px = 0; px < W; px++) {
      const amp = samplePeak(peaks, px, W) * midY * 0.88;
      ctx.lineTo(px, midY - amp);
    }
    ctx.lineTo(W, midY);
    for (let px = W - 1; px >= 0; px--) {
      const amp = samplePeak(peaks, px, W) * midY * 0.88;
      ctx.lineTo(px, midY + amp);
    }
    ctx.closePath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // ── Hot-peak scanlines (bright cyan hairlines on transients) ──
    ctx.globalCompositeOperation = "screen";
    const hotGrad = ctx.createLinearGradient(0, 0, 0, H);
    hotGrad.addColorStop(0,   "rgba(0,255,255,0.9)");
    hotGrad.addColorStop(0.5, "rgba(255,255,255,0.4)");
    hotGrad.addColorStop(1,   "rgba(0,255,255,0.9)");

    ctx.strokeStyle = hotGrad;
    ctx.lineWidth = 1;
    for (let px = 0; px < W; px++) {
      const norm = samplePeak(peaks, px, W);
      if (norm >= HOT_THRESH) {
        const amp = norm * midY * 0.88;
        const glowAlpha = (norm - HOT_THRESH) / (1 - HOT_THRESH); // 0→1 above threshold
        ctx.globalAlpha = glowAlpha * 0.9;
        ctx.beginPath();
        ctx.moveTo(px, midY - amp);
        ctx.lineTo(px, midY + amp);
        ctx.stroke();
      }
    }

    // ── Center line ──
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(W, midY);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }, [peaks, clipWidthPx, trackHeight]);

  if (!peaks || peaks.length === 0) {
    // Pulsing placeholder while peaks are computing
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-px w-full animate-pulse bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      style={{ opacity: 0.75, mixBlendMode: "screen" }}
    />
  );
}

/** Interpolated peak sample at pixel column `px` of width `W`. */
function samplePeak(peaks: number[], px: number, W: number): number {
  const idx = (px / W) * peaks.length;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, peaks.length - 1);
  return peaks[lo] * (1 - (idx - lo)) + peaks[hi] * (idx - lo);
}
