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
    ctx.fillStyle = trackColor;

    const barWidth = drawWidth / peaks.length;
    const midY = drawHeight / 2;

    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * drawHeight * 0.8;
      ctx.fillRect(
        i * barWidth,
        midY - barHeight / 2,
        Math.max(1, barWidth - 1),
        barHeight
      );
    }
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
