"use client";

import { useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { MasterClock } from "./master-clock";
import type { MasterClockState } from "./types";

const DEFAULT_STATE: MasterClockState = {
  isPlaying: false,
  currentTimeMicros: 0,
  bpm: 120,
  audioContextState: "unavailable",
};

/**
 * React hook bridging the MasterClock engine to UI.
 *
 * Hydration-safe: AudioContext is only created inside useEffect.
 * Uses useRef to hold the clock instance — no heavy state in React.
 */
export function useMasterClock() {
  const clockRef = useRef<MasterClock | null>(null);
  const stateRef = useRef<MasterClockState>(DEFAULT_STATE);

  // Hydration-safe initialization
  useEffect(() => {
    const clock = new MasterClock();
    clockRef.current = clock;

    const unsub = clock.subscribe((state) => {
      stateRef.current = state;
    });

    clock.init();

    return () => {
      unsub();
      clock.destroy();
      clockRef.current = null;
    };
  }, []);

  // Lightweight external store subscription for React reads
  const subscribe = useCallback((onStoreChange: () => void) => {
    const clock = clockRef.current;
    if (!clock) return () => {};
    return clock.subscribe(() => {
      onStoreChange();
    });
  }, []);

  const getSnapshot = useCallback(() => stateRef.current, []);
  const getServerSnapshot = useCallback(() => DEFAULT_STATE, []);

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const play = useCallback(() => clockRef.current?.play(), []);
  const pause = useCallback(() => clockRef.current?.pause(), []);
  const seek = useCallback((t: number) => clockRef.current?.seek(t), []);
  const setBpm = useCallback((bpm: number) => clockRef.current?.setBpm(bpm), []);

  return { state, play, pause, seek, setBpm };
}
