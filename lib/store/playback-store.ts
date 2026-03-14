import { create } from "zustand";
import { useProjectStore } from "./project-store";

// ── Volatile 60fps State ────────────────────────────────
// Only <Playhead>, <TimelineRuler>, and <PreviewMonitor>
// should subscribe to this store.

export interface PlaybackState {
  playheadPosition: number; // microseconds, Math.round enforced
  isPlaying: boolean;
  zoomLevel: number; // 0.1 to 10
  loopRegion?: { in: number; out: number };
  setPlayhead: (time: number) => void;
  togglePlayback: () => void;
  setZoom: (zoom: number) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  playheadPosition: 0,
  isPlaying: false,
  zoomLevel: 1,
  loopRegion: undefined,

  setPlayhead: (time) =>
    set(() => {
      const duration = useProjectStore.getState().duration;
      return { playheadPosition: Math.max(0, Math.min(Math.round(time), duration)) };
    }),

  togglePlayback: () => set((s) => ({ isPlaying: !s.isPlaying })),

  setZoom: (zoom) =>
    set(() => ({
      zoomLevel: Math.max(0.1, Math.min(10, zoom)),
    })),
}));
