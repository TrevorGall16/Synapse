/**
 * Extraction utilities for generating static filmstrip frames
 * and requesting audio peak data via Web Worker.
 */

import { useProjectStore } from "@/lib/store/project-store";

// ── Video Frame Extraction (main thread, canvas-based) ──

export async function extractVideoFrames(
  videoUrl: string,
  frameCount: number
): Promise<string[]> {
  try {
    const video = document.createElement("video");
    video.src = videoUrl;
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Video load failed"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext("2d")!;

    const frames: string[] = [];
    const duration = video.duration;

    for (let i = 0; i < frameCount; i++) {
      const seekTime = (i / frameCount) * duration;
      video.currentTime = seekTime;

      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.6));
    }

    video.src = "";
    return frames;
  } catch {
    return [];
  }
}

// ── Audio Peak Extraction (main thread, no Worker) ──────

const SAMPLES_PER_PEAK = 10_000;

export async function requestAudioPeaks(audioUrl: string, mediaId: string): Promise<void> {
  try {
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();

    const audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    await audioCtx.close();

    const channelData = audioBuffer.getChannelData(0);
    const peakCount = Math.max(1, Math.ceil(channelData.length / SAMPLES_PER_PEAK));
    const peaks = new Float32Array(peakCount);
    let globalMax = 0;

    for (let i = 0; i < peakCount; i++) {
      const start = i * SAMPLES_PER_PEAK;
      const end = Math.min(start + SAMPLES_PER_PEAK, channelData.length);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > peak) peak = abs;
      }
      peaks[i] = peak;
      if (peak > globalMax) globalMax = peak;
    }

    const peakManifest: number[] = new Array(peakCount);
    for (let i = 0; i < peakCount; i++) {
      peakManifest[i] = globalMax > 0 ? peaks[i] / globalMax : 0;
    }

    useProjectStore.getState().updateMediaPeaks(mediaId, peakManifest);
  } catch (err) {
    console.error("[audio-peaks] Peak extraction failed:", err);
  }
}
