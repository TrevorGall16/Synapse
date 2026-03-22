import { create } from "zustand";
import { useProjectStore } from "./project-store";

// ── Volatile 60fps State ────────────────────────────────
// Only <Playhead>, <TimelineRuler>, and <PreviewMonitor>
// should subscribe to this store.

export interface PlaybackState {
  playheadPosition: number;
  isPlaying: boolean;
  zoomLevel: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  containerWidth: number;
  loopRegion?: { in: number; out: number };
  selectionStart: number | null;
  selectionEnd: number | null;
  snapIndicatorMicros: number | null;
  /** true when the active snap is a "Perfect Cut" (end-to-start, 0 overlap) — renders white line */
  snapIsHardCut: boolean;
  setPlayhead: (time: number) => void;
  togglePlayback: () => void;
  setZoom: (zoom: number) => void;
  setScrollLeft: (left: number) => void;
  setContainerWidth: (width: number) => void;
  setSelection: (start: number | null, end: number | null) => void;
  clearSelection: () => void;
  /** Pass isHard=true to show a white "Perfect Cut" line instead of cyan crossfade line. */
  setSnapIndicator: (micros: number | null, isHard?: boolean) => void;
  masterVolume: number;
  setMasterVolume: (vol: number) => void;
  globalBpm: number;
  setGlobalBpm: (bpm: number) => void;
  rippleMode: boolean;
  toggleRippleMode: () => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  playheadPosition: 0,
  isPlaying: false,
  zoomLevel: 1,
  pixelsPerSecond: 100,
  scrollLeft: 0,
  containerWidth: 0,
  loopRegion: undefined,
  selectionStart: null,
  selectionEnd: null,
  snapIndicatorMicros: null,
  snapIsHardCut: false,

  setPlayhead: (time) =>
    set(() => {
      const duration = useProjectStore.getState().duration;
      return { playheadPosition: Math.max(0, Math.min(Math.round(time), duration)) };
    }),

  togglePlayback: () => set((s) => ({ isPlaying: !s.isPlaying })),

  setZoom: (zoom) =>
    set(() => {
      const clamped = Math.max(0.001, Math.min(3, zoom));
      return { zoomLevel: clamped, pixelsPerSecond: 100 * clamped };
    }),

  setScrollLeft: (left) => set({ scrollLeft: left }),

  setContainerWidth: (width) => set({ containerWidth: width }),

  setSelection: (start, end) => set({ selectionStart: start, selectionEnd: end }),
  clearSelection: () => set({ selectionStart: null, selectionEnd: null }),

  setSnapIndicator: (micros, isHard = false) =>
    set({ snapIndicatorMicros: micros, snapIsHardCut: micros !== null ? isHard : false }),

  masterVolume: 100,
  setMasterVolume: (vol) => set({ masterVolume: Math.max(0, Math.min(100, Math.round(vol))) }),

  globalBpm: 120,
  setGlobalBpm: (bpm) => set({ globalBpm: Math.max(20, Math.min(300, Math.round(bpm))) }),

  rippleMode: false,
  toggleRippleMode: () => set((s) => ({ rippleMode: !s.rippleMode })),
}));
