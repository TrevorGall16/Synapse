import type { Track, TrackType, ClipEvent } from "./types";

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
  getGridIntervalFn: (pps: number) => number,
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

  let snappedDeltaTime = deltaTime;
  if (state.snapEnabled && deltaTime !== 0) {
    const { pixelsPerSecond, globalBpm } = getPlaybackState();
    const rawStart = Math.max(0, Math.round(target.clip.startTime + deltaTime));
    const intervalSec = getGridIntervalFn(pixelsPerSecond);
    const gridMicros = Math.round(intervalSec * 1_000_000);
    const nearestGrid = Math.round(rawStart / gridMicros) * gridMicros;
    const thresholdMicros = Math.round((10 / pixelsPerSecond) * 1_000_000);

    // BPM snap candidate
    let bestCandidate = nearestGrid;
    let bestDist = Math.abs(rawStart - nearestGrid);
    if (globalBpm > 0) {
      const beatMicros = Math.round(60_000_000 / globalBpm);
      const nearestBeat = Math.round(rawStart / beatMicros) * beatMicros;
      const beatDist = Math.abs(rawStart - nearestBeat);
      if (beatDist < bestDist) {
        bestCandidate = nearestBeat;
        bestDist = beatDist;
      }
    }

    if (bestDist < thresholdMicros) {
      snappedDeltaTime = bestCandidate - target.clip.startTime;
    }
  }

  for (const member of groupMembers) {
    const newStartTime = quantizeToFrame(Math.max(0, Math.round(member.clip.startTime + snappedDeltaTime)));
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

/** Split a single clip at splitTime (group-aware). Returns new tracks or null. */
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

/** Bulk split selected clips with group-aware right-half linking. Returns new tracks. */
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
