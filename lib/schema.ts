/**
 * lib/schema.ts — Ingress validation schemas (Zod)
 *
 * These are the "bouncer" schemas: every piece of external data (IDB, localStorage,
 * URL params) must pass validation before being injected into the Zustand stores.
 * Validation failures are logged and the mutation is rejected to prevent state poisoning.
 *
 * Rule: schemas are PERMISSIVE on optional fields (use z.unknown() or .optional() rather
 * than crashing on forward-compatible extensions) but STRICT on structural invariants
 * (required IDs, numeric ranges, enum membership).
 */

import { z } from "zod";

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
  id:          z.string().min(1),
  name:        z.string(),
  type:        z.enum(["video", "audio", "image"]),
  duration:    z.number().nonnegative(),
  previewUrl:  z.string().optional(),
  peakManifest: z.array(z.number()).optional(),
});

const ClipEventSchema = z.object({
  id:        z.string().min(1),
  trackId:   z.string().min(1),
  sourceId:  z.string(),
  startTime: z.number().nonnegative(),
  duration:  z.number().positive(),
  mediaOffset: z.number().nonnegative(),
  // Allow all optional fields as unknown to remain forward-compatible
  groupId:             z.string().optional(),
  fadeInDuration:      z.number().optional(),
  fadeOutDuration:     z.number().optional(),
  manualFadeIn:        z.boolean().optional(),
  manualFadeOut:       z.boolean().optional(),
  effects:             z.array(z.unknown()).optional(),
  keyframes:           z.array(z.unknown()).optional(),
  panCrop:             z.unknown().optional(),
  playbackRate:        z.number().optional(),
  level:               z.number().optional(),
  fxParams:            z.record(z.string(), z.unknown()).optional(),
  embeddedEffectClips: z.array(z.unknown()).optional(),
  embeddedTextClips:   z.array(z.unknown()).optional(),
  renderedCss:         z.unknown().optional(),
});

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
  audioPan:        z.number().optional(),
  trackBrightness: z.number().optional(),
  trackContrast:   z.number().optional(),
  trackSaturate:   z.number().optional(),
  trackHueRotate:  z.number().optional(),
  reverbWet:       z.number().optional(),
  reverbRoomSize:  z.number().optional(),
  delayMs:         z.number().optional(),
  delayFeedback:   z.number().optional(),
});

// ── Project snapshot (embedded in FeedPost or loaded from IDB) ────────────────

export const ProjectSnapshotSchema = z.object({
  tracks:          z.array(TrackSchema),
  duration:        z.number().positive(),
  projectSettings: ProjectSettingsSchema,
  mediaPool:       z.array(MediaPoolItemSchema).optional(),
});

// ── Full serialised project (IDB project-idb.ts payload) ─────────────────────

export const SerializedProjectSchema = z.object({
  projectId:         z.string().min(1),
  name:              z.string(),
  tracks:            z.array(TrackSchema),
  duration:          z.number().nonnegative(),
  projectSettings:   ProjectSettingsSchema,
  mediaPool:         z.array(MediaPoolItemSchema).optional(),
  markers:           z.array(z.unknown()).optional(),
  parentProjectId:   z.string().optional(),
  remixedFromHandle: z.string().optional(),
  rootParentId:      z.string().optional(),
  rootParentHandle:  z.string().optional(),
  updatedAt:         z.number().optional(),
});

// ── FeedPost ──────────────────────────────────────────────────────────────────

export const FeedPostSchema = z.object({
  id:      z.string().min(1),
  type:    z.enum(["video", "preset"]).optional(),
  user:    z.object({
    handle:  z.string().min(1),
    initial: z.string().max(2),
    hue:     z.number().min(0).max(360),
  }),
  title:       z.string(),
  description: z.string().optional(),
  tags:        z.array(z.string()),
  bg:          z.string(),
  accent:      z.string(),
  duration:    z.string(),
  likes:       z.number().nonnegative().int(),
  comments:    z.number().nonnegative().int(),
  featured:    z.boolean(),
  videoUrl:    z.string().optional(),
  presetData:  z.unknown().optional(),
  projectSnapshot: ProjectSnapshotSchema.optional(),
  authorUsername:  z.string().optional(),
  allowRemix:      z.boolean().optional(),
  remixedFromPostId:   z.string().optional(),
  remixedFromHandle:   z.string().optional(),
  rootParentId:        z.string().optional(),
  rootParentHandle:    z.string().optional(),
  createdAt:     z.number().optional(),
  demoStartTime: z.number().optional(),
  demoDuration:  z.number().optional(),
  category:      z.enum(["high-sensation", "aesthetic", "cinematic", "glitch", "slow-mo"]).optional(),
});

export type ValidatedFeedPost        = z.infer<typeof FeedPostSchema>;
export type ValidatedSerializedProject = z.infer<typeof SerializedProjectSchema>;

// ── Validation helpers ────────────────────────────────────────────────────────

/** Validate a FeedPost from IDB. Returns null and logs on failure. */
export function validateFeedPost(raw: unknown, context = "IDB"): ValidatedFeedPost | null {
  const result = FeedPostSchema.safeParse(raw);
  if (!result.success) {
    console.error(`[Schema] FeedPost validation failed (${context})`, result.error.issues);
    return null;
  }
  return result.data;
}

/** Validate a serialised project from IDB. Returns null and logs on failure. */
export function validateSerializedProject(raw: unknown, context = "IDB"): ValidatedSerializedProject | null {
  const result = SerializedProjectSchema.safeParse(raw);
  if (!result.success) {
    console.error(`[Schema] SerializedProject validation failed (${context})`, result.error.issues);
    return null;
  }
  return result.data;
}

/** Validate a project snapshot (subset used inside FeedPost). Returns null and logs on failure. */
export function validateProjectSnapshot(raw: unknown, context = "IDB"): z.infer<typeof ProjectSnapshotSchema> | null {
  const result = ProjectSnapshotSchema.safeParse(raw);
  if (!result.success) {
    console.error(`[Schema] ProjectSnapshot validation failed (${context})`, result.error.issues);
    return null;
  }
  return result.data;
}
