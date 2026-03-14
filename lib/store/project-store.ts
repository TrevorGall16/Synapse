import { create } from "zustand";
import type { Track, TrackType, MediaPoolItem, Marker, ClipEvent } from "./types";

// ── Structural Project Data ─────────────────────────────
// Tracks, media pool, markers, duration. Subscribed to by
// track headers, track lanes, and the timeline container.

export interface ProjectState {
  tracks: Track[];
  mediaPool: MediaPoolItem[];
  markers: Marker[];
  duration: number; // microseconds (5 min default)
  selectedClipIds: string[];
  selectedTrackId: string | null;
  snapEnabled: boolean;
  // Actions
  addTrack: (type: TrackType) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  setOpacityOrVolume: (trackId: string, value: number) => void;
  addMediaItem: (item: MediaPoolItem) => void;
  addClip: (trackId: string, clip: ClipEvent) => void;
}

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

const DEFAULT_TRACKS: Track[] = [
  { id: "video-1", type: "video", name: "Video 1", color: "#3b82f6", height: 48, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "audio-1", type: "audio", name: "Audio 1", color: "#22c55e", height: 48, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "effect-1", type: "effect", name: "Effect 1", color: "#ef4444", height: 48, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
  { id: "text-1", type: "text", name: "Text 1", color: "#eab308", height: 48, collapsed: false, locked: false, clips: [], isMuted: false, isSolo: false, opacityOrVolume: 100 },
];

let trackCounter = 1;

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: DEFAULT_TRACKS,
  mediaPool: [],
  markers: [],
  duration: 300_000_000,
  selectedClipIds: [],
  selectedTrackId: null,
  snapEnabled: true,

  addTrack: (type) => {
    trackCounter++;
    set((s) => ({
      tracks: [
        ...s.tracks,
        {
          id: `${type}-${trackCounter}`,
          type,
          name: `${TRACK_LABELS[type]} ${trackCounter}`,
          color: TRACK_COLORS[type],
          height: 48,
          collapsed: false,
          locked: false,
          clips: [],
          isMuted: false,
          isSolo: false,
          opacityOrVolume: 100,
        },
      ],
    }));
  },

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
    set((s) => ({
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t
      ),
    })),
}));
