// ── Shared Type Interfaces ──────────────────────────────
// No store logic — just types used across playback-store,
// project-store, and UI components.

export type TrackType = "video" | "audio" | "text" | "effect";

export interface PanCropData {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  maskType?: "none" | "rect" | "circle" | "polygon";
  maskX?: number;
  maskY?: number;
  maskWidth?: number;
  maskHeight?: number;
  maskPoints?: { x: number; y: number }[];
  maskFeather?: number;
  maskInvert?: boolean;
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
  trackId: string;
  sourceId: string;
  groupId?: string;
  startTime: number;
  duration: number;
  mediaOffset: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  manualFadeIn?: boolean;
  manualFadeOut?: boolean;
  effects?: EffectInstance[];
  keyframes?: Keyframe[];
  panCrop?: PanCropData;
  playbackRate?: number;
  level?: number;
  fxParams?: Record<string, unknown>;
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
  isMuted?: boolean;
  isSolo?: boolean;
  opacityOrVolume: number;
  audioPan?: number;
  trackBrightness?: number;
  trackContrast?: number;
  trackSaturate?: number;
  trackHueRotate?: number;
  reverbWet?: number;
  reverbRoomSize?: number;
  delayMs?: number;
  delayFeedback?: number;
}

export interface Marker {
  id: string;
  time: number;
  color: string;
  label?: string;
}

export interface MediaPoolItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  duration: number;
  previewUrl?: string;
  peakManifest?: number[];
}
