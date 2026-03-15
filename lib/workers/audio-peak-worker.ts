// ── Audio Peak Extraction Worker ─────────────────────────
// Runs entirely off the main thread. Fetches audio, decodes
// via OfflineAudioContext, and extracts a normalized peak
// manifest (1 peak per 1024 samples).

const SAMPLES_PER_PEAK = 1024;

interface ExtractPeaksMessage {
  type: "extract-peaks";
  audioUrl: string;
  mediaId: string;
}

interface PeaksReadyMessage {
  type: "peaks-ready";
  mediaId: string;
  peakManifest: number[];
}

interface PeaksErrorMessage {
  type: "peaks-error";
  mediaId: string;
  error: string;
}

self.onmessage = async (e: MessageEvent<ExtractPeaksMessage>) => {
  if (e.data.type !== "extract-peaks") return;

  const { audioUrl, mediaId } = e.data;

  try {
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();

    const audioCtx = new OfflineAudioContext(1, 1, 44100);
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);

    const peakCount = Math.ceil(channelData.length / SAMPLES_PER_PEAK);
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

    // Normalize to 0.0–1.0
    const peakManifest: number[] = new Array(peakCount);
    for (let i = 0; i < peakCount; i++) {
      peakManifest[i] = globalMax > 0 ? peaks[i] / globalMax : 0;
    }

    const msg: PeaksReadyMessage = { type: "peaks-ready", mediaId, peakManifest };
    self.postMessage(msg);
  } catch (err) {
    const msg: PeaksErrorMessage = {
      type: "peaks-error",
      mediaId,
      error: err instanceof Error ? err.message : "Unknown error",
    };
    self.postMessage(msg);
  }
};
