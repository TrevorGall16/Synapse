"use client";

import { useRef, useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { requestAudioPeaks } from "@/lib/utils/media-extractor";

interface ClipWaveformProps {
  sourceId: string;
  clipWidthPx: number;
  trackColor: string;
  trackHeight: number;
}

export function ClipWaveform({ sourceId, clipWidthPx, trackColor, trackHeight }: ClipWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const media = useProjectStore((s) => s.mediaPool.find((m) => m.id === sourceId));
  const peaks = media?.peakManifest;

  // Trigger worker extraction if peaks not yet available
  useEffect(() => {
    if (!media?.previewUrl || peaks) return;
    requestAudioPeaks(media.previewUrl, media.id);
  }, [media?.previewUrl, media?.id, peaks]);

  // Draw waveform from peakManifest
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || peaks.length === 0 || clipWidthPx < 1) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const drawWidth = Math.round(clipWidthPx);
    const drawHeight = trackHeight;

    canvas.width = drawWidth * dpr;
    canvas.height = drawHeight * dpr;
    canvas.style.width = `${drawWidth}px`;
    canvas.style.height = `${drawHeight}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, drawWidth, drawHeight);

    const midY = drawHeight / 2;

    // 1px precision: iterate by pixel column, interpolate peaks
    ctx.beginPath();
    ctx.moveTo(0, midY);

    for (let px = 0; px < drawWidth; px++) {
      const peakIdx = (px / drawWidth) * peaks.length;
      const lo = Math.floor(peakIdx);
      const hi = Math.min(lo + 1, peaks.length - 1);
      const frac = peakIdx - lo;
      const amp = (peaks[lo] * (1 - frac) + peaks[hi] * frac) * midY * 0.9;
      ctx.lineTo(px, midY - amp);
    }
    ctx.lineTo(drawWidth, midY);

    for (let px = drawWidth - 1; px >= 0; px--) {
      const peakIdx = (px / drawWidth) * peaks.length;
      const lo = Math.floor(peakIdx);
      const hi = Math.min(lo + 1, peaks.length - 1);
      const frac = peakIdx - lo;
      const amp = (peaks[lo] * (1 - frac) + peaks[hi] * frac) * midY * 0.9;
      ctx.lineTo(px, midY + amp);
    }

    ctx.closePath();
    ctx.fillStyle = trackColor;
    ctx.globalAlpha = 0.6;
    ctx.fill();

    // Center line
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = trackColor;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(drawWidth, midY);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, [peaks, clipWidthPx, trackColor, trackHeight]);

  if (!peaks || peaks.length === 0) {
    return <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/5" />;
  }

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 opacity-50"
    />
  );
}
