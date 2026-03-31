import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track, TrackType, MediaPoolItem, Marker, ClipEvent, PanCropData, ProjectSettings, HistorySnapshot, SerializedProject } from "./types";
import { usePlaybackStore } from "./playback-store";
import { hydrateMediaPool } from "./media-pool-db";
import { saveAttributionLock } from "./attribution-idb";
import { flushProjectToIDB } from "@/lib/store/flush-registry";
import { useSaveBarrierStore } from "@/lib/store/save-barrier-store";
import {
  TRACK_COLORS, TRACK_HEIGHTS,
  createTrack, findClipLocation,
  findClipsByGroupId, computeMove,
  performSplitClip, performBulkSplit,
  computeCrossfades, performJoinClips, performDeleteClips,
  performRestoreOriginal,
} from "./project-helpers";

/** Revoke any blob: previewUrls in a media pool to free browser memory. */
function revokeMediaPool(pool: MediaPoolItem[]) {
  for (const item of pool) {
    if (item.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
}

export interface ProjectState {
  tracks: Track[];
  mediaPool: MediaPoolItem[];
  markers: Marker[];
  duration: number;
  projectId: string;
  parentProjectId?: string;
  remixedFromHandle?: string;
  rootParentId?: string;
  rootParentHandle?: string;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  inspectingClipId: string | null;
  activeUISection: "pool" | "inspector" | "history" | "presets";
  inspectorSubTab: "pancrop" | "videofx" | "audiofx";
  snapEnabled: boolean;
  projectSettings: ProjectSettings;
  historyPast: HistorySnapshot[];
  historyFuture: HistorySnapshot[];
  openProjectIds: string[];
  savedProjects: Record<string, SerializedProject>;
  snapshotHistory: (label: string) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (snapshot: { tracks: Track[]; duration: number; projectSettings: ProjectSettings }) => void;
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
  openNewTab: () => void;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  openProjectInTab: (snap: { tracks: Track[]; duration: number; projectSettings: ProjectSettings; projectId?: string; mediaPool?: MediaPoolItem[]; name?: string; parentProjectId?: string; remixedFromHandle?: string; rootParentId?: string; rootParentHandle?: string }) => void;
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
  setActiveUISection: (section: "pool" | "inspector" | "history" | "presets") => void;
  setInspectorSubTab: (tab: "pancrop" | "videofx" | "audiofx") => void;
  setTrackAudioParam: (trackId: string, params: Partial<Pick<Track, "audioPan" | "reverbWet" | "reverbRoomSize" | "delayMs" | "delayFeedback">>) => void;
  setClipLevel: (clipId: string, level: number) => void;
  setClipFade: (clipId: string, edge: "in" | "out", durationMicros: number) => void;
  setTrackColorCorrection: (trackId: string, params: Partial<Pick<Track, "trackBrightness" | "trackContrast" | "trackSaturate" | "trackHueRotate">>) => void;
  updateClipPanCrop: (clipId: string, panCrop: Partial<PanCropData>) => void;
  updateClipFxParams: (clipId: string, params: Record<string, unknown>, mode?: "replace" | "merge") => void;
  fxMaskEditingClipId: string | null;
  setFxMaskEditingClipId: (id: string | null) => void;
  updateFxMask: (clipId: string, mask: Partial<PanCropData>) => void;
  setTrackCollapsed: (trackId: string, collapsed: boolean) => void;
  setTrackColor: (trackId: string, color: string) => void;
  addMarker: (marker: Marker) => void;
  removeMarker: (id: string) => void;
  removeProject: (id: string) => void;
  restoreOriginalClips: (clipIds: string[]) => void;
}

const MIN_CLIP_DURATION = 33_333;
const MAX_HISTORY = 50;

const DEFAULT_TRACKS: Track[] = [
  { id: "default-video-1", type: "video", name: "Video 1", color: TRACK_COLORS.video, height: TRACK_HEIGHTS.video, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-audio-1", type: "audio", name: "Audio 1", color: TRACK_COLORS.audio, height: TRACK_HEIGHTS.audio, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-effect-1", type: "effect", name: "Effect 1", color: TRACK_COLORS.effect, height: TRACK_HEIGHTS.effect, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "default-text-1", type: "text", name: "Text 1", color: TRACK_COLORS.text, height: TRACK_HEIGHTS.text, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
];

function serializeActive(s: ProjectState): SerializedProject {
  return { projectId: s.projectId, name: s.name, tracks: s.tracks, mediaPool: s.mediaPool, markers: s.markers, duration: s.duration, projectSettings: s.projectSettings, parentProjectId: s.parentProjectId, remixedFromHandle: s.remixedFromHandle, rootParentId: s.rootParentId, rootParentHandle: s.rootParentHandle, historyPast: s.historyPast, historyFuture: s.historyFuture };
}

export const useProjectStore = create<ProjectState>()(persist((set) => ({
  tracks: DEFAULT_TRACKS,
  mediaPool: [],
  markers: [],
  duration: 300_000_000,
  projectId: "",
  name: "Untitled Project",
  parentProjectId: undefined,
  remixedFromHandle: undefined,
  rootParentId: undefined,
  rootParentHandle: undefined,
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
  openProjectIds: [],
  savedProjects: {},

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

  resetProject: () => set((s) => {
    revokeMediaPool(s.mediaPool);
    const newId = crypto.randomUUID();
    return { tracks: DEFAULT_TRACKS, mediaPool: [], markers: [], duration: 300_000_000, projectId: newId, name: "Untitled Project", historyPast: [], historyFuture: [], selectedClipIds: [], selectedTrackId: null, inspectingClipId: null, openProjectIds: [newId], savedProjects: {}, parentProjectId: undefined, remixedFromHandle: undefined, rootParentId: undefined, rootParentHandle: undefined };
  }),

  openNewTab: () => set((s) => {
    const newId = crypto.randomUUID();
    const ids = s.openProjectIds.includes(s.projectId) ? s.openProjectIds : [...s.openProjectIds, s.projectId];
    return { tracks: DEFAULT_TRACKS, mediaPool: [], markers: [], duration: 300_000_000, projectId: newId, name: "Untitled Project", historyPast: [], historyFuture: [], selectedClipIds: [], selectedTrackId: null, inspectingClipId: null, savedProjects: { ...s.savedProjects, [s.projectId]: serializeActive(s) }, openProjectIds: [...ids, newId], parentProjectId: undefined, remixedFromHandle: undefined, rootParentId: undefined, rootParentHandle: undefined };
  }),

  switchTab: (id) => set((s) => {
    if (id === s.projectId) return s;
    const target = s.savedProjects[id];
    if (!target) return s;
    const { [id]: _d, ...rest } = s.savedProjects;
    const ids = s.openProjectIds.includes(s.projectId) ? s.openProjectIds : [...s.openProjectIds, s.projectId];
    return { ...target, savedProjects: { ...rest, [s.projectId]: serializeActive(s) }, openProjectIds: ids, selectedClipIds: [], inspectingClipId: null };
  }),

  closeTab: (id) => set((s) => {
    const ids = s.openProjectIds.filter((x) => x !== id);
    if (id !== s.projectId) {
      const { [id]: _d, ...rest } = s.savedProjects;
      return { openProjectIds: ids, savedProjects: rest };
    }
    // Last tab closed — blank out the active project but keep savedProjects intact so
    // the gallery page's "Open" action can still switch back to any saved project.
    if (ids.length === 0) { revokeMediaPool(s.mediaPool); return { tracks: DEFAULT_TRACKS, mediaPool: [], markers: [], duration: 300_000_000, projectId: "", name: "Untitled Project", historyPast: [], historyFuture: [], selectedClipIds: [], selectedTrackId: null, inspectingClipId: null, openProjectIds: [], savedProjects: s.savedProjects }; }
    const prevIdx = s.openProjectIds.indexOf(id);
    const nextId = ids[Math.max(0, prevIdx - 1)];
    const target = s.savedProjects[nextId];
    if (!target) return { openProjectIds: ids };
    const { [nextId]: _d, ...rest } = s.savedProjects;
    return { ...target, openProjectIds: ids, savedProjects: rest, selectedClipIds: [], inspectingClipId: null };
  }),

  openProjectInTab: (snap) => {
    // Compute the new ID before set() so we can reference it in the async follow-up.
    const incomingId = snap.projectId ?? crypto.randomUUID();

    // Attribution lock: write to IDB at fork time so publish-modal reads authoritative values.
    if (snap.remixedFromHandle) {
      const rootParentId     = snap.rootParentId     || snap.parentProjectId || undefined;
      const rootParentHandle = snap.rootParentHandle || snap.remixedFromHandle || undefined;
      saveAttributionLock(incomingId, {
        parentProjectId: snap.parentProjectId, remixedFromHandle: snap.remixedFromHandle,
        rootParentId, rootParentHandle, lockedAt: Date.now(),
      }).catch(console.warn);
    }

    set((s) => {
      const ids = s.openProjectIds.includes(s.projectId) ? s.openProjectIds : [...s.openProjectIds, s.projectId];
      if (ids.includes(incomingId)) {
        if (incomingId === s.projectId) return s;
        const target = s.savedProjects[incomingId];
        if (!target) return s;
        const { [incomingId]: _d, ...rest } = s.savedProjects;
        return { ...target, savedProjects: { ...rest, [s.projectId]: serializeActive(s) }, openProjectIds: ids, selectedClipIds: [], inspectingClipId: null };
      }
      // Deep-copy tracks and mediaPool to prevent state leaking between tabs.
      let tracksDeep: Track[] = JSON.parse(JSON.stringify(snap.tracks));
      const mediaPoolDeep: MediaPoolItem[] = JSON.parse(JSON.stringify(snap.mediaPool ?? []));

      // Attribution: use || to handle both null and undefined from Zustand persistence
      const rootParentId     = snap.rootParentId     || snap.parentProjectId || undefined;
      const rootParentHandle = snap.rootParentHandle || snap.remixedFromHandle || undefined;

      // Remix UX: ensure an effect track exists so the remixer can add new FX without "Add Track"
      const isRemix = !!snap.remixedFromHandle;
      if (isRemix && !tracksDeep.find((t) => t.type === "effect")) {
        tracksDeep = [...tracksDeep, createTrack("effect", 1)];
      }

      const newProj: SerializedProject = { projectId: incomingId, name: snap.name ?? "Untitled", tracks: tracksDeep, mediaPool: mediaPoolDeep, markers: [], duration: snap.duration, projectSettings: snap.projectSettings, parentProjectId: snap.parentProjectId ?? snap.projectId, remixedFromHandle: snap.remixedFromHandle, rootParentId, rootParentHandle, historyPast: [], historyFuture: [] };
      return { ...newProj, savedProjects: { ...s.savedProjects, [s.projectId]: serializeActive(s) }, openProjectIds: [...ids, incomingId], selectedClipIds: [], inspectingClipId: null };
    });

    // Async: always re-hydrate the new tab's media pool from IDB.
    // "Always" is correct here: blob URLs in the incoming snap may be from a prior session
    // and are already expired. hydrateMediaPool skips items with non-blob URLs automatically.
    const { projectId: activeId, mediaPool: activePool } = useProjectStore.getState();
    if (activeId === incomingId && activePool.length > 0) {
      hydrateMediaPool(activePool).then((hydrated) => {
        hydrated.forEach((item) => {
          if (item.previewUrl && useProjectStore.getState().projectId === incomingId) {
            useProjectStore.getState().updateMediaItemUrl(item.id, item.previewUrl);
          }
        });
      }).catch(console.warn);
    }
  },

  addMediaItem: (item) =>
    set((s) => ({ mediaPool: [...s.mediaPool, item] })),

  updateMediaItemUrl: (id, url) =>
    set((s) => ({ mediaPool: s.mediaPool.map((m) => m.id === id ? { ...m, previewUrl: url } : m) })),

  setMediaPool: (items) => set({ mediaPool: items }),

  addClip: (trackId, clip) =>
    set((s) => {
      const clipEnd = Math.round(clip.startTime + clip.duration);
      const newDuration = clipEnd > s.duration ? clipEnd + 60_000_000 : s.duration;
      return { duration: newDuration, tracks: s.tracks.map((t) => t.id === trackId ? { ...t, clips: computeCrossfades([...t.clips, clip]) } : t) };
    }),

  moveClip: (clipId, deltaTime, deltaTrack) =>
    set((s) => { const result = computeMove(s, clipId, deltaTime, deltaTrack, usePlaybackStore.getState); return result ?? s; }),

  splitClip: (clipId, splitTime) =>
    set((s) => { const result = performSplitClip(s.tracks, clipId, splitTime); return result ? { tracks: result } : s; }),

  splitSelectedClips: (clipIds, splitTime) =>
    set((s) => ({ tracks: performBulkSplit(s.tracks, clipIds, splitTime) })),

  setSelectedClipIds: (ids) => set({ selectedClipIds: ids }),
  setSelectedTrackId: (id) => set({ selectedTrackId: id }),

  ungroupClips: (clipIds) =>
    set((s) => ({ tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => clipIds.includes(c.id) ? { ...c, groupId: undefined } : c) })) })),

  reorderTrack: (startIndex, endIndex) =>
    set((s) => {
      if (startIndex === endIndex) return s;
      const tracks = [...s.tracks];
      const [moved] = tracks.splice(startIndex, 1);
      tracks.splice(endIndex, 0, moved);
      return { tracks };
    }),

  deleteSelectedClips: (clipIds) =>
    set((s) => ({ tracks: performDeleteClips(s.tracks, clipIds, usePlaybackStore.getState().rippleMode), selectedClipIds: [] })),

  updateMediaPeaks: (mediaId, peaks) =>
    set((s) => ({ mediaPool: s.mediaPool.map((m) => m.id === mediaId ? { ...m, peakManifest: peaks } : m) })),

  groupClips: (clipIds) =>
    set((s) => {
      if (clipIds.length < 2) return s;
      const groupId = crypto.randomUUID();
      return { tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => clipIds.includes(c.id) ? { ...c, groupId } : c) })) };
    }),

  trimClip: (clipId, edge, deltaMicros) =>
    set((s) => ({
      tracks: s.tracks.map((t) => {
        if (!t.clips.some((c) => c.id === clipId)) return t;
        const updated = t.clips.map((c) => {
          if (c.id !== clipId) return c;
          if (edge === "right") return { ...c, duration: Math.max(MIN_CLIP_DURATION, Math.round(c.duration + deltaMicros)) };
          const maxDelta = c.duration - MIN_CLIP_DURATION;
          const clampedDelta = Math.min(maxDelta, Math.max(-c.startTime, Math.round(deltaMicros)));
          return { ...c, startTime: c.startTime + clampedDelta, duration: c.duration - clampedDelta, mediaOffset: c.mediaOffset + clampedDelta };
        });
        return { ...t, clips: computeCrossfades(updated) };
      }),
    })),

  timeStretchClip: (clipId, newDuration) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => {
        if (c.id !== clipId) return c;
        const clamped = Math.max(MIN_CLIP_DURATION, Math.round(newDuration));
        return { ...c, duration: clamped, playbackRate: Math.round((c.duration / clamped) * 100) / 100 };
      }) })),
    })),

  joinClips: (clipIds) => set((s) => ({ tracks: performJoinClips(s.tracks, clipIds) })),
  setInspectingClipId: (id) => set({ inspectingClipId: id }),
  setActiveUISection: (section) => set({ activeUISection: section }),
  setInspectorSubTab: (tab) => set({ inspectorSubTab: tab }),
  setProjectSettings: (s) => set({ projectSettings: s }),
  setTrackAudioParam: (trackId, params) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, ...params } : t) })),
  setClipLevel: (clipId, level) =>
    set((s) => ({ tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => c.id === clipId ? { ...c, level: Math.max(0, Math.min(100, Math.round(level))) } : c) })) })),
  setClipFade: (clipId, edge, durationMicros) =>
    set((s) => ({ tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => {
      if (c.id !== clipId) return c;
      return edge === "in"
        ? { ...c, fadeInDuration: Math.max(0, Math.round(durationMicros)), manualFadeIn: true }
        : { ...c, fadeOutDuration: Math.max(0, Math.round(durationMicros)), manualFadeOut: true };
    }) })) })),
  setTrackColorCorrection: (trackId, params) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, ...params } : t) })),
  updateClipPanCrop: (clipId, panCrop) =>
    set((s) => ({ tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) =>
      c.id === clipId ? { ...c, panCrop: { x: 0, y: 0, scale: 1, rotation: 0, ...c.panCrop, ...panCrop } } : c) })) })),
  updateClipFxParams: (clipId, params, mode = "replace") =>
    set((s) => ({ tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) =>
      c.id === clipId
        ? { ...c, fxParams: mode === "merge" ? { ...c.fxParams, ...params } : params }
        : c) })) })),
  loadProject: (snapshot) => set((s) => {
    revokeMediaPool(s.mediaPool);
    return { tracks: snapshot.tracks, duration: snapshot.duration, projectSettings: snapshot.projectSettings,
      projectId: crypto.randomUUID(), parentProjectId: undefined,
      selectedClipIds: [], selectedTrackId: null, inspectingClipId: null, historyPast: [], historyFuture: [] };
  }),
  forkProject: (snapshot) => set((s) => {
    revokeMediaPool(s.mediaPool);
    return { tracks: snapshot.tracks, duration: snapshot.duration, projectSettings: snapshot.projectSettings,
      mediaPool: snapshot.mediaPool ?? [], markers: [], projectId: crypto.randomUUID(),
      parentProjectId: snapshot.projectId ?? undefined,
      selectedClipIds: [], selectedTrackId: null, inspectingClipId: null, historyPast: [], historyFuture: [],
    };
  }),
  setTrackCollapsed: (trackId, collapsed) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, collapsed } : t) })),
  setTrackColor: (trackId, color) =>
    set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, color } : t) })),
  addMarker: (marker) => set((s) => ({ markers: [...s.markers, marker] })),
  removeMarker: (id) => set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),

  // Hard-remove a project from all in-memory state (called by Gallery delete).
  // Unlike closeTab, this also removes it from savedProjects explicitly by ID.
  removeProject: (id) => set((s) => {
    const { [id]: _removed, ...restSaved } = s.savedProjects;
    const ids = s.openProjectIds.filter((x) => x !== id);
    // If it's a background tab, just drop it from both maps
    if (id !== s.projectId) {
      return { openProjectIds: ids, savedProjects: restSaved };
    }
    // Active project deleted — blank out if no other tabs remain
    if (ids.length === 0) {
      return { tracks: DEFAULT_TRACKS, mediaPool: [], markers: [], duration: 300_000_000, projectId: "", name: "Untitled Project", historyPast: [], historyFuture: [], selectedClipIds: [], selectedTrackId: null, inspectingClipId: null, openProjectIds: [], savedProjects: restSaved };
    }
    // Switch to the adjacent tab
    const prevIdx = s.openProjectIds.indexOf(id);
    const nextId = ids[Math.max(0, prevIdx - 1)];
    const target = restSaved[nextId];
    if (!target) return { openProjectIds: ids, savedProjects: restSaved };
    const { [nextId]: _d, ...rest2 } = restSaved;
    return { ...target, openProjectIds: ids, savedProjects: rest2, selectedClipIds: [], inspectingClipId: null };
  }),
  restoreOriginalClips: (clipIds) => {
    const s = useProjectStore.getState();
    const result = performRestoreOriginal(s.tracks, clipIds, s.mediaPool);
    if ("error" in result) return;
    const past = [
      ...s.historyPast.slice(-(MAX_HISTORY - 1)),
      { tracks: s.tracks, duration: s.duration, markers: s.markers, label: "Restore Original" },
    ];
    set({ tracks: result, historyPast: past, historyFuture: [] });
    useSaveBarrierStore.getState().setDirty(true);
  },

  setFxMaskEditingClipId: (id) => set({ fxMaskEditingClipId: id }),
  updateFxMask: (clipId, mask) =>
    set((s) => ({ tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.map((c) =>
      c.id === clipId
        ? { ...c, fxParams: { ...c.fxParams, fxMask: { x: 0, y: 0, scale: 1, rotation: 0, ...((c.fxParams?.fxMask as object) ?? {}), ...mask } } }
        : c) })) })),
}), {
  name: "synapse-project",
  skipHydration: true,
  // Tracks and history are heavy — stored in IDB via project-idb.ts / GlobalHydrator subscribe.
  // Only lightweight registry fields live in localStorage.
  partialize: (s: ProjectState) => ({
    projectId: s.projectId, duration: s.duration, name: s.name, markers: s.markers,
    parentProjectId: s.parentProjectId, remixedFromHandle: s.remixedFromHandle,
    rootParentId: s.rootParentId, rootParentHandle: s.rootParentHandle,
    projectSettings: s.projectSettings, openProjectIds: s.openProjectIds,
    mediaPool: s.mediaPool.map((m) => ({ ...m, previewUrl: "" })),
    // savedProjects excluded — tracks, history, and mediaPool saved to IDB via GlobalHydrator.
  }),
}));

/**
 * Await this before any intentional navigation (router.push, router.replace).
 * If no unsaved changes exist, returns immediately (zero overhead).
 * If a pending IDB write exists, shows the SaveBarrierOverlay and waits for completion.
 */
export async function ensureFlushedBeforeNav(): Promise<void> {
  const { isDirty } = useSaveBarrierStore.getState();
  if (!isDirty) return;
  useSaveBarrierStore.getState().setFlushing(true);
  try {
    await flushProjectToIDB();
    useSaveBarrierStore.getState().setDirty(false);
  } finally {
    useSaveBarrierStore.getState().setFlushing(false);
  }
}
