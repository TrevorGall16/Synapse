import { create } from "zustand";
import type { Track, TrackType, MediaPoolItem, Marker, ClipEvent, PanCropData } from "./types";
import { getGridInterval } from "../utils/grid";
import { usePlaybackStore } from "./playback-store";
import {
  TRACK_COLORS, TRACK_HEIGHTS,
  createTrack, findClipLocation,
  findClipsByGroupId, computeMove,
  performSplitClip, performBulkSplit,
} from "./project-helpers";

// ── Structural Project Data ─────────────────────────────

export interface ProjectState {
  tracks: Track[];
  mediaPool: MediaPoolItem[];
  markers: Marker[];
  duration: number;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  inspectingClipId: string | null;
  activeUISection: "pool" | "inspector";
  inspectorSubTab: "pancrop" | "videofx" | "audiofx";
  snapEnabled: boolean;
  addTrack: (type: TrackType) => void;
  deleteTrack: (trackId: string) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  setOpacityOrVolume: (trackId: string, value: number) => void;
  addMediaItem: (item: MediaPoolItem) => void;
  addClip: (trackId: string, clip: ClipEvent) => void;
  moveClip: (clipId: string, deltaTime: number, deltaTrack: number) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  splitSelectedClips: (clipIds: string[], splitTime: number) => void;
  ungroupClips: (clipIds: string[]) => void;
  setSelectedClipIds: (ids: string[]) => void;
  reorderTrack: (startIndex: number, endIndex: number) => void;
  deleteSelectedClips: (clipIds: string[]) => void;
  updateMediaPeaks: (mediaId: string, peaks: number[]) => void;
  groupClips: (clipIds: string[]) => void;
  trimClip: (clipId: string, edge: "left" | "right", deltaMicros: number) => void;
  timeStretchClip: (clipId: string, newDuration: number) => void;
  joinClips: (clipIds: string[]) => void;
  setInspectingClipId: (id: string | null) => void;
  setActiveUISection: (section: "pool" | "inspector") => void;
  setInspectorSubTab: (tab: "pancrop" | "videofx" | "audiofx") => void;
  setTrackAudioParam: (trackId: string, params: Partial<Pick<Track, "audioPan" | "reverbWet" | "reverbRoomSize" | "delayMs" | "delayFeedback">>) => void;
  setClipLevel: (clipId: string, level: number) => void;
  setClipFade: (clipId: string, edge: "in" | "out", durationMicros: number) => void;
  setTrackColorCorrection: (trackId: string, params: Partial<Pick<Track, "trackBrightness" | "trackContrast" | "trackSaturate" | "trackHueRotate">>) => void;
  updateClipPanCrop: (clipId: string, panCrop: Partial<PanCropData>) => void;
  updateClipFxParams: (clipId: string, params: Record<string, unknown>) => void;
}

// ── Default State ───────────────────────────────────────

const DEFAULT_TRACKS: Track[] = [
  { id: "default-video-1", type: "video", name: "Video 1", color: TRACK_COLORS.video, height: TRACK_HEIGHTS.video, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-audio-1", type: "audio", name: "Audio 1", color: TRACK_COLORS.audio, height: TRACK_HEIGHTS.audio, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-effect-1", type: "effect", name: "Effect 1", color: TRACK_COLORS.effect, height: TRACK_HEIGHTS.effect, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-text-1", type: "text", name: "Text 1", color: TRACK_COLORS.text, height: TRACK_HEIGHTS.text, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
];

// ── Store ───────────────────────────────────────────────

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: DEFAULT_TRACKS,
  mediaPool: [],
  markers: [],
  duration: 300_000_000,
  selectedClipIds: [],
  selectedTrackId: null,
  inspectingClipId: null,
  activeUISection: "pool",
  inspectorSubTab: "pancrop",
  snapEnabled: true,

  addTrack: (type) =>
    set((s) => {
      const count = s.tracks.filter((t) => t.type === type).length + 1;
      return { tracks: [...s.tracks, createTrack(type, count)] };
    }),

  deleteTrack: (trackId) =>
    set((s) => ({
      tracks: s.tracks.filter((t) => t.id !== trackId),
    })),

  toggleMute: (trackId) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, isMuted: !t.isMuted } : t
      ),
    })),

  toggleSolo: (trackId) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, isSolo: !t.isSolo } : t
      ),
    })),

  setOpacityOrVolume: (trackId, value) =>
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, opacityOrVolume: value } : t
      ),
    })),

  addMediaItem: (item) =>
    set((s) => ({ mediaPool: [...s.mediaPool, item] })),

  addClip: (trackId, clip) =>
    set((s) => {
      const clipEnd = Math.round(clip.startTime + clip.duration);
      const newDuration = clipEnd > s.duration ? clipEnd + 60_000_000 : s.duration;
      return {
        duration: newDuration,
        tracks: s.tracks.map((t) =>
          t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
        ),
      };
    }),

  // ── Vegas Physics: Unified Move with groupId + same-type jumping ──
  moveClip: (clipId, deltaTime, deltaTrack) =>
    set((s) => {
      const result = computeMove(s, clipId, deltaTime, deltaTrack, usePlaybackStore.getState, getGridInterval);
      return result ?? s;
    }),

  splitClip: (clipId, splitTime) =>
    set((s) => {
      const result = performSplitClip(s.tracks, clipId, splitTime);
      return result ? { tracks: result } : s;
    }),

  splitSelectedClips: (clipIds, splitTime) =>
    set((s) => ({ tracks: performBulkSplit(s.tracks, clipIds, splitTime) })),

  setSelectedClipIds: (ids) => set({ selectedClipIds: ids }),

  ungroupClips: (clipIds) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          clipIds.includes(c.id) ? { ...c, groupId: undefined } : c
        ),
      })),
    })),

  reorderTrack: (startIndex, endIndex) =>
    set((s) => {
      if (startIndex === endIndex) return s;
      const tracks = [...s.tracks];
      const [moved] = tracks.splice(startIndex, 1);
      tracks.splice(endIndex, 0, moved);
      return { tracks };
    }),

  deleteSelectedClips: (clipIds) =>
    set((s) => {
      const { rippleMode } = usePlaybackStore.getState();
      const idSet = new Set(clipIds);
      const tracks = s.tracks.map((t) => {
        const deleted = t.clips.filter((c) => idSet.has(c.id));
        let remaining = t.clips.filter((c) => !idSet.has(c.id));
        // Ripple: close gaps left by deleted clips
        if (rippleMode && deleted.length > 0) {
          for (const d of deleted) {
            remaining = remaining.map((c) =>
              c.startTime > d.startTime
                ? { ...c, startTime: Math.max(0, c.startTime - d.duration) }
                : c
            );
          }
        }
        return { ...t, clips: remaining };
      });
      return { tracks, selectedClipIds: [] };
    }),

  updateMediaPeaks: (mediaId, peaks) =>
    set((s) => ({
      mediaPool: s.mediaPool.map((m) =>
        m.id === mediaId ? { ...m, peakManifest: peaks } : m
      ),
    })),

  groupClips: (clipIds) =>
    set((s) => {
      if (clipIds.length < 2) return s;
      const groupId = crypto.randomUUID();
      return {
        tracks: s.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            clipIds.includes(c.id) ? { ...c, groupId } : c
          ),
        })),
      };
    }),

  trimClip: (clipId, edge, deltaMicros) =>
    set((s) => {
      const MIN_DURATION = 33_333; // 1 frame at 30fps
      return {
        tracks: s.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== clipId) return c;
            if (edge === "right") {
              const newDuration = Math.max(MIN_DURATION, Math.round(c.duration + deltaMicros));
              return { ...c, duration: newDuration };
            } else {
              // Left edge: shift start, adjust duration and mediaOffset
              const maxDelta = c.duration - MIN_DURATION;
              const clampedDelta = Math.min(maxDelta, Math.max(-c.startTime, Math.round(deltaMicros)));
              return {
                ...c,
                startTime: c.startTime + clampedDelta,
                duration: c.duration - clampedDelta,
                mediaOffset: c.mediaOffset + clampedDelta,
              };
            }
          }),
        })),
      };
    }),

  timeStretchClip: (clipId, newDuration) =>
    set((s) => {
      const MIN_DURATION = 33_333;
      const clamped = Math.max(MIN_DURATION, Math.round(newDuration));
      return {
        tracks: s.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => {
            if (c.id !== clipId) return c;
            const rate = c.duration / clamped;
            return { ...c, duration: clamped, playbackRate: Math.round(rate * 100) / 100 };
          }),
        })),
      };
    }),

  joinClips: (clipIds) =>
    set((s) => {
      if (clipIds.length < 2) return s;

      const idSet = new Set(clipIds);
      const tracks = s.tracks.map((t) => {
        // Collect selected clips on this track
        const selected = t.clips.filter((c) => idSet.has(c.id));
        if (selected.length < 2) return t;

        // Group by sourceId — only merge clips from the same source
        const bySource = new Map<string, ClipEvent[]>();
        for (const c of selected) {
          const arr = bySource.get(c.sourceId) ?? [];
          arr.push(c);
          bySource.set(c.sourceId, arr);
        }

        let clips = [...t.clips];
        for (const [, group] of bySource) {
          if (group.length < 2) continue;

          // Sort by startTime
          group.sort((a, b) => a.startTime - b.startTime);
          const earliest = group[0];
          const newStartTime = earliest.startTime;
          const newEnd = Math.max(...group.map((c) => c.startTime + c.duration));

          const mergedFx = group.reduce<Record<string, unknown>>((acc, gc) => gc.fxParams ? { ...acc, ...gc.fxParams } : acc, {});
          const avgLevel = Math.round(group.reduce((sum, gc) => sum + (gc.level ?? 100), 0) / group.length);
          const merged: ClipEvent = {
            ...earliest,
            startTime: newStartTime,
            duration: newEnd - newStartTime,
            fxParams: Object.keys(mergedFx).length > 0 ? mergedFx : earliest.fxParams,
            level: avgLevel,
          };

          // Remove all group clips, insert the merged one
          const removeIds = new Set(group.map((c) => c.id));
          clips = clips.filter((c) => !removeIds.has(c.id));
          clips.push(merged);
        }

        return { ...t, clips };
      });

      return { tracks };
    }),

  setInspectingClipId: (id) => set({ inspectingClipId: id }),
  setActiveUISection: (section) => set({ activeUISection: section }),
  setInspectorSubTab: (tab) => set({ inspectorSubTab: tab }),

  setTrackAudioParam: (trackId, params) =>
    set((s) => ({
      tracks: s.tracks.map((t) => t.id === trackId ? { ...t, ...params } : t),
    })),

  setClipLevel: (clipId, level) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === clipId ? { ...c, level: Math.max(0, Math.min(100, Math.round(level))) } : c
        ),
      })),
    })),

  setClipFade: (clipId, edge, durationMicros) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          if (edge === "in") {
            return { ...c, fadeInDuration: Math.max(0, Math.round(durationMicros)), manualFadeIn: true };
          }
          return { ...c, fadeOutDuration: Math.max(0, Math.round(durationMicros)), manualFadeOut: true };
        }),
      })),
    })),

  setTrackColorCorrection: (trackId, params) =>
    set((s) => ({
      tracks: s.tracks.map((t) => t.id === trackId ? { ...t, ...params } : t),
    })),

  updateClipPanCrop: (clipId, panCrop) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === clipId
            ? { ...c, panCrop: { x: 0, y: 0, scale: 1, rotation: 0, ...c.panCrop, ...panCrop } }
            : c
        ),
      })),
    })),

  updateClipFxParams: (clipId, params) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === clipId ? { ...c, fxParams: { ...c.fxParams, ...params } } : c
        ),
      })),
    })),
}));
