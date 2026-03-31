import type { Track, TrackType, ClipEvent, MediaPoolItem } from "./types";

// ── Constants ───────────────────────────────────────────

export const TRACK_COLORS: Record<TrackType, string> = {
  video: "#3b82f6",
  audio: "#22c55e",
  effect: "#ef4444",
  text: "#eab308",
};

export const TRACK_LABELS: Record<TrackType, string> = {
  video: "Video",
  audio: "Audio",
  effect: "Effect",
  text: "Text",
};

export const TRACK_HEIGHTS: Record<TrackType, number> = {
  video: 60,
  audio: 40,
  effect: 48,
  text: 48,
};

// ── Helpers ─────────────────────────────────────────────

export function quantizeToFrame(timeUs: number, fps: number = 30): number {
  const frameDurationUs = Math.round(1_000_000 / fps);
  return Math.round(timeUs / frameDurationUs) * frameDurationUs;
}

export function createTrack(type: TrackType, count: number): Track {
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

export function findClipLocation(tracks: Track[], clipId: string): { clip: ClipEvent; trackIndex: number } | undefined {
  for (let i = 0; i < tracks.length; i++) {
    const clip = tracks[i].clips.find((c) => c.id === clipId);
    if (clip) return { clip, trackIndex: i };
  }
  return undefined;
}

export function findClipsByGroupId(tracks: Track[], groupId: string): { clip: ClipEvent; trackIndex: number }[] {
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
export function sameTypeIndices(tracks: Track[], type: TrackType): number[] {
  const indices: number[] = [];
  for (let i = 0; i < tracks.length; i++) {
    if (tracks[i].type === type) indices.push(i);
  }
  return indices;
}

/** Compute the move result for a clip (+ group) across tracks. */
export function computeMove(
  state: { tracks: Track[]; snapEnabled: boolean; duration: number },
  clipId: string,
  deltaTime: number,
  deltaTrack: number,
  getPlaybackState: () => { pixelsPerSecond: number; globalBpm: number; rippleMode: boolean },
): { tracks: Track[]; duration: number } | null {
  if (deltaTime === 0 && deltaTrack === 0) return null;

  const target = findClipLocation(state.tracks, clipId);
  if (!target) return null;

  const groupMembers = target.clip.groupId
    ? findClipsByGroupId(state.tracks, target.clip.groupId)
    : [target];

  const tracks = state.tracks.map((t) => ({ ...t, clips: [...t.clips] }));
  const moves: { clipId: string; fromIdx: number; toIdx: number; newStartTime: number }[] = [];
  const affectedTrackIndices = new Set<number>();

  // Snap is handled entirely by snapToNearby() in the UI layer before moveClip() is called.
  // computeMove receives the already-snapped deltaTime — no double-snap here.
  const snappedDeltaTime = deltaTime;

  for (const member of groupMembers) {
    // Use exact integer microseconds — quantizeToFrame is intentionally bypassed here
    // because it can shift a hard-snapped position off the target edge by ≤16,666µs,
    // which creates a micro-overlap even after a "Perfect Cut" snap.
    const newStartTime = Math.max(0, Math.round(member.clip.startTime + snappedDeltaTime));
    const clipType = state.tracks[member.trackIndex].type;
    const sameType = sameTypeIndices(tracks, clipType);
    const currentSameTypeIdx = sameType.indexOf(member.trackIndex);
    if (currentSameTypeIdx === -1) return null;

    const targetSameTypeIdx = currentSameTypeIdx + deltaTrack;
    if (targetSameTypeIdx < 0) return null;

    let toIdx: number;
    if (targetSameTypeIdx < sameType.length) {
      toIdx = sameType[targetSameTypeIdx];
    } else {
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

  if (moves.length === 0) return null;

  for (const move of moves) {
    tracks[move.fromIdx] = {
      ...tracks[move.fromIdx],
      clips: tracks[move.fromIdx].clips.filter((c) => c.id !== move.clipId),
    };
  }

  let maxEnd = 0;
  for (const move of moves) {
    const originalClip = groupMembers.find((gm) => gm.clip.id === move.clipId)!.clip;
    const updatedClip: ClipEvent = { ...originalClip, startTime: move.newStartTime, trackId: tracks[move.toIdx].id };
    tracks[move.toIdx] = { ...tracks[move.toIdx], clips: [...tracks[move.toIdx].clips, updatedClip] };
    maxEnd = Math.max(maxEnd, move.newStartTime + updatedClip.duration);
  }

  // ── Ripple Edit: shift subsequent clips on affected tracks ──
  const { rippleMode } = getPlaybackState();
  if (rippleMode && snappedDeltaTime !== 0) {
    const movedIds = new Set(moves.map((m) => m.clipId));
    for (const idx of affectedTrackIndices) {
      if (idx >= tracks.length) continue;
      const movedClipsOnTrack = moves.filter((m) => m.toIdx === idx);
      if (movedClipsOnTrack.length === 0) continue;
      const movedEnd = Math.max(...movedClipsOnTrack.map((m) => {
        const clip = groupMembers.find((gm) => gm.clip.id === m.clipId)!.clip;
        return m.newStartTime + clip.duration;
      }));
      tracks[idx] = {
        ...tracks[idx],
        clips: tracks[idx].clips.map((c) => {
          if (movedIds.has(c.id)) return c;
          if (c.startTime >= movedEnd - snappedDeltaTime) {
            return { ...c, startTime: Math.max(0, c.startTime + snappedDeltaTime) };
          }
          return c;
        }),
      };
    }
  }

  for (const idx of affectedTrackIndices) {
    if (idx < tracks.length) {
      tracks[idx] = { ...tracks[idx], clips: computeCrossfades(tracks[idx].clips) };
    }
  }

  const newDuration = maxEnd > state.duration ? maxEnd + 60_000_000 : state.duration;
  return { tracks, duration: newDuration };
}

/**
 * Split a single clip at `splitTime` (group-aware). Returns new tracks array or null.
 *
 * ## Per-Asset refCount Model
 * `ClipEvent.sourceId` references a `MediaPoolItem.id` — one entry per imported asset.
 * The GC service (`gc-service.ts`) builds `referencedIds` by scanning `clip.sourceId`
 * across all clips. Splitting does **not** create or remove any `MediaPoolItem`; both
 * result clips carry the same `sourceId` as the original, so the asset remains referenced
 * and the GC never orphans it. No `refCount` field exists on `ClipEvent` itself.
 *
 * ### Invariants guaranteed after every split
 * - Both halves share the original `sourceId` (net media-pool delta = 0).
 * - `clipA.duration + clipB.duration === original.duration` (no gap, no overlap).
 * - `clipB.mediaOffset === original.mediaOffset + clipA.duration` (no media data corrupted).
 * - `clipB.id` is a fresh UUID; `clipA.id` is unchanged.
 * - If the clip belongs to a group, **all** other group members whose range spans
 *   `splitTime` are also split; their right-halves receive a new shared `groupId`.
 *
 * @returns The updated `Track[]` on success, or `null` if:
 *   - the clip cannot be found,
 *   - `splitTime` is at or before `clip.startTime`, or
 *   - `splitTime` is at or after `clip.startTime + clip.duration`.
 */
export function performSplitClip(
  tracks: Track[],
  clipId: string,
  splitTime: number,
): Track[] | null {
  const location = findClipLocation(tracks, clipId);
  if (!location) return null;

  const { clip } = location;
  if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) return null;

  const targets = clip.groupId
    ? findClipsByGroupId(tracks, clip.groupId)
    : [location];

  const newGroupId = clip.groupId ? crypto.randomUUID() : undefined;

  const splitMap = new Map<string, { trackIndex: number; clip: ClipEvent }>();
  for (const t of targets) {
    if (splitTime > t.clip.startTime && splitTime < t.clip.startTime + t.clip.duration) {
      splitMap.set(t.clip.id, t);
    }
  }

  if (splitMap.size === 0) return null;

  return tracks.map((t) => {
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
  });
}

/**
 * Bulk-split a set of selected clips at `splitTime` (group-aware). Always returns a
 * new `Track[]` — clips that don't span `splitTime` are left untouched.
 *
 * ## Per-Asset refCount Model
 * Identical to `performSplitClip`: each `MediaPoolItem` is one imported asset; its `id`
 * is stored as `ClipEvent.sourceId`. Splitting never touches the media pool — both result
 * clips inherit the same `sourceId`, keeping the GC reference intact. No `refCount` field
 * exists or is needed on `ClipEvent`.
 *
 * ### Invariants guaranteed for every split clip
 * - Both halves share the original `sourceId` (net media-pool delta = 0).
 * - `clipA.duration + clipB.duration === original.duration` (no gap, no overlap).
 * - `clipB.mediaOffset === original.mediaOffset + clipA.duration` (no media data corrupted).
 * - Clips sharing a `groupId` produce right-halves with the **same new** `groupId`
 *   (one stable UUID per original group, generated lazily via `newGroupMap`).
 * - Clips whose entire range is before or after `splitTime` are returned unchanged.
 */
export function performBulkSplit(
  tracks: Track[],
  clipIds: string[],
  splitTime: number,
): Track[] {
  const newGroupMap = new Map<string, string>();
  let result = tracks.map((t) => ({ ...t, clips: [...t.clips] }));

  for (const clipId of clipIds) {
    const location = findClipLocation(result, clipId);
    if (!location) continue;

    const { clip, trackIndex } = location;
    if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) continue;

    const durationA = Math.round(splitTime - clip.startTime);
    const durationB = Math.round(clip.duration - durationA);
    const clipA: ClipEvent = { ...clip, duration: durationA };

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

    result = result.map((t, i) => {
      if (i !== trackIndex) return t;
      return { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? [clipA, clipB] : [c])) };
    });
  }

  return result;
}

/** Join selected clips per source within each track. */
export function performJoinClips(tracks: Track[], clipIds: string[]): Track[] {
  if (clipIds.length < 2) return tracks;
  const idSet = new Set(clipIds);
  return tracks.map((t) => {
    const selected = t.clips.filter((c) => idSet.has(c.id));
    if (selected.length < 2) return t;
    const bySource = new Map<string, ClipEvent[]>();
    for (const c of selected) { const arr = bySource.get(c.sourceId) ?? []; arr.push(c); bySource.set(c.sourceId, arr); }
    let clips = [...t.clips];
    for (const [, group] of bySource) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.startTime - b.startTime);
      const earliest = group[0];
      const newEnd = group.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
      const mergedFx = group.reduce<Record<string, unknown>>((acc, gc) => gc.fxParams ? { ...acc, ...gc.fxParams } : acc, {});
      const avgLevel = Math.round(group.reduce((sum, gc) => sum + (gc.level ?? 100), 0) / group.length);
      const merged: ClipEvent = { ...earliest, duration: newEnd - earliest.startTime, fxParams: Object.keys(mergedFx).length > 0 ? mergedFx : earliest.fxParams, level: avgLevel };
      const removeIds = new Set(group.map((c) => c.id));
      clips = clips.filter((c) => !removeIds.has(c.id));
      clips.push(merged);
    }
    return { ...t, clips };
  });
}

/** Delete selected clips, optionally ripple-shifting subsequent clips. */
export function performDeleteClips(tracks: Track[], clipIds: string[], rippleMode: boolean): Track[] {
  const idSet = new Set(clipIds);
  return tracks.map((t) => {
    const deleted = t.clips.filter((c) => idSet.has(c.id));
    let remaining = t.clips.filter((c) => !idSet.has(c.id));
    if (rippleMode && deleted.length > 0) {
      for (const d of deleted) {
        remaining = remaining.map((c) => c.startTime > d.startTime ? { ...c, startTime: Math.max(0, c.startTime - d.duration) } : c);
      }
    }
    return { ...t, clips: computeCrossfades(remaining) };
  });
}

/** Auto-crossfade: detect overlaps on a single track, set fade durations.
 *  Respects manual fade flags — won't overwrite user-set fades. */
export function computeCrossfades(clips: ClipEvent[]): ClipEvent[] {
  const sorted = [...clips]
    .map((c) => ({
      ...c,
      fadeInDuration: c.manualFadeIn ? c.fadeInDuration : undefined,
      fadeOutDuration: c.manualFadeOut ? c.fadeOutDuration : undefined,
    }) as ClipEvent)
    .sort((a, b) => a.startTime - b.startTime);

  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].startTime + sorted[i - 1].duration;
    if (sorted[i].startTime < prevEnd) {
      const overlap = prevEnd - sorted[i].startTime;
      if (!sorted[i - 1].manualFadeOut) {
        sorted[i - 1] = { ...sorted[i - 1], fadeOutDuration: overlap };
      }
      if (!sorted[i].manualFadeIn) {
        sorted[i] = { ...sorted[i], fadeInDuration: overlap };
      }
    }
  }

  return sorted;
}

/**
 * Restore selected fragments sharing a single sourceId to one uncut clip.
 *
 * ## Deterministic Placement Rule
 * 1. All selected clips must share one `sourceId` and one `trackId`.
 * 2. Scope: every clip on the same track with matching `sourceId` whose range
 *    overlaps `[earliestStart, latestEnd)` — catches unselected gap fragments.
 * 3. Sync-preserving anchor:
 *      rawStart = earliestFragment.startTime - earliestFragment.mediaOffset
 *    - rawStart >= 0 → startTime = rawStart, mediaOffset = 0, duration = media.duration
 *    - rawStart <  0 → startTime = 0, mediaOffset = -rawStart, duration = media.duration - mediaOffset
 * 4. refCount: no change — split/restore are timeline-fragment operations only.
 *
 * @returns Updated `Track[]` on success, or `{ error: string }` on validation failure.
 */
export function performRestoreOriginal(
  tracks: Track[],
  selectedClipIds: string[],
  mediaPool: MediaPoolItem[]
): Track[] | { error: string } {
  if (selectedClipIds.length === 0) return { error: "No clips selected." };

  // Collect selected clips across all tracks
  const selected: ClipEvent[] = [];
  for (const t of tracks) {
    for (const c of t.clips) {
      if (selectedClipIds.includes(c.id)) selected.push(c);
    }
  }
  if (selected.length === 0) return { error: "Selected clips not found." };

  // Validate: all share one sourceId and one trackId
  const sourceId = selected[0].sourceId;
  const trackId = selected[0].trackId;
  if (!selected.every((c) => c.sourceId === sourceId))
    return { error: "Selected clips must share the same source." };
  if (!selected.every((c) => c.trackId === trackId))
    return { error: "Selected clips must be on the same track." };

  // Sync anchor: fragment with the earliest startTime
  const earliestFragment = selected.reduce((a, b) => (a.startTime <= b.startTime ? a : b));
  const latestEnd = selected.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
  const earliestStart = earliestFragment.startTime;

  // Scope: all clips on the target track with the same sourceId overlapping [earliestStart, latestEnd)
  const targetTrack = tracks.find((t) => t.id === trackId);
  if (!targetTrack) return { error: "Target track not found." };
  const scopeIds = new Set<string>();
  for (const c of targetTrack.clips) {
    if (
      c.sourceId === sourceId &&
      c.startTime < latestEnd &&
      c.startTime + c.duration > earliestStart
    ) {
      scopeIds.add(c.id);
    }
  }

  // Look up media in pool
  const media = mediaPool.find((m) => m.id === sourceId);
  if (!media) return { error: "Source media not found in pool." };

  // Compute sync-preserving anchor
  const rawStart = earliestFragment.startTime - earliestFragment.mediaOffset;
  let startTime: number;
  let mediaOffset: number;
  let duration: number;
  if (rawStart >= 0) {
    startTime = rawStart;
    mediaOffset = 0;
    duration = media.duration;
  } else {
    // Media start would precede timeline origin — clamp and compensate
    startTime = 0;
    mediaOffset = -rawStart;
    duration = media.duration - mediaOffset;
  }

  if (duration <= 0) return { error: "Restored clip would have zero or negative duration after clamping." };

  // Build the restored clip at explicit defaults (no inherited fx/fades/group)
  const restoredClip: ClipEvent = {
    id: crypto.randomUUID(),
    trackId,
    sourceId,
    startTime,
    duration,
    mediaOffset,
    level: 100,
    fadeInDuration: 0,
    fadeOutDuration: 0,
    manualFadeIn: false,
    manualFadeOut: false,
    groupId: undefined,
  };

  // Remove scope fragments, insert restored clip, recompute crossfades
  return tracks.map((t) => {
    if (t.id !== trackId) return t;
    const remaining = t.clips.filter((c) => !scopeIds.has(c.id));
    return { ...t, clips: computeCrossfades([...remaining, restoredClip]) };
  });
}
