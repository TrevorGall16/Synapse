import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track, TrackType, MediaPoolItem, Marker, ClipEvent, PanCropData, ProjectSettings, HistorySnapshot } from "./types";
import { usePlaybackStore } from "./playback-store";
import {
  TRACK_COLORS, TRACK_HEIGHTS,
  createTrack, findClipLocation,
  findClipsByGroupId, computeMove,
  performSplitClip, performBulkSplit,
  computeCrossfades,
} from "./project-helpers";

// ── Structural Project Data ─────────────────────────────

export interface ProjectState {
  tracks: Track[];
  mediaPool: MediaPoolItem[];
  markers: Marker[];
  duration: number;
  projectId: string;
  parentProjectId?: string;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  inspectingClipId: string | null;
  activeUISection: "pool" | "inspector" | "history";
  inspectorSubTab: "pancrop" | "videofx" | "audiofx";
  snapEnabled: boolean;
  projectSettings: ProjectSettings;
  historyPast: HistorySnapshot[];
  historyFuture: HistorySnapshot[];
  snapshotHistory: (label: string) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (snapshot: { tracks: Track[]; duration: number; projectSettings: ProjectSettings }) => void;
  /** Fork an existing project: assigns a new projectId, records parentProjectId for lineage tracking. */
  forkProject: (snapshot: { tracks: Track[]; duration: number; projectSettings: ProjectSettings; projectId?: string; mediaPool?: MediaPoolItem[] }) => void;
  setProjectSettings: (s: ProjectSettings) => void;
  addTrack: (type: TrackType) => void;
  deleteTrack: (trackId: string) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  setOpacityOrVolume: (trackId: string, value: number) => void;
  name: string;
  setName: (name: string) => void;
  resetProject: () => void;
  addMediaItem: (item: MediaPoolItem) => void;
  updateMediaItemUrl: (id: string, url: string) => void;
  setMediaPool: (items: MediaPoolItem[]) => void;
  addClip: (trackId: string, clip: ClipEvent) => void;
  moveClip: (clipId: string, deltaTime: number, deltaTrack: number) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  splitSelectedClips: (clipIds: string[], splitTime: number) => void;
  ungroupClips: (clipIds: string[]) => void;
  setSelectedClipIds: (ids: string[]) => void;
  setSelectedTrackId: (id: string | null) => void;
  reorderTrack: (startIndex: number, endIndex: number) => void;
  deleteSelectedClips: (clipIds: string[]) => void;
  updateMediaPeaks: (mediaId: string, peaks: number[]) => void;
  groupClips: (clipIds: string[]) => void;
  trimClip: (clipId: string, edge: "left" | "right", deltaMicros: number) => void;
  timeStretchClip: (clipId: string, newDuration: number) => void;
  joinClips: (clipIds: string[]) => void;
  setInspectingClipId: (id: string | null) => void;
  setActiveUISection: (section: "pool" | "inspector" | "history") => void;
  setInspectorSubTab: (tab: "pancrop" | "videofx" | "audiofx") => void;
  setTrackAudioParam: (trackId: string, params: Partial<Pick<Track, "audioPan" | "reverbWet" | "reverbRoomSize" | "delayMs" | "delayFeedback">>) => void;
  setClipLevel: (clipId: string, level: number) => void;
  setClipFade: (clipId: string, edge: "in" | "out", durationMicros: number) => void;
  setTrackColorCorrection: (trackId: string, params: Partial<Pick<Track, "trackBrightness" | "trackContrast" | "trackSaturate" | "trackHueRotate">>) => void;
  updateClipPanCrop: (clipId: string, panCrop: Partial<PanCropData>) => void;
  updateClipFxParams: (clipId: string, params: Record<string, unknown>) => void;
  fxMaskEditingClipId: string | null;
  setFxMaskEditingClipId: (id: string | null) => void;
  updateFxMask: (clipId: string, mask: Partial<PanCropData>) => void;
  setTrackCollapsed: (trackId: string, collapsed: boolean) => void;
  setTrackColor: (trackId: string, color: string) => void;
  addMarker: (marker: Marker) => void;
  removeMarker: (id: string) => void;
}
const MIN_CLIP_DURATION = 33_333; // 1 frame @ 30fps
const MAX_HISTORY = 50;

// ── Default State ───────────────────────────────────────

const DEFAULT_TRACKS: Track[] = [
  { id: "default-video-1", type: "video", name: "Video 1", color: TRACK_COLORS.video, height: TRACK_HEIGHTS.video, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-audio-1", type: "audio", name: "Audio 1", color: TRACK_COLORS.audio, height: TRACK_HEIGHTS.audio, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-effect-1", type: "effect", name: "Effect 1", color: TRACK_COLORS.effect, height: TRACK_HEIGHTS.effect, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-text-1", type: "text", name: "Text 1", color: TRACK_COLORS.text, height: TRACK_HEIGHTS.text, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
];

export const useProjectStore = create<ProjectState>()(persist((set) => ({
  tracks: DEFAULT_TRACKS,
  mediaPool: [],
  markers: [],
  duration: 300_000_000,
  projectId: "",
  name: "Untitled Project",
  parentProjectId: undefined,
  selectedClipIds: [],
  selectedTrackId: null,
  inspectingClipId: null,
  activeUISection: "pool",
  inspectorSubTab: "pancrop",
  snapEnabled: true,
  fxMaskEditingClipId: null,
  projectSettings: { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1.0, gammaTag: "sRGB" },
  historyPast: [],
  historyFuture: [],
  snapshotHistory: (label) =>
    set((s) => ({
      historyPast: [...s.historyPast.slice(-(MAX_HISTORY - 1)), { tracks: s.tracks, duration: s.duration, markers: s.markers, label }],
      historyFuture: [],
    })),

  undo: () =>
    set((s) => {
      if (!s.historyPast.length) return s;
      const past = s.historyPast.slice(0, -1);
      const snap = s.historyPast[s.historyPast.length - 1];
      const current: HistorySnapshot = { tracks: s.tracks, duration: s.duration, markers: s.markers, label: snap.label };
      return { tracks: snap.tracks, duration: snap.duration, markers: snap.markers, historyPast: past, historyFuture: [current, ...s.historyFuture.slice(0, MAX_HISTORY - 1)], selectedClipIds: [] };
    }),

  redo: () =>
    set((s) => {
      if (!s.historyFuture.length) return s;
      const [snap, ...future] = s.historyFuture;
      const current: HistorySnapshot = { tracks: s.tracks, duration: s.duration, markers: s.markers, label: snap.label };
      return { tracks: snap.tracks, duration: snap.duration, markers: snap.markers, historyFuture: future, historyPast: [...s.historyPast.slice(0, MAX_HISTORY - 1), current], selectedClipIds: [] };
    }),
  addTrack: (type) =>
    set((s) => {
      const count = s.tracks.filter((t) => t.type === type).length + 1;
      return { tracks: [...s.tracks, createTrack(type, count)] };
    }),

  deleteTrack: (trackId) =>
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== trackId) })),

  toggleMute: (trackId) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, isMuted: !t.isMuted } : t) })),

  toggleSolo: (trackId) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, isSolo: !t.isSolo } : t) })),

  setOpacityOrVolume: (trackId, value) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, opacityOrVolume: value } : t) })),

  setName: (name) => set({ name }),
  resetProject: () => set({ tracks: DEFAULT_TRACKS, mediaPool: [], markers: [], duration: 300_000_000, projectId: "", name: "Untitled Project", historyPast: [], historyFuture: [], selectedClipIds: [], selectedTrackId: null, inspectingClipId: null }),
  addMediaItem: (item) =>
    set((s) => ({ mediaPool: [...s.mediaPool, item] })),
  updateMediaItemUrl: (id, url) =>
    set((s) => ({ mediaPool: s.mediaPool.map((m) => m.id === id ? { ...m, previewUrl: url } : m) })),
  setMediaPool: (items) => set({ mediaPool: items }),

  addClip: (trackId, clip) =>
    set((s) => {
      const clipEnd = Math.round(clip.startTime + clip.duration);
      const newDuration = clipEnd > s.duration ? clipEnd + 60_000_000 : s.duration;
      return {
        duration: newDuration,
        tracks: s.tracks.map((t) =>
          t.id === trackId
            ? { ...t, clips: computeCrossfades([...t.clips, clip]) }
            : t
        ),
      };
    }),
  moveClip: (clipId, deltaTime, deltaTrack) =>
    set((s) => {
      const result = computeMove(s, clipId, deltaTime, deltaTrack, usePlaybackStore.getState);
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
  setSelectedTrackId: (id) => set({ selectedTrackId: id }),

  ungroupClips: (clipIds) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => clipIds.includes(c.id) ? { ...c, groupId: undefined } : c),
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
        if (rippleMode && deleted.length > 0) {
          for (const d of deleted) {
            remaining = remaining.map((c) =>
              c.startTime > d.startTime
                ? { ...c, startTime: Math.max(0, c.startTime - d.duration) }
                : c
            );
          }
        }
        return { ...t, clips: computeCrossfades(remaining) };
      });
      return { tracks, selectedClipIds: [] };
    }),

  updateMediaPeaks: (mediaId, peaks) =>
    set((s) => ({
      mediaPool: s.mediaPool.map((m) => m.id === mediaId ? { ...m, peakManifest: peaks } : m),
    })),

  groupClips: (clipIds) =>
    set((s) => {
      if (clipIds.length < 2) return s;
      const groupId = crypto.randomUUID();
      return {
        tracks: s.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => clipIds.includes(c.id) ? { ...c, groupId } : c),
        })),
      };
    }),

  trimClip: (clipId, edge, deltaMicros) =>
    set((s) => ({
      tracks: s.tracks.map((t) => {
        if (!t.clips.some((c) => c.id === clipId)) return t;
        const updated = t.clips.map((c) => {
          if (c.id !== clipId) return c;
          if (edge === "right") {
            return { ...c, duration: Math.max(MIN_CLIP_DURATION, Math.round(c.duration + deltaMicros)) };
          }
          const maxDelta = c.duration - MIN_CLIP_DURATION;
          const clampedDelta = Math.min(maxDelta, Math.max(-c.startTime, Math.round(deltaMicros)));
          return { ...c, startTime: c.startTime + clampedDelta, duration: c.duration - clampedDelta, mediaOffset: c.mediaOffset + clampedDelta };
        });
        return { ...t, clips: computeCrossfades(updated) };
      }),
    })),

  timeStretchClip: (clipId, newDuration) =>
    set((s) => {
      const clamped = Math.max(MIN_CLIP_DURATION, Math.round(newDuration));
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
        const selected = t.clips.filter((c) => idSet.has(c.id));
        if (selected.length < 2) return t;
        const bySource = new Map<string, ClipEvent[]>();
        for (const c of selected) {
          const arr = bySource.get(c.sourceId) ?? [];
          arr.push(c);
          bySource.set(c.sourceId, arr);
        }
        let clips = [...t.clips];
        for (const [, group] of bySource) {
          if (group.length < 2) continue;
          group.sort((a, b) => a.startTime - b.startTime);
          const earliest = group[0];
          const newEnd = group.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
          const mergedFx = group.reduce<Record<string, unknown>>((acc, gc) => gc.fxParams ? { ...acc, ...gc.fxParams } : acc, {});
          const avgLevel = Math.round(group.reduce((sum, gc) => sum + (gc.level ?? 100), 0) / group.length);
          const merged: ClipEvent = { ...earliest, startTime: earliest.startTime, duration: newEnd - earliest.startTime, fxParams: Object.keys(mergedFx).length > 0 ? mergedFx : earliest.fxParams, level: avgLevel };
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
  setProjectSettings: (s) => set({ projectSettings: s }),

  setTrackAudioParam: (trackId, params) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, ...params } : t) })),

  setClipLevel: (clipId, level) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => c.id === clipId ? { ...c, level: Math.max(0, Math.min(100, Math.round(level))) } : c),
      })),
    })),

  setClipFade: (clipId, edge, durationMicros) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => {
          if (c.id !== clipId) return c;
          if (edge === "in") return { ...c, fadeInDuration: Math.max(0, Math.round(durationMicros)), manualFadeIn: true };
          return { ...c, fadeOutDuration: Math.max(0, Math.round(durationMicros)), manualFadeOut: true };
        }),
      })),
    })),

  setTrackColorCorrection: (trackId, params) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, ...params } : t) })),

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
        clips: t.clips.map((c) => c.id === clipId ? { ...c, fxParams: { ...c.fxParams, ...params } } : c),
      })),
    })),

  loadProject: (snapshot) => set({
    tracks: snapshot.tracks, duration: snapshot.duration, projectSettings: snapshot.projectSettings,
    projectId: crypto.randomUUID(), parentProjectId: undefined,
    selectedClipIds: [], selectedTrackId: null, inspectingClipId: null, historyPast: [], historyFuture: [],
  }),

  forkProject: (snapshot) => set({
    tracks: snapshot.tracks, duration: snapshot.duration, projectSettings: snapshot.projectSettings,
    mediaPool: snapshot.mediaPool ?? [], markers: [],
    projectId: crypto.randomUUID(), parentProjectId: snapshot.projectId ?? undefined,
    selectedClipIds: [], selectedTrackId: null, inspectingClipId: null, historyPast: [], historyFuture: [],
  }),

  setTrackCollapsed: (trackId, collapsed) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, collapsed } : t) })),

  setTrackColor: (trackId, color) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, color } : t) })),

  addMarker: (marker) =>
    set((s) => ({ markers: [...s.markers, marker] })),

  removeMarker: (id) =>
    set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),

  setFxMaskEditingClipId: (id) => set({ fxMaskEditingClipId: id }),

  updateFxMask: (clipId, mask) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.id === clipId
            ? { ...c, fxParams: { ...c.fxParams, fxMask: { x: 0, y: 0, scale: 1, rotation: 0, ...((c.fxParams?.fxMask as object) ?? {}), ...mask } } }
            : c
        ),
      })),
    })),
}), { name: "synapse-project", skipHydration: true, partialize: (s: ProjectState) => ({ tracks: s.tracks, duration: s.duration, projectId: s.projectId, name: s.name, parentProjectId: s.parentProjectId, projectSettings: s.projectSettings, markers: s.markers, mediaPool: s.mediaPool.map((m) => ({ ...m, previewUrl: "" })) }) }));
