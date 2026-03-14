/** Microsecond integer timestamp (avoids floating-point drift over long sessions). */
export type MicrosecondTime = number;

/** Seconds-to-microseconds conversion factor. */
export const MICROS_PER_SECOND = 1_000_000;

export function secondsToMicros(seconds: number): MicrosecondTime {
  return Math.round(seconds * MICROS_PER_SECOND);
}

export function microsToSeconds(micros: MicrosecondTime): number {
  return micros / MICROS_PER_SECOND;
}

export interface MasterClockState {
  isPlaying: boolean;
  currentTimeMicros: MicrosecondTime;
  bpm: number;
  audioContextState: AudioContextState | "unavailable";
}

export interface EngineEvent {
  id: string;
  /** Start time relative to clip origin, in microseconds. */
  startMicros: MicrosecondTime;
  /** Duration in microseconds. */
  durationMicros: MicrosecondTime;
  type: string;
  payload: Record<string, unknown>;
}

export type ClockSubscriber = (state: MasterClockState) => void;
