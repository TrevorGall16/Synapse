"use client";

import { useEffect, useRef } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";

/**
 * Mock playback loop using rAF.
 * Increments playheadPosition while isPlaying is true.
 * This is a UI-only mock — the real engine uses MasterClock/AudioContext.
 */
export function usePlaybackLoop() {
  const prevTimestamp = useRef(0);
  const rafRef = useRef(0);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  useEffect(() => {
    if (!isPlaying) {
      prevTimestamp.current = 0;
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const tick = (timestamp: number) => {
      const { playheadPosition, setPlayhead, togglePlayback } =
        usePlaybackStore.getState();
      const { duration } = useProjectStore.getState();

      if (prevTimestamp.current > 0) {
        const deltaMs = timestamp - prevTimestamp.current;
        const deltaMicros = Math.round(deltaMs * 1000);
        const nextPosition = playheadPosition + deltaMicros;

        if (nextPosition >= duration) {
          setPlayhead(duration);
          togglePlayback();
          return;
        }

        setPlayhead(nextPosition);
      }

      prevTimestamp.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    };

    prevTimestamp.current = 0;
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);
}
