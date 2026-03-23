"use client";

import { useEffect, useRef } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { audioEngine } from "@/lib/audio/audio-engine";

/**
 * Playback loop — slaved to AudioContext.currentTime when available.
 *
 * On play start: anchors `audioEngine.setPlaybackOrigin(currentPlayhead)`.
 * Each rAF tick: derives position from `ctx.currentTime - origin.audioCtxTime`,
 * eliminating rAF delta drift across long sessions and tab-backgrounding.
 *
 * Seek detection: if the store's playheadPosition diverges from the computed
 * position by >100ms, a seek happened — re-anchor the origin and continue.
 *
 * Fallback: if no AudioContext is available yet, accumulates rAF deltas (UI-only mode).
 */
export function usePlaybackLoop() {
  const prevTimestamp = useRef(0);
  const rafRef = useRef(0);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  useEffect(() => {
    if (!isPlaying) {
      prevTimestamp.current = 0;
      cancelAnimationFrame(rafRef.current);
      audioEngine.clearPlaybackOrigin();
      return;
    }

    // Anchor origin at the moment playback starts
    audioEngine.ensureResumed();
    const { playheadPosition } = usePlaybackStore.getState();
    audioEngine.setPlaybackOrigin(playheadPosition);

    const tick = (timestamp: number) => {
      const { playheadPosition: currentPos, setPlayhead, togglePlayback } =
        usePlaybackStore.getState();
      const { duration } = useProjectStore.getState();

      const ctx    = audioEngine.getContext();
      const origin = audioEngine.getPlaybackOrigin();
      let nextPosition: number;

      if (ctx && origin) {
        const elapsedSecs = ctx.currentTime - origin.audioCtxTime;
        const computed    = origin.playheadMicros + Math.round(elapsedSecs * 1_000_000);

        // Seek detection: external setPlayhead moved the position far from computed
        if (Math.abs(currentPos - computed) > 100_000) {
          audioEngine.setPlaybackOrigin(currentPos);
          prevTimestamp.current = timestamp;
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        nextPosition = computed;
      } else {
        // Fallback: rAF delta accumulation
        if (prevTimestamp.current > 0) {
          const deltaMs = timestamp - prevTimestamp.current;
          nextPosition  = currentPos + Math.round(deltaMs * 1000);
        } else {
          nextPosition = currentPos;
        }
      }

      if (nextPosition >= duration) {
        setPlayhead(duration);
        togglePlayback();
        audioEngine.clearPlaybackOrigin();
        return;
      }

      setPlayhead(nextPosition);
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
