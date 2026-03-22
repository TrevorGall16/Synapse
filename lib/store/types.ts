// ── Shared Type Interfaces ──────────────────────────────
// No store logic — just types used across playback-store,
// project-store, and UI components.

export interface ProjectSettings {
  width: number;
  height: number;
  fps: 23.976 | 24 | 29.97 | 30 | 60;
  pixelAspectRatio: 1.0 | 1.333;
  gammaTag: "sRGB" | "rec709";
}

export const PROJECT_PRESETS = {
  "1080p HD":  { width: 1920, height: 1080, fps: 30,    pixelAspectRatio: 1.0, gammaTag: "sRGB"   },
  "4K UHD":    { width: 3840, height: 2160, fps: 30,    pixelAspectRatio: 1.0, gammaTag: "rec709" },
  "Vertical":  { width: 1080, height: 1920, fps: 30,    pixelAspectRatio: 1.0, gammaTag: "sRGB"   },
  "Cinema 4K": { width: 4096, height: 2160, fps: 24,    pixelAspectRatio: 1.0, gammaTag: "rec709" },
} satisfies Record<string, ProjectSettings>;

export type TrackType = "video" | "audio" | "text" | "effect";

export interface MaskLayer {
  id: string;
  points: { x: number; y: number }[];
  type: "add" | "subtract";
}

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
  masks?: MaskLayer[];
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

export interface HistorySnapshot {
  tracks: Track[];
  duration: number;
  markers: Marker[];
  label: string;
}

export interface MediaPoolItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  duration: number;
  previewUrl?: string;
  peakManifest?: number[];
}
