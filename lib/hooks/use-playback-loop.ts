"use client";

import { useEffect, useRef } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { audioEngine } from "@/lib/audio/audio-engine";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";

/**
 * Playback loop — slaved to AudioContext.currentTime when available.
 *
 * F — GlobalTicker: Uses the centralized rAF loop instead of an independent
 * requestAnimationFrame chain. Audio-clock derivation is unchanged; only the
 * scheduling moves to GlobalTicker, eliminating a redundant GPU wake-up.
 *
 * @local-raf: none — fully migrated to GlobalTicker.
 *
 * On play start: anchors `audioEngine.setPlaybackOrigin(currentPlayhead)`.
 * Each tick: derives position from `ctx.currentTime - origin.audioCtxTime`,
 * eliminating rAF delta drift across long sessions and tab-backgrounding.
 *
 * Seek detection: if store's playheadPosition diverges from computed by >100ms,
 * re-anchor the origin and continue.
 *
 * Fallback: if no AudioContext yet, accumulates tick deltas (UI-only mode).
 */
export function usePlaybackLoop() {
  const prevTimestamp = useRef(0);
  const tickIdRef     = useRef<number | null>(null);
  const isPlaying     = usePlaybackStore((s) => s.isPlaying);

  useEffect(() => {
    if (!isPlaying) {
      prevTimestamp.current = 0;
      if (tickIdRef.current !== null) { unregisterTickCallback(tickIdRef.current); tickIdRef.current = null; }
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
          // GlobalTicker calls again next frame — no requestAnimationFrame needed here
          return;
        }
        nextPosition = computed;
      } else {
        // Fallback: tick-delta accumulation (no AudioContext)
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
        // Unregister self — playback is done
        if (tickIdRef.current !== null) { unregisterTickCallback(tickIdRef.current); tickIdRef.current = null; }
        return;
      }

      setPlayhead(nextPosition);
      prevTimestamp.current = timestamp;
      // GlobalTicker handles loop continuation — no requestAnimationFrame call here
    };

    prevTimestamp.current = 0;
    tickIdRef.current = registerTickCallback(tick);

    return () => {
      if (tickIdRef.current !== null) { unregisterTickCallback(tickIdRef.current); tickIdRef.current = null; }
    };
  }, [isPlaying]);
}
