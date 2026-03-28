import { create } from "zustand";
import { useProjectStore } from "./project-store";
import { retainMedia } from "./media-pool-db";
import { canRemix } from "../policy";
import type { Track, ProjectSettings, MediaPoolItem } from "./types";
import type { FeedPost } from "./feed-store";

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
  /**
   * Load a FeedPost snapshot into the project store and reset playback.
   * This is the single canonical entry point for every Feed → Studio remix.
   * Calls openProjectInTab so attribution locks, media hydration, and the
   * effect-track guarantee all run automatically.
   *
   * Always generates a fresh projectId — never reuses the original post ID.
   * Sets playheadPosition + selectionStart/End from demoStartTime/demoDuration.
   */
  loadSnapshot: (
    snap: { tracks: Track[]; duration: number; projectSettings: ProjectSettings; mediaPool?: MediaPoolItem[] },
    meta: {
      remixedFromHandle?: string;
      parentPostId?: string;
      rootParentId?: string;
      rootParentHandle?: string;
      /** Micros into the project where the demo preview starts. */
      demoStartTime?: number;
      /** Duration of the demo window in micros. */
      demoDuration?: number;
      /**
       * The source FeedPost — required so the store can evaluate remix policy
       * directly via canRemix(post). No fallback tokens accepted.
       */
      post: FeedPost;
    }
  ) => void;
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

  loadSnapshot: (snap, meta) => {
    // Zero-trust policy gate: always evaluate canRemix against the source post.
    // No fallback tokens, no caller trust. Failure = hard error + no state mutation.
    if (!canRemix(meta.post)) {
      const msg = `[loadSnapshot] BLOCKED — remix policy denied for post ${meta.post.id}. State was NOT mutated.`;
      console.error(msg);
      throw new Error(msg);
    }

    const { demoStartTime, demoDuration } = meta;
    const freshId = crypto.randomUUID();

    // Ownership edge: retain each media blob so the source post can be deleted
    // without evicting assets now referenced by the remixed project.
    if (snap.mediaPool?.length) {
      snap.mediaPool.forEach((m) => retainMedia(m.id).catch(console.warn));
    }

    useProjectStore.getState().openProjectInTab({
      tracks:            snap.tracks,
      duration:          snap.duration,
      projectSettings:   snap.projectSettings,
      mediaPool:         snap.mediaPool,
      projectId:         freshId,
      name:              `Remix of @${meta.remixedFromHandle ?? "unknown"}`,
      remixedFromHandle: meta.remixedFromHandle,
      parentProjectId:   meta.parentPostId,
      rootParentId:      meta.rootParentId,
      rootParentHandle:  meta.rootParentHandle,
    });

    const startMicros = demoStartTime ?? 0;
    const endMicros =
      demoStartTime != null && demoDuration != null
        ? demoStartTime + demoDuration
        : null;

    set({
      isPlaying:      false,
      playheadPosition: startMicros,
      selectionStart:   startMicros > 0 ? startMicros : null,
      selectionEnd:     endMicros,
    });
  },
}));
