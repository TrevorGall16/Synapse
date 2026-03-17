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

// ── Audio Peak Extraction (main thread, adaptive resolution + cache) ──

export async function requestAudioPeaks(audioUrl: string, mediaId: string): Promise<void> {
  try {
    // Check IndexedDB cache first
    const cached = await getCachedPeaks(mediaId);
    if (cached) {
      useProjectStore.getState().updateMediaPeaks(mediaId, cached);
      return;
    }

    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();

    const audioCtx = new AudioContext();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (decodeErr) {
      console.warn("[audio-peaks] decodeAudioData failed (likely .mp4 container):", decodeErr);
      useProjectStore.getState().updateMediaPeaks(mediaId, [0.1, 0.1]);
      await audioCtx.close();
      return;
    }
    await audioCtx.close();

    const channelData = audioBuffer.getChannelData(0);

    // Adaptive: ~200 peaks per second for 1px fidelity at common zoom levels
    const targetPeakCount = Math.max(1000, Math.ceil(audioBuffer.duration * 200));
    const samplesPerPeak = Math.max(1, Math.floor(channelData.length / targetPeakCount));
    const peakCount = Math.max(1, Math.ceil(channelData.length / samplesPerPeak));
    const peaks = new Float32Array(peakCount);
    let globalMax = 0;

    for (let i = 0; i < peakCount; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, channelData.length);
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

    // Cache to IndexedDB before updating store
    await setCachedPeaks(mediaId, peakManifest);
    useProjectStore.getState().updateMediaPeaks(mediaId, peakManifest);
  } catch (err) {
    console.error("[audio-peaks] Peak extraction failed:", err);
  }
}

// ── IndexedDB Waveform Cache ────────────────────────────

const DB_NAME = "synapse-waveform-cache";
const STORE_NAME = "peaks";
const DB_VERSION = 1;

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedPeaks(mediaId: string): Promise<number[] | null> {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(mediaId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCachedPeaks(mediaId: string, peaks: number[]): Promise<void> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(peaks, mediaId);
  } catch {
    // Cache write failure is non-critical
  }
}
