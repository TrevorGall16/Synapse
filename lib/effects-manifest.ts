/**
 * lib/effects-manifest.ts
 *
 * SINGLE SOURCE OF TRUTH for every effect that can be authored in Studio and
 * replayed in Theater. The manifest is consumed by:
 *   - Studio UI (parameter panels, defaults, slider bounds, labels)
 *   - Theater renderer (parameter lookup, defaults fill-in on ingest)
 *   - Parity tests (`lib/utils/effect-parity.test.ts`)
 *
 * Adding or changing an effect means editing THIS file — not a UI component,
 * not the renderer. That's what prevents the Studio/Theater drift we shipped
 * a P0 fix for (hue-rotate was animated by Studio via `speed` but Theater's
 * static `clipCssFilter` read only `hueRotate` degrees).
 *
 * Convention:
 *   - `id`        — the literal string used in `fxParams.effectType`.
 *   - `defaults`  — what Studio/Theater fill in when a param is missing.
 *                   Theater MUST treat absence as `defaults[key]`, never 0.
 *   - `params`    — { key: { min, max, step, label, unit? } }. Studio UI
 *                   uses this to build sliders/inputs without hard-coding.
 *   - `animated`  — true if the effect depends on playhead elapsed time.
 *                   The renderer (buildFxFilter) is the only one allowed to
 *                   "animate" — consumers MUST NOT approximate with CSS.
 *   - `outputs`   — hint about what buildFxFilter returns for this effect:
 *                   `filter`, `transform`, `hypnoTunnel`, `svgFilterId`.
 */

export type EffectId =
  | "invert"
  | "strobe"
  | "flash"
  | "blur"
  | "hue-rotate"
  | "chromatic-aberration"
  | "pixelate"
  | "glitch"
  | "mirror"
  | "hypno-tunnel";

export interface EffectParamSpec {
  min: number;
  max: number;
  step: number;
  label: string;
  unit?: string;
}

export interface EffectSpec {
  id: EffectId;
  label: string;
  category: "color" | "blur" | "distortion" | "glitch" | "animated" | "other";
  /** True if buildFxFilter output changes over elapsed playhead time. */
  animated: boolean;
  /** Hint about which buildFxFilter output fields this effect populates. */
  outputs: readonly ("filter" | "transform" | "hypnoTunnel" | "svgFilterId")[];
  /** Defaults MUST match the fallbacks inside `buildFxFilter` in preview-helpers.ts. */
  defaults: Record<string, number | string | boolean>;
  /** UI slider/input bounds, keyed by fxParams field name. */
  params: Record<string, EffectParamSpec>;
}

const CC_DEFAULTS = { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 } as const;

export const EFFECTS: Readonly<Record<EffectId, EffectSpec>> = {
  invert: {
    id: "invert",
    label: "Invert",
    category: "color",
    animated: false,
    outputs: ["filter"],
    defaults: { intensity: 50, ...CC_DEFAULTS },
    params: {
      intensity: { min: 0, max: 100, step: 1, label: "Intensity", unit: "%" },
    },
  },

  "hue-rotate": {
    id: "hue-rotate",
    label: "Hue Rotate",
    category: "color",
    animated: true,
    outputs: ["filter"],
    // speed=0 ⇒ degrees hold at `hueRotate`. Any non-zero speed ⇒ rotates over time.
    defaults: { intensity: 50, speed: 50, hueRotate: 0, brightness: 100, contrast: 100, saturate: 100 },
    params: {
      speed:     { min: 0, max: 100, step: 1, label: "Rotation speed", unit: "rpm" },
      intensity: { min: 0, max: 100, step: 1, label: "Intensity", unit: "%" },
      hueRotate: { min: 0, max: 360, step: 1, label: "Static offset", unit: "°" },
    },
  },

  blur: {
    id: "blur",
    label: "Blur",
    category: "blur",
    animated: false,
    outputs: ["filter"],
    defaults: { blurAmount: 0, intensity: 50, ...CC_DEFAULTS },
    params: {
      blurAmount: { min: 0, max: 50, step: 0.5, label: "Radius", unit: "px" },
    },
  },

  strobe: {
    id: "strobe",
    label: "Strobe",
    category: "animated",
    animated: true,
    outputs: ["filter"],
    defaults: { speed: 50, intensity: 50, strobeDutyCycle: 50, ...CC_DEFAULTS },
    params: {
      speed:            { min: 5,  max: 200, step: 1, label: "Frequency", unit: "×0.1Hz" },
      intensity:        { min: 0,  max: 100, step: 1, label: "Brightness boost", unit: "%" },
      strobeDutyCycle:  { min: 10, max: 90,  step: 1, label: "Duty cycle", unit: "%" },
    },
  },

  flash: {
    id: "flash",
    label: "Flash",
    category: "animated",
    animated: true,
    outputs: ["filter"],
    defaults: { speed: 5, intensity: 50, ...CC_DEFAULTS },
    params: {
      speed:     { min: 1, max: 20,  step: 1, label: "Decay", unit: "×" },
      intensity: { min: 0, max: 100, step: 1, label: "Intensity", unit: "%" },
    },
  },

  glitch: {
    id: "glitch",
    label: "Glitch",
    category: "glitch",
    animated: true,
    outputs: ["transform", "filter"],
    defaults: { displacement: 30, speed: 50, intensity: 50, ...CC_DEFAULTS },
    params: {
      displacement: { min: 0, max: 100, step: 1, label: "Displacement", unit: "px" },
      speed:        { min: 10, max: 100, step: 1, label: "Chatter rate" },
      intensity:    { min: 0, max: 100, step: 1, label: "Intensity", unit: "%" },
    },
  },

  "chromatic-aberration": {
    id: "chromatic-aberration",
    label: "Chromatic Aberration",
    category: "distortion",
    animated: false,
    outputs: ["svgFilterId", "filter"],
    defaults: { caOffset: 3, intensity: 50, ...CC_DEFAULTS },
    params: {
      caOffset:  { min: 0, max: 12, step: 0.1, label: "Channel offset", unit: "px" },
      intensity: { min: 0, max: 100, step: 1, label: "Intensity", unit: "%" },
    },
  },

  pixelate: {
    id: "pixelate",
    label: "Pixelate",
    category: "distortion",
    animated: false,
    outputs: ["svgFilterId"],
    defaults: { blockSize: 8, intensity: 50, ...CC_DEFAULTS },
    params: {
      blockSize: { min: 2, max: 48, step: 1, label: "Block size", unit: "px" },
    },
  },

  mirror: {
    id: "mirror",
    label: "Mirror",
    category: "distortion",
    animated: false,
    outputs: ["transform"],
    defaults: { mirrorMode: "horizontal", intensity: 100, ...CC_DEFAULTS },
    params: {
      // mirrorMode is an enum — UI renders a segmented control, not a slider.
      intensity: { min: 0, max: 100, step: 1, label: "Intensity", unit: "%" },
    },
  },

  "hypno-tunnel": {
    id: "hypno-tunnel",
    label: "Hypno Tunnel",
    category: "animated",
    animated: true,
    outputs: ["hypnoTunnel"],
    defaults: {
      intensity: 50, speed: 50,
      tunnelColor: "#ff00ff", tunnelSpacing: 24, tunnelRotation: 0,
      brightness: 100, contrast: 100, saturate: 100, hueRotate: 0,
    },
    params: {
      intensity:      { min: 0, max: 100, step: 1, label: "Intensity", unit: "%" },
      speed:          { min: 0, max: 100, step: 1, label: "Rotation speed" },
      tunnelSpacing:  { min: 4, max: 80, step: 1, label: "Ring spacing", unit: "%" },
      tunnelRotation: { min: 0, max: 360, step: 1, label: "Base rotation", unit: "°" },
    },
  },
};

export const EFFECT_IDS = Object.keys(EFFECTS) as readonly EffectId[];

/**
 * Fill missing fxParams from the manifest defaults. Use this on ingest (Theater
 * load, or store hydration) so downstream code never has to remember which keys
 * fall back to what value. Never call on write paths — defaults stay out of IDB.
 */
export function fillEffectDefaults(
  fxParams: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!fxParams) return {};
  const effectType = fxParams.effectType as EffectId | undefined;
  if (!effectType || !(effectType in EFFECTS)) return fxParams;
  const spec = EFFECTS[effectType];
  return { ...spec.defaults, ...fxParams };
}
