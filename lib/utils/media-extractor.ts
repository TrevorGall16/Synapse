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
    canvas.width = 120;
    canvas.height = 68;
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

// ── Audio Peak Extraction (off main thread via Web Worker) ──

let peakWorker: Worker | null = null;

function getPeakWorker(): Worker {
  if (!peakWorker) {
    peakWorker = new Worker(
      new URL("../workers/audio-peak-worker.ts", import.meta.url)
    );
    peakWorker.onmessage = (e: MessageEvent) => {
      if (e.data.type === "peaks-ready") {
        useProjectStore.getState().updateMediaPeaks(e.data.mediaId, e.data.peakManifest);
      }
    };
  }
  return peakWorker;
}

export function requestAudioPeaks(audioUrl: string, mediaId: string): void {
  const worker = getPeakWorker();
  worker.postMessage({ type: "extract-peaks", audioUrl, mediaId });
}
