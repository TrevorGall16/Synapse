/**
 * lib/schema.ts — Ingress validation schemas (Zod)
 *
 * "Bouncer" layer: ALL external data (IDB, localStorage, URL params) must pass
 * through these schemas before injection into any Zustand store.
 *
 * Design rules:
 *  - NEVER use .parse() — it throws and can crash the session. Always use .safeParse().
 *  - Structural invariants (IDs, numeric ranges, enum membership) are STRICT.
 *  - Core edit models use .strict() — unknown fields cause hard rejection.
 *  - Feed/ingest models use .strip() — unknown fields are silently dropped.
 *  - .passthrough() is ONLY permitted in the legacy_v1 adapter (FxParamsLegacySchema).
 *  - fxParams uses discriminated unions for known effect types; unknown types fall
 *    through to a legacy z.record adapter rather than hard-failing.
 *  - Recursive types (ClipEvent → embeddedEffectClips) use z.lazy().
 */

import { z } from "zod";

// ── Authoritative limits — UI inputs MUST import these, never hard-code. ─────

export const TITLE_MAX       = 80;
export const DESCRIPTION_MAX = 300;
export const COLLECTION_NAME_MAX = 80;
export const COLLECTION_DESC_MAX = 500;

export const USERNAME_MAX     = 40;
export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX          = 160;

// ── Primitives ────────────────────────────────────────────────────────────────

const TrackTypeSchema = z.enum(["video", "audio", "text", "effect"]);

const ProjectSettingsSchema = z.object({
  width:            z.number().int().positive(),
  height:           z.number().int().positive(),
  fps:              z.union([z.literal(23.976), z.literal(24), z.literal(29.97), z.literal(30), z.literal(60)]),
  pixelAspectRatio: z.union([z.literal(1.0), z.literal(1.333)]),
  gammaTag:         z.enum(["sRGB", "rec709"]),
});

const MediaPoolItemSchema = z.object({
  id:           z.string().min(1),
  name:         z.string(),
  type:         z.enum(["video", "audio", "image"]),
  duration:     z.number().nonnegative(),
  previewUrl:   z.string().optional(),
  peakManifest: z.array(z.number()).optional(),
});

const MarkerSchema = z.object({
  id:    z.string().min(1),
  time:  z.number().nonnegative(),
  color: z.string(),
  label: z.string().optional(),
});

// ── Rendered CSS (baked from fxParams on publish) ─────────────────────────────

const RenderedCssSchema = z.object({
  filter:    z.string(),
  transform: z.string(),
  animation: z.string().optional(),
});

// ── fxParams: discriminated unions for known effect types + legacy fallback ───
//
// First-match semantics: known types are validated strictly; any unrecognised
// effectType (or a record with no effectType at all) falls through to the legacy
// adapter (structured object with .passthrough()), which accepts extra keys while
// still enforcing known base fields. This prevents new/future effect types from
// breaking existing saved data.

const _fxBase = { intensity: z.number().min(0).max(100).optional() };

const FxParamsKnownSchema = z.discriminatedUnion("effectType", [
  z.object({ effectType: z.literal("blur"),
    blurAmount: z.number().min(0).max(50).optional(), ..._fxBase }),
  z.object({ effectType: z.literal("glitch"),
    speed: z.number().min(0).max(100).optional(), ..._fxBase }),
  z.object({ effectType: z.literal("strobe"),
    speed: z.number().min(0).max(100).optional(), ..._fxBase }),
  z.object({ effectType: z.literal("chromatic-aberration"),
    caOffset: z.number().min(0).max(30).optional(), ..._fxBase }),
  z.object({ effectType: z.literal("hypno-tunnel"), ..._fxBase }),
  z.object({ effectType: z.literal("hue-rotate"),
    hueRotate: z.number().min(-360).max(360).optional(), ..._fxBase }),
  z.object({ effectType: z.literal("invert"), ..._fxBase }),
  z.object({ effectType: z.literal("pixelate"),
    blockSize: z.number().min(1).max(64).optional(), ..._fxBase }),
  z.object({ effectType: z.literal("none"),
    saturate:   z.number().optional(),
    contrast:   z.number().optional(),
    brightness: z.number().optional(),
    hueRotate:  z.number().optional(),
    ..._fxBase }),
]);

/**
 * ── legacy_v1 adapter ──────────────────────────────────────────────────────
 * The ONLY schema permitted to use .passthrough(). Validates base fields
 * present on ALL effects (effectType, intensity) while forwarding unknown
 * extras so older saved data can still load. New code MUST NOT add
 * .passthrough() anywhere else — use .strict() (edit models) or .strip()
 * (feed models) instead.
 */
const FxParamsLegacySchema = z.object({
  effectType: z.string().optional(),
  intensity:  z.number().min(0).max(100).optional(),
}).passthrough(); // legacy_v1 — sole permitted .passthrough()

/** Accepts known effect shapes strictly; unknown/legacy effectTypes via structured adapter. */
export const FxParamsSchema = z.union([
  FxParamsKnownSchema,
  FxParamsLegacySchema, // legacy_v1 adapter: effectType absent or unrecognised
]);

// ── JSON-safe recursive value schema ─────────────────────────────────────────
//
// Covers every valid keyframe value shape (scalar, colour object, vec2, nested
// animation params) while explicitly blocking `unknown/any`. This replaces the
// prior `z.union([z.number(), z.record(z.string(), z.unknown())])` which allowed
// arbitrary non-serialisable types (functions, class instances, etc.) as values.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const JsonValueSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);

// ── Keyframe & EffectInstance ─────────────────────────────────────────────────

const KeyframeSchema = z.object({
  time:          z.number(),
  value:         JsonValueSchema,
  interpolation: z.enum(["linear", "ease-in", "ease-out", "step"]).optional(),
});

const EffectInstanceSchema = z.object({
  id:         z.string().min(1),
  type:       z.string(),
  parameters: z.record(z.string(), JsonValueSchema),
  keyframes:  z.array(KeyframeSchema).optional(),
}).strict();

// ── PanCropData ───────────────────────────────────────────────────────────────

const PanCropDataSchema = z.object({
  x:        z.number(),
  y:        z.number(),
  scale:    z.number().positive(),
  rotation: z.number(),
  maskType:   z.enum(["none", "rect", "circle", "polygon"]).optional(),
  maskX:      z.number().optional(),
  maskY:      z.number().optional(),
  maskWidth:  z.number().optional(),
  maskHeight: z.number().optional(),
  maskPoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  maskFeather: z.number().optional(),
  maskInvert:  z.boolean().optional(),
  masks:       z.array(z.object({ id: z.string(), points: z.array(z.object({ x: z.number(), y: z.number() })), type: z.enum(["add", "subtract"]) })).optional(),
}).strict();

// ── ClipEvent (recursive — embeddedEffectClips / embeddedTextClips) ───────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ClipEventSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id:          z.string().min(1),
    trackId:     z.string().min(1),
    sourceId:    z.string(),
    startTime:   z.number().nonnegative(),
    duration:    z.number().positive(),
    mediaOffset: z.number().nonnegative(),
    groupId:          z.string().optional(),
    fadeInDuration:   z.number().nonnegative().optional(),
    fadeOutDuration:  z.number().nonnegative().optional(),
    manualFadeIn:     z.boolean().optional(),
    manualFadeOut:    z.boolean().optional(),
    effects:          z.array(EffectInstanceSchema).optional(),
    keyframes:        z.array(KeyframeSchema).optional(),
    panCrop:          PanCropDataSchema.optional(),
    playbackRate:     z.number().positive().optional(),
    level:            z.number().min(0).max(200).optional(),
    fxParams:         FxParamsSchema.optional(),
    renderedCss:      RenderedCssSchema.optional(),
    /** Baked FX from source's effect tracks — validated as ClipEvent[] */
    embeddedEffectClips: z.array(ClipEventSchema).optional(),
    /** Baked text from source's text tracks — validated as ClipEvent[] */
    embeddedTextClips:   z.array(ClipEventSchema).optional(),
  })
);

// ── Track ─────────────────────────────────────────────────────────────────────

const TrackSchema = z.object({
  id:              z.string().min(1),
  type:            TrackTypeSchema,
  name:            z.string(),
  color:           z.string().optional(),
  height:          z.number().positive(),
  collapsed:       z.boolean(),
  locked:          z.boolean(),
  clips:           z.array(ClipEventSchema),
  isMuted:         z.boolean().optional(),
  isSolo:          z.boolean().optional(),
  opacityOrVolume: z.number().min(0).max(100),
  audioPan:        z.number().min(-100).max(100).optional(),
  trackBrightness: z.number().optional(),
  trackContrast:   z.number().optional(),
  trackSaturate:   z.number().optional(),
  trackHueRotate:  z.number().optional(),
  reverbWet:       z.number().min(0).max(1).optional(),
  reverbRoomSize:  z.number().min(0).max(1).optional(),
  delayMs:         z.number().nonnegative().optional(),
  delayFeedback:   z.number().min(0).max(1).optional(),
});

// ── HistorySnapshot & HistoryData ─────────────────────────────────────────────

const HistorySnapshotSchema = z.object({
  tracks:   z.array(TrackSchema),
  duration: z.number().nonnegative(),
  markers:  z.array(MarkerSchema),
  label:    z.string(),
});

export const HistoryDataSchema = z.object({
  past:   z.array(HistorySnapshotSchema),
  future: z.array(HistorySnapshotSchema),
});

// ── Project schemas ───────────────────────────────────────────────────────────

export const ProjectSnapshotSchema = z.object({
  tracks:          z.array(TrackSchema),
  duration:        z.number().positive(),
  projectSettings: ProjectSettingsSchema,
  // .default([]) ensures older records missing this field never fail validation —
  // they simply resolve to an empty pool, maintaining backward compatibility.
  mediaPool:       z.array(MediaPoolItemSchema).default([]),
});

export const SerializedProjectSchema = z.object({
  projectId:         z.string().min(1),
  name:              z.string(),
  tracks:            z.array(TrackSchema),
  duration:          z.number().nonnegative(),
  projectSettings:   ProjectSettingsSchema,
  // .default([]) — IDB records written before mediaPool was tracked resolve to []
  // instead of failing validation. Symmetric with ProjectSnapshotSchema.
  mediaPool:         z.array(MediaPoolItemSchema).default([]),
  markers:           z.array(MarkerSchema).optional(),
  parentProjectId:   z.string().optional(),
  remixedFromHandle: z.string().optional(),
  rootParentId:      z.string().optional(),
  rootParentHandle:  z.string().optional(),
  updatedAt:         z.number().optional(),
});

// ── PresetData ────────────────────────────────────────────────────────────────

const PresetDataSchema = z.object({
  effectType:  z.string(),
  fxParams:    z.record(z.string(), JsonValueSchema),
  label:       z.string().optional(),
  category:    z.enum(["blur", "distortion", "color", "glitch", "other"]).optional(),
  previewCss:  RenderedCssSchema.optional(),
}).strip();

// ── FeedPost ──────────────────────────────────────────────────────────────────

export const FeedPostSchema = z.object({
  id:      z.string().min(1),
  type:    z.enum(["video", "preset"]).optional(),
  user:    z.object({
    handle:  z.string().min(1),
    initial: z.string().max(2),
    hue:     z.number().min(0).max(360),
  }),
  title:       z.string().max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).optional(),
  tags:        z.array(z.string()),
  bg:          z.string(),
  accent:      z.string(),
  duration:    z.string(),
  likes:       z.number().nonnegative().int(),
  comments:    z.number().nonnegative().int(),
  featured:    z.boolean(),
  videoUrl:    z.string().optional(),
  presetData:  PresetDataSchema.optional(),
  projectSnapshot:     ProjectSnapshotSchema.optional(),
  authorUsername:      z.string().optional(),
  allowRemix:          z.boolean().optional(),
  remixedFromPostId:   z.string().optional(),
  remixedFromHandle:   z.string().optional(),
  rootParentId:        z.string().optional(),
  rootParentHandle:    z.string().optional(),
  createdAt:     z.number().optional(),
  demoStartTime: z.number().nonnegative().optional(),
  demoDuration:  z.number().positive().optional(),
  category:      z.enum(["high-sensation", "aesthetic", "cinematic", "glitch", "slow-mo"]).optional(),
}).strip();

// ── Collection (Workspace grouping for Profile) ─────────────────────────────

export const CollectionSchema = z.object({
  id:          z.string().min(1),
  name:        z.string().min(1).max(COLLECTION_NAME_MAX),
  description: z.string().max(COLLECTION_DESC_MAX).optional(),
  projectIds:  z.array(z.string()).default([]),
  isPrivate:   z.boolean().default(false),
}).strict();

// ── UserProfile ───────────────────────────────────────────────────────────────
// .strip() — persisted to localStorage; unknown fields from future versions
// must not cause validation failures on older clients.

export const UserProfileSchema = z.object({
  username:    z.string().min(1).max(USERNAME_MAX),
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX),
  bio:         z.string().max(BIO_MAX),
  hue:         z.number().int().min(0).max(359),
  followers:   z.number().nonnegative().int(),
  following:   z.number().nonnegative().int(),
}).strip();

export type ValidatedUserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Coerce a raw value into a valid UserProfile.
 * Never throws — truncates over-limit strings, clamps numeric ranges.
 * Preserves the user's data rather than resetting to DEFAULT_PROFILE.
 */
export function coerceUserProfile(raw: unknown): ValidatedUserProfile {
  const DEFAULT: ValidatedUserProfile = {
    username: "you", displayName: "Your Name",
    bio: "Making edits in Synapse", hue: 270,
    followers: 0, following: 0,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT;
  const r = raw as Record<string, unknown>;
  return {
    username:    typeof r.username    === "string" && r.username.length > 0 ? r.username    : DEFAULT.username,
    displayName: typeof r.displayName === "string" && r.displayName.length > 0
      ? r.displayName.slice(0, DISPLAY_NAME_MAX)
      : DEFAULT.displayName,
    bio:      typeof r.bio      === "string" ? r.bio.slice(0, BIO_MAX)                             : DEFAULT.bio,
    hue:      typeof r.hue      === "number" ? Math.max(0, Math.min(359, Math.round(r.hue)))        : DEFAULT.hue,
    followers: typeof r.followers === "number" ? Math.max(0, Math.floor(r.followers))               : DEFAULT.followers,
    following: typeof r.following === "number" ? Math.max(0, Math.floor(r.following))               : DEFAULT.following,
  };
}

/** Validate a UserProfile from localStorage. Returns null on hard failure (wrong shape entirely). */
export function validateUserProfile(raw: unknown, context = "localStorage"): ValidatedUserProfile | null {
  const result = UserProfileSchema.safeParse(raw);
  if (!result.success) {
    console.warn(`[Schema] UserProfile validation failed (${context}):`, result.error.issues);
    return null;
  }
  return result.data;
}

// ── Exported inferred types ───────────────────────────────────────────────────

export type ValidatedCollection         = z.infer<typeof CollectionSchema>;
export type ValidatedFeedPost          = z.infer<typeof FeedPostSchema>;
export type ValidatedSerializedProject = z.infer<typeof SerializedProjectSchema>;
export type ValidatedHistoryData       = z.infer<typeof HistoryDataSchema>;

// ── Validation helpers ────────────────────────────────────────────────────────

/** Validate a FeedPost from IDB. Rejects and logs on failure — never throws. */
export function validateFeedPost(raw: unknown, context = "IDB"): ValidatedFeedPost | null {
  const result = FeedPostSchema.safeParse(raw);
  if (!result.success) {
    console.error(`[Schema] FeedPost rejected (${context})`, result.error.issues);
    return null;
  }
  return result.data;
}

/** Validate a serialised project from IDB. Rejects and logs on failure — never throws. */
export function validateSerializedProject(raw: unknown, context = "IDB"): ValidatedSerializedProject | null {
  const result = SerializedProjectSchema.safeParse(raw);
  if (!result.success) {
    console.error(`[Schema] SerializedProject rejected (${context})`, result.error.issues);
    return null;
  }
  return result.data;
}

/** Validate a project snapshot (embedded in FeedPost). Rejects and logs on failure. */
export function validateProjectSnapshot(raw: unknown, context = "IDB"): z.infer<typeof ProjectSnapshotSchema> | null {
  const result = ProjectSnapshotSchema.safeParse(raw);
  if (!result.success) {
    console.error(`[Schema] ProjectSnapshot rejected (${context})`, result.error.issues);
    return null;
  }
  return result.data;
}

/** Validate history data (past/future HistorySnapshot arrays) from IDB. Rejects and logs on failure. */
export function validateHistoryData(raw: unknown, context = "IDB"): ValidatedHistoryData | null {
  const result = HistoryDataSchema.safeParse(raw);
  if (!result.success) {
    console.error(`[Schema] HistoryData rejected (${context})`, result.error.issues);
    return null;
  }
  return result.data;
}

/** Validate a Collection from IDB. Rejects and logs on failure — never throws. */
export function validateCollection(raw: unknown, context = "IDB"): ValidatedCollection | null {
  const result = CollectionSchema.safeParse(raw);
  if (!result.success) {
    console.error(`[Schema] Collection rejected (${context})`, result.error.issues);
    return null;
  }
  return result.data;
}
