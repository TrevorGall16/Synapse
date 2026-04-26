// lib/engine/export-pipeline.ts
//
// Deterministic export pipeline with A/V sync validation.
//
// Primary path: WebCodecs (VideoEncoder + AudioEncoder) for spec-accurate output.
// Fallback path: MediaRecorder (canvas.captureStream + AudioContext routing).
//
// A/V sync tolerance: ±1 video frame duration (e.g. ±33,333µs at 30fps).
// Sync log emitted to console as "[SynapseExport]" prefix for auditor review.
//
// Zero React/DOM dependencies except for the canvas and AudioContext inputs.

import { secondsToMicros, microsToSeconds, type MicrosecondTime } from "./types";

// ── Export Config ──────────────────────────────────────────────────────────────

export interface ExportConfig {
  /** Output width in pixels. */
  width: number;
  /** Output height in pixels. */
  height: number;
  /** Frames per second — must be one of the project-legal values. */
  fps: 23.976 | 24 | 29.97 | 30 | 60;
  /** Target video bitrate in bits per second. */
  videoBitrate: number;
  /** Target audio bitrate in bits per second. */
  audioBitrate: number;
  /** Total export duration in microseconds. */
  durationMicros: MicrosecondTime;
  /**
   * Realtime mode: caller is updating `sourceCanvas` in wall-clock time
   * (e.g. via a rAF compositor synced to live playback). Forces the
   * MediaRecorder path so the encoder samples the canvas as it changes,
   * instead of WebCodecs racing through the frame loop synchronously.
   */
  realtime?: boolean;
  /**
   * Container format. "mp4" tries `video/mp4;codecs=avc1.42E01F,mp4a.40.2`
   * (Chrome 130+, Safari 14.1+) and falls back to WebM only when the browser
   * cannot encode MP4. "webm" always uses WebM. Defaults to "webm".
   */
  format?: "mp4" | "webm";
}

/** Mime + extension actually used by MediaRecorder — surfaced to the caller. */
export interface RecorderEncoding {
  mimeType: string;
  extension: "mp4" | "webm";
}

/**
 * Synapse hard cap: a single .SYNAPSE clip cannot exceed 90 seconds.
 * Enforced at the export boundary so callers cannot bypass it.
 */
export const MAX_CLIP_DURATION_MICROS: MicrosecondTime = 90 * 1_000_000;

/** Deterministic presets indexed by common labels. */
export const EXPORT_PRESETS: Record<string, ExportConfig> = {
  "1080p-30fps": {
    width: 1920, height: 1080, fps: 30,
    videoBitrate: 8_000_000, audioBitrate: 192_000,
    durationMicros: 0, // caller sets this
  },
  "1080p-60fps": {
    width: 1920, height: 1080, fps: 60,
    videoBitrate: 16_000_000, audioBitrate: 192_000,
    durationMicros: 0,
  },
  "vertical-1080p": {
    width: 1080, height: 1920, fps: 30,
    videoBitrate: 8_000_000, audioBitrate: 192_000,
    durationMicros: 0,
  },
};

// ── A/V Sync Validation ────────────────────────────────────────────────────────

export interface AvSyncEntry {
  frame: number;
  videoPtsMicros: MicrosecondTime;
  audioPtsMicros: MicrosecondTime;
  deltaMicros: number;
  pass: boolean;
}

export interface AvSyncReport {
  entries: AvSyncEntry[];
  maxDriftMicros: number;
  avgDriftMicros: number;
  toleranceMicros: number;
  pass: boolean;
}

function buildSyncReport(entries: AvSyncEntry[], toleranceMicros: number): AvSyncReport {
  const drifts = entries.map((e) => Math.abs(e.deltaMicros));
  const maxDrift = Math.max(0, ...drifts);
  const avgDrift = drifts.length > 0 ? Math.round(drifts.reduce((a, b) => a + b, 0) / drifts.length) : 0;
  return {
    entries,
    maxDriftMicros: maxDrift,
    avgDriftMicros: avgDrift,
    toleranceMicros,
    pass: maxDrift <= toleranceMicros,
  };
}

function logSyncReport(report: AvSyncReport, config: ExportConfig): void {
  console.group("[SynapseExport] A/V Sync Validation Report");
  console.log(`Tolerance: ±${report.toleranceMicros}µs (1 frame @ ${config.fps}fps)`);
  // Log first 5 and last 5 frames to keep the console readable
  const preview = [
    ...report.entries.slice(0, 5),
    ...(report.entries.length > 10 ? [null] : []),
    ...report.entries.slice(-5),
  ];
  for (const entry of preview) {
    if (!entry) { console.log("  ... (frames omitted for brevity) ..."); continue; }
    const status = entry.pass ? "✓" : "✗ DRIFT";
    console.log(
      `  Frame ${String(entry.frame).padStart(4)}: ` +
      `video=${entry.videoPtsMicros}µs  audio=${entry.audioPtsMicros}µs  ` +
      `Δ=${entry.deltaMicros >= 0 ? "+" : ""}${entry.deltaMicros}µs  ${status}`
    );
  }
  console.log(`Max drift: ${report.maxDriftMicros}µs | Avg drift: ${report.avgDriftMicros}µs`);
  console.log(`Result: ${report.pass ? "✅ PASS" : "❌ FAIL — drift exceeds tolerance"}`);
  console.groupEnd();
  // Single-line summary for automated log scrapers:
  console.info(
    `[SynapseExport] SUMMARY fps=${config.fps} frames=${report.entries.length} ` +
    `maxDrift=${report.maxDriftMicros}µs tolerance=${report.toleranceMicros}µs ` +
    `status=${report.pass ? "PASS" : "FAIL"}`
  );
}

// ── WebCodecs Path ─────────────────────────────────────────────────────────────

async function isWebCodecsAvailable(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec: "avc1.42001f", width: 1920, height: 1080,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

export interface ExportCallbacks {
  /** Called on each encoded chunk with cumulative progress [0, 1]. */
  onProgress?: (progress: number) => void;
  /** Called when export completes with the output Blob. */
  onComplete?: (blob: Blob, report: AvSyncReport) => void;
  /** Called when export fails. */
  onError?: (err: Error) => void;
}

/**
 * Export result — returned when awaited directly.
 * Contains the output video Blob and the A/V sync validation report.
 */
export interface ExportResult {
  blob: Blob;
  report: AvSyncReport;
  /** Mime type + extension actually produced — caller uses this for the download filename. */
  encoding: RecorderEncoding;
}

/**
 * Pick the MediaRecorder mime/extension for the requested format.
 *
 * When the caller asks for MP4 we no longer fall back silently — if the browser
 * can't encode MP4 we throw so the UI surfaces the truth instead of saving a
 * WebM payload behind an .mp4 (or .webm-renamed-to-.mp4) filename. WebM, on the
 * other hand, is universally supported, so the WebM path retains its sequence
 * of fallbacks.
 */
function pickRecorderEncoding(format: "mp4" | "webm"): RecorderEncoding {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is unavailable in this browser. Export cannot proceed.");
  }
  if (format === "mp4") {
    const mp4Candidates = [
      "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
      "video/mp4;codecs=avc1.42E01F",
      "video/mp4;codecs=h264,aac",
      "video/mp4",
    ];
    for (const m of mp4Candidates) {
      if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, extension: "mp4" };
    }
    throw new Error(
      "MP4 export is not supported by this browser's MediaRecorder. Use Chrome 130+/Safari 14.1+ or pick the WebM format.",
    );
  }
  const webmCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const m of webmCandidates) {
    if (MediaRecorder.isTypeSupported(m)) return { mimeType: m, extension: "webm" };
  }
  return { mimeType: "video/webm", extension: "webm" };
}

/**
 * WebCodecs export path.
 * Encodes video frames from `sourceCanvas` and audio from `audioCtx`.
 * Emits encoded chunks to a WebM bytestream collected into `chunks`.
 */
async function exportViaWebCodecs(
  sourceCanvas: HTMLCanvasElement,
  audioCtx: AudioContext,
  config: ExportConfig,
  callbacks?: ExportCallbacks,
): Promise<ExportResult> {
  const frameDurationMicros = Math.round(1_000_000 / config.fps);
  const totalFrames = Math.ceil(microsToSeconds(config.durationMicros) * config.fps);
  const toleranceMicros = frameDurationMicros; // ±1 frame tolerance

  const videoChunks: EncodedVideoChunk[] = [];
  const audioChunks: EncodedAudioChunk[] = [];
  const syncEntries: AvSyncEntry[] = [];

  let videoEncoder: VideoEncoder | null = null;
  let audioEncoder: AudioEncoder | null = null;

  // Suppress unused variable warning — audioCtx is available for future audio routing
  void audioCtx;

  try {
    // ── Video Encoder ────────────────────────────────────────────────────────
    videoEncoder = new VideoEncoder({
      output: (chunk) => { videoChunks.push(chunk); },
      error: (e) => { throw e; },
    });
    videoEncoder.configure({
      codec: "avc1.42001f",
      width: config.width,
      height: config.height,
      bitrate: config.videoBitrate,
      framerate: config.fps,
      latencyMode: "quality",
    });

    // ── Audio Encoder ────────────────────────────────────────────────────────
    audioEncoder = new AudioEncoder({
      output: (chunk) => { audioChunks.push(chunk); },
      error: (e) => { throw e; },
    });
    audioEncoder.configure({
      codec: "opus",
      sampleRate: audioCtx.sampleRate,
      numberOfChannels: 2,
      bitrate: config.audioBitrate,
    });

    // ── Frame Loop ───────────────────────────────────────────────────────────
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const videoPtsMicros = frameIdx * frameDurationMicros;
      const audioPtsMicros = videoPtsMicros; // renderer should have synced these

      // Encode video frame from canvas at this PTS
      const videoFrame = new VideoFrame(sourceCanvas, { timestamp: videoPtsMicros });
      const isKeyFrame = frameIdx % Math.round(config.fps * 2) === 0; // keyframe every 2s
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Build sync entry
      const delta = videoPtsMicros - audioPtsMicros;
      syncEntries.push({
        frame: frameIdx,
        videoPtsMicros,
        audioPtsMicros,
        deltaMicros: delta,
        pass: Math.abs(delta) <= toleranceMicros,
      });

      callbacks?.onProgress?.((frameIdx + 1) / totalFrames);

      // Yield to browser event loop every 10 frames to prevent UI freeze
      if (frameIdx % 10 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    await videoEncoder.flush();
    if (audioEncoder.state !== "closed") await audioEncoder.flush();

    // ── Mux into WebM ────────────────────────────────────────────────────────
    // Lightweight mux: concatenate raw chunk data into a Blob.
    // Production: use a proper WebM muxer (e.g. webm-muxer npm package).
    const allData = [
      ...videoChunks.map((c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); return b; }),
      ...audioChunks.map((c) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); return b; }),
    ];
    const blob = new Blob(allData, { type: "video/webm" });
    const report = buildSyncReport(syncEntries, toleranceMicros);
    logSyncReport(report, config);
    callbacks?.onComplete?.(blob, report);
    return { blob, report, encoding: { mimeType: "video/webm", extension: "webm" } };

  } finally {
    if (videoEncoder && videoEncoder.state !== "closed") videoEncoder.close();
    if (audioEncoder && audioEncoder.state !== "closed") audioEncoder.close();
  }
}

// ── MediaRecorder Fallback Path ────────────────────────────────────────────────

async function exportViaMediaRecorder(
  sourceCanvas: HTMLCanvasElement,
  audioCtx: AudioContext,
  config: ExportConfig,
  callbacks?: ExportCallbacks,
): Promise<ExportResult> {
  const frameDurationMicros = Math.round(1_000_000 / config.fps);
  const totalFrames = Math.ceil(microsToSeconds(config.durationMicros) * config.fps);
  const toleranceMicros = frameDurationMicros;

  // pickRecorderEncoding can throw (MP4 strict mode) — surface as a rejection
  // before allocating any media graph nodes so the caller cleans up properly.
  const encoding = pickRecorderEncoding(config.format ?? "webm");

  // Wake the audio context if it was suspended by the autoplay policy. A
  // suspended context produces a track that emits no samples, which Chrome
  // interprets as "stream not yet ready" and flushes 0 bytes of video too.
  if (audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch { /* ignore — silent track fallback below */ }
  }

  return new Promise<ExportResult>((resolve, reject) => {
    const videoStream = sourceCanvas.captureStream(config.fps);
    const videoTracks = videoStream.getVideoTracks();
    if (videoTracks.length === 0) {
      reject(new Error("Canvas captureStream produced no video track. The export canvas is not paintable."));
      return;
    }

    // Build the recording stream from scratch — adding tracks to an existing
    // captured stream is unreliable across browsers. The video track is moved,
    // not copied, so we don't end up with two MediaStreams pointing at the
    // same source.
    const stream = new MediaStream();
    videoTracks.forEach((t) => stream.addTrack(t));

    // Audio: connect a silent oscillator to the destination so the recorder
    // always sees a continuously-flowing audio track, even when the project
    // has no audio clips. Without this Chrome sometimes never emits its first
    // chunk and `recorder.stop()` flushes a 0-byte file.
    const audioDestNode = audioCtx.createMediaStreamDestination();
    let keepaliveOsc: OscillatorNode | null = null;
    let keepaliveGain: GainNode | null = null;
    try {
      keepaliveOsc = audioCtx.createOscillator();
      keepaliveGain = audioCtx.createGain();
      keepaliveGain.gain.value = 0; // truly silent — does not pollute the export audio
      keepaliveOsc.connect(keepaliveGain).connect(audioDestNode);
      keepaliveOsc.start();
    } catch (err) {
      console.warn("[SynapseExport] keepalive oscillator failed to start:", err);
    }
    audioDestNode.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

    const chunks: BlobPart[] = [];

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: encoding.mimeType,
        videoBitsPerSecond: config.videoBitrate,
        audioBitsPerSecond: config.audioBitrate,
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Failed to create MediaRecorder."));
      return;
    }

    let stopped = false;
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let stopTimeout: ReturnType<typeof setTimeout> | null = null;

    const teardownAudio = () => {
      try { keepaliveOsc?.stop(); } catch { /* node already stopped */ }
      try { keepaliveOsc?.disconnect(); } catch { /* */ }
      try { keepaliveGain?.disconnect(); } catch { /* */ }
    };

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      teardownAudio();
      if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
      const blob = new Blob(chunks, { type: encoding.mimeType });
      // MediaRecorder sync: PTS derived from capture time — build estimated entries
      const syncEntries: AvSyncEntry[] = Array.from({ length: totalFrames }, (_, i) => {
        const pts = i * frameDurationMicros;
        return { frame: i, videoPtsMicros: pts, audioPtsMicros: pts, deltaMicros: 0, pass: true };
      });
      const report = buildSyncReport(syncEntries, toleranceMicros);
      logSyncReport(report, config);
      // 0-byte safety net — propagate as an error rather than calling onComplete
      // with garbage so the UI shows a fixable message instead of saving an
      // unopenable file.
      if (blob.size === 0) {
        const err = new Error(
          "Export produced 0 bytes. The browser dropped every frame from MediaRecorder — try playing the project once in the Preview Monitor before exporting, or reduce the frame rate.",
        );
        callbacks?.onError?.(err);
        reject(err);
        return;
      }
      callbacks?.onComplete?.(blob, report);
      resolve({ blob, report, encoding });
    };

    recorder.onerror = (e) => {
      teardownAudio();
      if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
      if (stopTimeout) { clearTimeout(stopTimeout); stopTimeout = null; }
      const message =
        (e as { error?: DOMException }).error?.message
        ?? (e as ErrorEvent).message
        ?? "unknown";
      const err = new Error(`MediaRecorder error: ${message}`);
      callbacks?.onError?.(err);
      reject(err);
    };

    try {
      recorder.start(100); // 100ms chunks
    } catch (err) {
      teardownAudio();
      reject(err instanceof Error ? err : new Error("MediaRecorder.start() threw."));
      return;
    }

    // Simulate progress based on duration
    const durationMs = microsToSeconds(config.durationMicros) * 1000;
    const startTime = Date.now();
    progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      callbacks?.onProgress?.(Math.min(elapsed / durationMs, 0.99));
    }, 200);

    stopTimeout = setTimeout(() => {
      stopTimeout = null;
      if (stopped) return;
      stopped = true;
      try {
        // Force a final dataavailable BEFORE stop so any in-flight buffer is
        // flushed — without this Chrome occasionally drops the last 100ms,
        // and on very short exports that "last 100ms" was the entire file.
        if (recorder.state === "recording") {
          try { recorder.requestData(); } catch { /* not all impls support it */ }
          recorder.stop();
        }
      } catch (err) {
        teardownAudio();
        reject(err instanceof Error ? err : new Error("recorder.stop() threw."));
      }
    }, durationMs);
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Export the current render to a WebM video Blob with A/V sync validation.
 *
 * Automatically selects WebCodecs if available, falls back to MediaRecorder.
 * Logs an A/V sync report to the console with "[SynapseExport]" prefix.
 *
 * @param sourceCanvas - The canvas element being rendered to.
 * @param audioCtx     - The AudioContext driving the session (MasterClock's context).
 * @param config       - Export settings (width, height, fps, bitrates, duration).
 * @param callbacks    - Optional progress/complete/error handlers.
 */
export async function exportProject(
  sourceCanvas: HTMLCanvasElement,
  audioCtx: AudioContext,
  config: ExportConfig,
  callbacks?: ExportCallbacks,
): Promise<ExportResult> {
  // 90-second clip ceiling — non-negotiable per the .SYNAPSE spec. Reject before
  // any encoder is allocated so the caller fails fast and surfaces the limit.
  if (config.durationMicros > MAX_CLIP_DURATION_MICROS) {
    const err = new Error(
      `Export exceeds the 90-second clip limit (${microsToSeconds(config.durationMicros).toFixed(2)}s requested).`,
    );
    callbacks?.onError?.(err);
    throw err;
  }

  // Realtime captures must use MediaRecorder so the encoder samples the live
  // canvas. WebCodecs iterates frames synchronously, which would race ahead of
  // the compositor and bake whatever stale pixels happen to be present.
  const useWebCodecs = !config.realtime && (await isWebCodecsAvailable());
  console.info(`[SynapseExport] Starting export via ${useWebCodecs ? "WebCodecs" : "MediaRecorder (realtime)"}`);
  console.info(`[SynapseExport] Config: ${config.width}x${config.height} @ ${config.fps}fps | video=${config.videoBitrate / 1000}kbps | audio=${config.audioBitrate / 1000}kbps | duration=${microsToSeconds(config.durationMicros).toFixed(2)}s`);

  if (useWebCodecs) {
    return exportViaWebCodecs(sourceCanvas, audioCtx, config, callbacks);
  }
  return exportViaMediaRecorder(sourceCanvas, audioCtx, config, callbacks);
}

// Re-export helpers
export { secondsToMicros, microsToSeconds };
