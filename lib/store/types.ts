// ── Shared Type Interfaces ──────────────────────────────
// No store logic — just types used across playback-store,
// project-store, and UI components.

export type TrackType = "video" | "audio" | "text" | "effect";

export interface PanCropData {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
}

export interface Keyframe {
  time: number;
  value: number | object;
  interpolation?: "linear" | "ease-in" | "ease-out" | "step";
}

export interface EffectInstance {
  id: string;
  type: "strobe" | "pulse" | "shader" | string;
  parameters: Record<string, unknown>;
  keyframes?: Keyframe[];
}

export interface ClipEvent {
  id: string;
  type: TrackType;
  sourceId: string;
  startTime: number;
  duration: number;
  linkedClipIds?: string[];
  fadeIn?: number;
  fadeOut?: number;
  effects?: EffectInstance[];
  keyframes?: Keyframe[];
  panCrop?: PanCropData;
}

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  color?: string;
  height: number;
  collapsed: boolean;
  locked: boolean;
  clips: ClipEvent[];
  isMuted: boolean;
  isSolo: boolean;
  opacityOrVolume: number;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color?: string;
}

export interface MediaPoolItem {
  id: string;
  name: string;
  type: TrackType;
  mediaKind: "video" | "audio" | "image";
  relativePath: string;
  durationMicros: number;
  thumbnailUrl?: string;
  previewUrl?: string;
}
