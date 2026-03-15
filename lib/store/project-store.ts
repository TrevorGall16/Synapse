import { create } from "zustand";
import type { Track, TrackType, MediaPoolItem, Marker, ClipEvent } from "./types";
import { getGridInterval } from "../utils/grid";
// NOTE: circular import with playback-store is safe — both stores use
// getState() inside action callbacks, never at module init time.
import { usePlaybackStore } from "./playback-store";

// ── Structural Project Data ─────────────────────────────

export interface ProjectState {
  tracks: Track[];
  mediaPool: MediaPoolItem[];
  markers: Marker[];
  duration: number;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  inspectingClipId: string | null;
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
  joinClips: (clipIds: string[]) => void;
  setInspectingClipId: (id: string | null) => void;
  updateClipFxParams: (clipId: string, params: Record<string, unknown>) => void;
}

// ── Constants ───────────────────────────────────────────

const TRACK_COLORS: Record<TrackType, string> = {
  video: "#3b82f6",
  audio: "#22c55e",
  effect: "#ef4444",
  text: "#eab308",
};

const TRACK_LABELS: Record<TrackType, string> = {
  video: "Video",
  audio: "Audio",
  effect: "Effect",
  text: "Text",
};

const TRACK_HEIGHTS: Record<TrackType, number> = {
  video: 60,
  audio: 40,
  effect: 48,
  text: 48,
};

// ── Helpers ─────────────────────────────────────────────

function quantizeToFrame(timeUs: number, fps: number = 30): number {
  const frameDurationUs = Math.round(1_000_000 / fps);
  return Math.round(timeUs / frameDurationUs) * frameDurationUs;
}

function createTrack(type: TrackType, count: number): Track {
  return {
    id: crypto.randomUUID(),
    type,
    name: `${TRACK_LABELS[type]} ${count}`,
    color: TRACK_COLORS[type],
    height: TRACK_HEIGHTS[type],
    collapsed: false,
    locked: false,
    clips: [],
    isMuted: false,
    isSolo: false,
    opacityOrVolume: 100,
  };
}

function findClipLocation(tracks: Track[], clipId: string): { clip: ClipEvent; trackIndex: number } | undefined {
  for (let i = 0; i < tracks.length; i++) {
    const clip = tracks[i].clips.find((c) => c.id === clipId);
    if (clip) return { clip, trackIndex: i };
  }
  return undefined;
}

function findClipsByGroupId(tracks: Track[], groupId: string): { clip: ClipEvent; trackIndex: number }[] {
  const results: { clip: ClipEvent; trackIndex: number }[] = [];
  for (let i = 0; i < tracks.length; i++) {
    for (const clip of tracks[i].clips) {
      if (clip.groupId === groupId) {
        results.push({ clip, trackIndex: i });
      }
    }
  }
  return results;
}

/** Build ordered list of track indices matching a given type. */
function sameTypeIndices(tracks: Track[], type: TrackType): number[] {
  const indices: number[] = [];
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].type === type) indices.push(i);
  }
  return indices;
}

/** Auto-crossfade: detect overlaps on a single track, set fade durations. */
function computeCrossfades(clips: ClipEvent[]): ClipEvent[] {
  const sorted = [...clips]
    .map((c) => ({ ...c, fadeInDuration: undefined, fadeOutDuration: undefined }) as ClipEvent)
    .sort((a, b) => a.startTime - b.startTime);

  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].startTime + sorted[i - 1].duration;
    if (sorted[i].startTime < prevEnd) {
      const overlap = prevEnd - sorted[i].startTime;
      sorted[i - 1] = { ...sorted[i - 1], fadeOutDuration: overlap };
      sorted[i] = { ...sorted[i], fadeInDuration: overlap };
    }
  }

  return sorted;
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
      if (deltaTime === 0 && deltaTrack === 0) return s;

      const target = findClipLocation(s.tracks, clipId);
      if (!target) return s;

      // Collect all clips in the group (or just the single clip)
      const groupMembers = target.clip.groupId
        ? findClipsByGroupId(s.tracks, target.clip.groupId)
        : [target];

      // Deep-copy tracks for mutation
      const tracks = s.tracks.map((t) => ({ ...t, clips: [...t.clips] }));

      // Build move plan using same-type track indices
      const moves: { clipId: string; fromIdx: number; toIdx: number; newStartTime: number }[] = [];
      const affectedTrackIndices = new Set<number>();

      // Snap calculation (lazy — only compute once for the group)
      let snappedDeltaTime = deltaTime;
      if (s.snapEnabled && deltaTime !== 0) {
        const { pixelsPerSecond } = usePlaybackStore.getState();
        const rawStart = Math.max(0, Math.round(target.clip.startTime + deltaTime));
        const intervalSec = getGridInterval(pixelsPerSecond);
        const gridMicros = Math.round(intervalSec * 1_000_000);
        const nearestGrid = Math.round(rawStart / gridMicros) * gridMicros;
        const thresholdMicros = Math.round((10 / pixelsPerSecond) * 1_000_000);
        if (Math.abs(rawStart - nearestGrid) < thresholdMicros) {
          snappedDeltaTime = nearestGrid - target.clip.startTime;
        }
      }

      for (const member of groupMembers) {
        const newStartTime = quantizeToFrame(Math.max(0, Math.round(member.clip.startTime + snappedDeltaTime)));
        const clipType = s.tracks[member.trackIndex].type;

        // Find same-type tracks and resolve target
        const sameType = sameTypeIndices(tracks, clipType);
        const currentSameTypeIdx = sameType.indexOf(member.trackIndex);
        if (currentSameTypeIdx === -1) return s;

        const targetSameTypeIdx = currentSameTypeIdx + deltaTrack;

        // Can't move above first same-type track
        if (targetSameTypeIdx < 0) return s;

        let toIdx: number;
        if (targetSameTypeIdx < sameType.length) {
          // Target exists
          toIdx = sameType[targetSameTypeIdx];
        } else {
          // Auto-generate new track(s) of this type
          while (sameTypeIndices(tracks, clipType).length <= targetSameTypeIdx) {
            const count = tracks.filter((t) => t.type === clipType).length + 1;
            tracks.push(createTrack(clipType, count));
          }
          toIdx = sameTypeIndices(tracks, clipType)[targetSameTypeIdx];
        }

        moves.push({ clipId: member.clip.id, fromIdx: member.trackIndex, toIdx, newStartTime });
        affectedTrackIndices.add(member.trackIndex);
        affectedTrackIndices.add(toIdx);
      }

      if (moves.length === 0) return s;

      // Remove clips from source tracks
      for (const move of moves) {
        tracks[move.fromIdx] = {
          ...tracks[move.fromIdx],
          clips: tracks[move.fromIdx].clips.filter((c) => c.id !== move.clipId),
        };
      }

      // Insert clips into destination tracks
      let maxEnd = 0;
      for (const move of moves) {
        const originalClip = groupMembers.find((gm) => gm.clip.id === move.clipId)!.clip;
        const updatedClip: ClipEvent = {
          ...originalClip,
          startTime: move.newStartTime,
          trackId: tracks[move.toIdx].id,
        };
        tracks[move.toIdx] = {
          ...tracks[move.toIdx],
          clips: [...tracks[move.toIdx].clips, updatedClip],
        };
        maxEnd = Math.max(maxEnd, move.newStartTime + updatedClip.duration);
      }

      // Auto-crossfade on affected tracks
      for (const idx of affectedTrackIndices) {
        if (idx < tracks.length) {
          tracks[idx] = { ...tracks[idx], clips: computeCrossfades(tracks[idx].clips) };
        }
      }

      const newDuration = maxEnd > s.duration ? maxEnd + 60_000_000 : s.duration;
      return { tracks, duration: newDuration };
    }),

  // ── Split clip at playhead (group-aware) ─────────────
  splitClip: (clipId, splitTime) =>
    set((s) => {
      const location = findClipLocation(s.tracks, clipId);
      if (!location) return s;

      const { clip } = location;
      if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) return s;

      // Collect all clips to split: the whole group, or just the single clip
      const targets = clip.groupId
        ? findClipsByGroupId(s.tracks, clip.groupId)
        : [location];

      // One new groupId for ALL right halves
      const newGroupId = clip.groupId ? crypto.randomUUID() : undefined;

      // Build a set of clip IDs to split for fast lookup
      const splitMap = new Map<string, { trackIndex: number; clip: ClipEvent }>();
      for (const t of targets) {
        // Only split if the playhead is actually inside this clip
        if (splitTime > t.clip.startTime && splitTime < t.clip.startTime + t.clip.duration) {
          splitMap.set(t.clip.id, t);
        }
      }

      if (splitMap.size === 0) return s;

      return {
        tracks: s.tracks.map((t, i) => {
          const hasAny = t.clips.some((c) => splitMap.has(c.id));
          if (!hasAny) return t;

          return {
            ...t,
            clips: t.clips.flatMap((c) => {
              const entry = splitMap.get(c.id);
              if (!entry) return [c];

              const durationA = Math.round(splitTime - c.startTime);
              const durationB = Math.round(c.duration - durationA);

              const clipA: ClipEvent = { ...c, duration: durationA };
              const clipB: ClipEvent = {
                ...c,
                id: crypto.randomUUID(),
                startTime: Math.round(splitTime),
                duration: durationB,
                mediaOffset: Math.round(c.mediaOffset + durationA),
                groupId: newGroupId,
              };

              return [clipA, clipB];
            }),
          };
        }),
      };
    }),

  // ── Bulk split with group-aware right-half linking ───
  splitSelectedClips: (clipIds, splitTime) =>
    set((s) => {
      // Map old groupId -> new groupId for the right halves
      const newGroupMap = new Map<string, string>();

      let tracks = s.tracks.map((t) => ({ ...t, clips: [...t.clips] }));

      for (const clipId of clipIds) {
        const location = findClipLocation(tracks, clipId);
        if (!location) continue;

        const { clip, trackIndex } = location;
        if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) continue;

        const durationA = Math.round(splitTime - clip.startTime);
        const durationB = Math.round(clip.duration - durationA);

        // Left half keeps original groupId
        const clipA: ClipEvent = { ...clip, duration: durationA };

        // Right half gets a new shared groupId (mapped from original)
        let rightGroupId: string | undefined;
        if (clip.groupId) {
          if (!newGroupMap.has(clip.groupId)) {
            newGroupMap.set(clip.groupId, crypto.randomUUID());
          }
          rightGroupId = newGroupMap.get(clip.groupId);
        }

        const clipB: ClipEvent = {
          ...clip,
          id: crypto.randomUUID(),
          startTime: Math.round(splitTime),
          duration: durationB,
          mediaOffset: Math.round(clip.mediaOffset + durationA),
          groupId: rightGroupId,
        };

        tracks = tracks.map((t, i) => {
          if (i !== trackIndex) return t;
          return { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? [clipA, clipB] : [c])) };
        });
      }

      return { tracks };
    }),

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
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => !clipIds.includes(c.id)),
      })),
      selectedClipIds: [],
    })),

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

          const merged: ClipEvent = {
            ...earliest,
            startTime: newStartTime,
            duration: newEnd - newStartTime,
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
