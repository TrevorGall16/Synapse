import { create } from "zustand";
import type { Track, TrackType, MediaPoolItem, Marker, ClipEvent } from "./types";

// ── Structural Project Data ─────────────────────────────

export interface ProjectState {
  tracks: Track[];
  mediaPool: MediaPoolItem[];
  markers: Marker[];
  duration: number;
  selectedClipIds: string[];
  selectedTrackId: string | null;
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
  ungroupClips: (clipIds: string[]) => void;
  updateMediaPeaks: (mediaId: string, peaks: number[]) => void;
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
  createTrack("video", 1),
  createTrack("audio", 1),
  createTrack("effect", 1),
  createTrack("text", 1),
];

// ── Store ───────────────────────────────────────────────

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: DEFAULT_TRACKS,
  mediaPool: [],
  markers: [],
  duration: 300_000_000,
  selectedClipIds: [],
  selectedTrackId: null,
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

      for (const member of groupMembers) {
        const newStartTime = quantizeToFrame(Math.max(0, Math.round(member.clip.startTime + deltaTime)));
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

  // ── Split Clip at playhead ────────────────────────────
  splitClip: (clipId, splitTime) =>
    set((s) => {
      const location = findClipLocation(s.tracks, clipId);
      if (!location) return s;

      const { clip, trackIndex } = location;

      // splitTime must be strictly inside the clip
      if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) return s;

      const durationA = Math.round(splitTime - clip.startTime);
      const durationB = Math.round(clip.duration - durationA);

      const clipA: ClipEvent = {
        ...clip,
        duration: durationA,
      };

      const clipB: ClipEvent = {
        ...clip,
        id: crypto.randomUUID(),
        startTime: Math.round(splitTime),
        duration: durationB,
        mediaOffset: Math.round(clip.mediaOffset + durationA),
      };

      return {
        tracks: s.tracks.map((t, i) => {
          if (i !== trackIndex) return t;
          return {
            ...t,
            clips: t.clips.flatMap((c) => (c.id === clipId ? [clipA, clipB] : [c])),
          };
        }),
      };
    }),

  ungroupClips: (clipIds) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          clipIds.includes(c.id) ? { ...c, groupId: undefined } : c
        ),
      })),
    })),

  updateMediaPeaks: (mediaId, peaks) =>
    set((s) => ({
      mediaPool: s.mediaPool.map((m) =>
        m.id === mediaId ? { ...m, peakManifest: peaks } : m
      ),
    })),
}));
