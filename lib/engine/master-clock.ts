import {
  type MasterClockState,
  type MicrosecondTime,
  type ClockSubscriber,
  secondsToMicros,
  microsToSeconds,
} from "./types";

/**
 * Audio-driven master clock for the Synapse engine.
 *
 * All visual timing derives from AudioContext.currentTime.
 * For silent sessions, falls back to frame-count / target-fps.
 *
 * Zero React/DOM dependencies — this is a pure engine module.
 */
export class MasterClock {
  private audioCtx: AudioContext | null = null;
  private anchorIntervalId: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;
  private subscribers = new Set<ClockSubscriber>();

  private _isPlaying = false;
  private _bpm = 120;

  /** Microsecond time when playback was last started/seeked. */
  private originMicros: MicrosecondTime = 0;
  /** AudioContext.currentTime (seconds) at last play/seek. */
  private originAudioTime = 0;

  /** Silent-session fallback state. */
  private frameCount = 0;
  private targetFps = 60;
  private lastFrameTimestamp = 0;
  private useSilentFallback = false;

  // ── Lifecycle ──────────────────────────────────────────

  async init(): Promise<void> {
    try {
      this.audioCtx = new AudioContext();
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }
      this.useSilentFallback = false;
    } catch {
      this.audioCtx = null;
      this.useSilentFallback = true;
    }
  }

  destroy(): void {
    this.pause();
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.subscribers.clear();
  }

  // ── Transport ──────────────────────────────────────────

  play(): void {
    if (this._isPlaying) return;
    this._isPlaying = true;

    if (this.audioCtx) {
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume().catch(() => {});
      }
      this.originAudioTime = this.audioCtx.currentTime;
    } else {
      this.lastFrameTimestamp = performance.now();
      this.useSilentFallback = true;
    }

    this.startReanchor();
    this.startRafLoop();
    this.notify();
  }

  pause(): void {
    if (!this._isPlaying) return;

    // Capture current position before stopping.
    this.originMicros = this.getCurrentTimeMicros();
    this._isPlaying = false;

    this.stopReanchor();
    this.stopRafLoop();
    this.notify();
  }

  seek(timeSeconds: number): void {
    this.originMicros = secondsToMicros(timeSeconds);
    this.frameCount = 0;

    if (this.audioCtx) {
      this.originAudioTime = this.audioCtx.currentTime;
    } else {
      this.lastFrameTimestamp = performance.now();
    }

    this.notify();
  }

  // ── Time Queries ───────────────────────────────────────

  getCurrentTimeMicros(): MicrosecondTime {
    if (!this._isPlaying) return this.originMicros;

    if (this.audioCtx && !this.useSilentFallback) {
      const elapsed = this.audioCtx.currentTime - this.originAudioTime;
      return this.originMicros + secondsToMicros(elapsed);
    }

    // Silent fallback: frame_count / target_fps
    return this.originMicros + secondsToMicros(this.frameCount / this.targetFps);
  }

  getCurrentTimeSeconds(): number {
    return microsToSeconds(this.getCurrentTimeMicros());
  }

  // ── State & Subscriptions ─────────────────────────────

  getState(): MasterClockState {
    return {
      isPlaying: this._isPlaying,
      currentTimeMicros: this.getCurrentTimeMicros(),
      bpm: this._bpm,
      audioContextState: this.audioCtx?.state ?? "unavailable",
    };
  }

  setBpm(bpm: number): void {
    this._bpm = bpm;
    this.notify();
  }

  subscribe(fn: ClockSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify(): void {
    const state = this.getState();
    for (const fn of this.subscribers) {
      fn(state);
    }
  }

  // ── 100ms Re-Anchor (drift correction) ────────────────

  private startReanchor(): void {
    this.stopReanchor();
    this.anchorIntervalId = setInterval(() => {
      this.notify();
    }, 100);
  }

  private stopReanchor(): void {
    if (this.anchorIntervalId !== null) {
      clearInterval(this.anchorIntervalId);
      this.anchorIntervalId = null;
    }
  }

  // ── rAF Loop (silent-fallback frame counting) ─────────

  private startRafLoop(): void {
    this.stopRafLoop();
    const tick = (timestamp: number) => {
      if (!this._isPlaying) return;

      if (this.useSilentFallback) {
        const delta = timestamp - this.lastFrameTimestamp;
        if (delta >= 1000 / this.targetFps) {
          this.frameCount++;
          this.lastFrameTimestamp = timestamp;
        }
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRafLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
