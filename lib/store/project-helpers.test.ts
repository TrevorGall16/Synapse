// lib/store/project-helpers.test.ts — split invariant unit tests
import { describe, it, expect, vi, beforeEach } from "vitest";
import { performSplitClip, performBulkSplit } from "./project-helpers";
import type { Track, ClipEvent } from "./types";

// ── Deterministic UUID factory ─────────────────────────────────────
let uuidCounter = 0;
beforeEach(() => {
  uuidCounter = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () => `uuid-${++uuidCounter}` as ReturnType<typeof crypto.randomUUID>,
  );
});

// ── Minimal fixture builders ───────────────────────────────────────

function makeClip(overrides: Partial<ClipEvent> = {}): ClipEvent {
  return {
    id: "clip-1",
    trackId: "track-1",
    sourceId: "asset-A",
    startTime: 0,
    duration: 10_000_000, // 10s in microseconds
    mediaOffset: 0,
    ...overrides,
  };
}

function makeTrack(clips: ClipEvent[], id = "track-1"): Track {
  return {
    id,
    type: "video",
    name: "Video 1",
    height: 60,
    collapsed: false,
    locked: false,
    clips,
    opacityOrVolume: 100,
  };
}

// ══════════════════════════════════════════════════════════════════════
// performSplitClip
// ══════════════════════════════════════════════════════════════════════

describe("performSplitClip", () => {
  // ── Test 1: Both halves share the original sourceId ─────────────
  it("both halves share the original sourceId (GC invariant)", () => {
    const clip = makeClip({ sourceId: "asset-A" });
    const tracks = [makeTrack([clip])];

    const result = performSplitClip(tracks, "clip-1", 4_000_000);
    expect(result).not.toBeNull();
    const clips = result![0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].sourceId).toBe("asset-A");
    expect(clips[1].sourceId).toBe("asset-A");
  });

  // ── Test 2: durationA + durationB === original.duration ─────────
  it("durationA + durationB equals original duration (no gap, no overlap)", () => {
    const clip = makeClip({ duration: 10_000_000 });
    const tracks = [makeTrack([clip])];

    const result = performSplitClip(tracks, "clip-1", 3_500_000);
    expect(result).not.toBeNull();
    const [clipA, clipB] = result![0].clips;
    expect(clipA.duration + clipB.duration).toBe(10_000_000);
  });

  // ── Test 3: clipB.mediaOffset === original.mediaOffset + durationA
  it("clipB mediaOffset equals original mediaOffset + durationA", () => {
    const clip = makeClip({ mediaOffset: 1_000_000, duration: 10_000_000 });
    const tracks = [makeTrack([clip])];

    const splitTime = 4_000_000;
    const result = performSplitClip(tracks, "clip-1", splitTime);
    expect(result).not.toBeNull();
    const [clipA, clipB] = result![0].clips;
    const durationA = clipA.duration;
    expect(clipB.mediaOffset).toBe(1_000_000 + durationA);
  });

  // ── Test 4: Net clip count: before=1, after=2 ───────────────────
  it("produces exactly 2 clips from 1 (net +1)", () => {
    const clip = makeClip();
    const tracks = [makeTrack([clip])];

    const before = tracks[0].clips.length;
    const result = performSplitClip(tracks, "clip-1", 5_000_000);
    expect(result).not.toBeNull();
    const after = result![0].clips.length;
    expect(before).toBe(1);
    expect(after).toBe(2);
  });

  // ── Test 5: Distinct IDs for clipA and clipB ────────────────────
  it("produces two clips with distinct IDs", () => {
    const clip = makeClip();
    const tracks = [makeTrack([clip])];

    const result = performSplitClip(tracks, "clip-1", 5_000_000);
    expect(result).not.toBeNull();
    const [clipA, clipB] = result![0].clips;
    expect(clipA.id).not.toBe(clipB.id);
  });

  // ── Test 6: Returns null if splitTime is at/before clip start ───
  it("returns null when splitTime equals clip startTime", () => {
    const clip = makeClip({ startTime: 2_000_000 });
    const tracks = [makeTrack([clip])];
    expect(performSplitClip(tracks, "clip-1", 2_000_000)).toBeNull();
  });

  it("returns null when splitTime is before clip startTime", () => {
    const clip = makeClip({ startTime: 5_000_000 });
    const tracks = [makeTrack([clip])];
    expect(performSplitClip(tracks, "clip-1", 1_000_000)).toBeNull();
  });

  // ── Test 7: Returns null if splitTime is at/after clip end ──────
  it("returns null when splitTime equals clip end", () => {
    const clip = makeClip({ startTime: 0, duration: 10_000_000 });
    const tracks = [makeTrack([clip])];
    expect(performSplitClip(tracks, "clip-1", 10_000_000)).toBeNull();
  });

  it("returns null when splitTime is after clip end", () => {
    const clip = makeClip({ startTime: 0, duration: 10_000_000 });
    const tracks = [makeTrack([clip])];
    expect(performSplitClip(tracks, "clip-1", 15_000_000)).toBeNull();
  });

  // ── Test 8: Group-aware split ────────────────────────────────────
  it("splits all group members at the split point; right-halves share a new groupId", () => {
    const groupId = "group-X";
    const clipA = makeClip({ id: "clip-1", trackId: "track-1", groupId, startTime: 0, duration: 10_000_000 });
    const clipB = makeClip({ id: "clip-2", trackId: "track-2", groupId, startTime: 0, duration: 10_000_000 });

    const tracks = [
      makeTrack([clipA], "track-1"),
      makeTrack([clipB], "track-2"),
    ];

    const result = performSplitClip(tracks, "clip-1", 5_000_000);
    expect(result).not.toBeNull();

    const track1Clips = result![0].clips;
    const track2Clips = result![1].clips;

    // Both tracks were split
    expect(track1Clips).toHaveLength(2);
    expect(track2Clips).toHaveLength(2);

    // Right halves get a new shared groupId (not the original)
    const rightGroupIdT1 = track1Clips[1].groupId;
    const rightGroupIdT2 = track2Clips[1].groupId;
    expect(rightGroupIdT1).toBeDefined();
    expect(rightGroupIdT2).toBeDefined();
    expect(rightGroupIdT1).toBe(rightGroupIdT2);
    expect(rightGroupIdT1).not.toBe(groupId);
  });

  // ── Test 9: GC invariant — sourceId appears in both result clips ─
  it("GC invariant: original sourceId present in both result clips so GC keeps the asset", () => {
    const clip = makeClip({ sourceId: "asset-video-42" });
    const tracks = [makeTrack([clip])];

    const result = performSplitClip(tracks, "clip-1", 6_000_000);
    expect(result).not.toBeNull();

    const allSourceIds = result![0].clips.map((c) => c.sourceId);
    // Both clips reference the asset — GC scan would find it referenced and not orphan it
    expect(allSourceIds.every((sid) => sid === "asset-video-42")).toBe(true);
    expect(allSourceIds).toHaveLength(2);
  });

  // ── Additional integrity: clipA retains original id ─────────────
  it("left-half (clipA) retains the original clip id", () => {
    const clip = makeClip({ id: "clip-original" });
    const tracks = [makeTrack([clip])];

    const result = performSplitClip(tracks, "clip-original", 5_000_000);
    expect(result).not.toBeNull();
    expect(result![0].clips[0].id).toBe("clip-original");
  });

  // ── Additional integrity: clipA startTime unchanged ─────────────
  it("left-half (clipA) startTime is unchanged", () => {
    const clip = makeClip({ startTime: 2_000_000, duration: 10_000_000 });
    const tracks = [makeTrack([clip])];

    const result = performSplitClip(tracks, "clip-1", 7_000_000);
    expect(result).not.toBeNull();
    expect(result![0].clips[0].startTime).toBe(2_000_000);
  });

  // ── Additional integrity: clipB startTime equals splitTime ───────
  it("right-half (clipB) startTime equals splitTime", () => {
    const clip = makeClip({ startTime: 0, duration: 10_000_000 });
    const tracks = [makeTrack([clip])];

    const splitTime = 6_000_000;
    const result = performSplitClip(tracks, "clip-1", splitTime);
    expect(result).not.toBeNull();
    expect(result![0].clips[1].startTime).toBe(splitTime);
  });
});

// ══════════════════════════════════════════════════════════════════════
// performBulkSplit
// ══════════════════════════════════════════════════════════════════════

describe("performBulkSplit", () => {
  // ── Test 1: All selected clips get split at splitTime ───────────
  it("splits all selected clips at the given splitTime", () => {
    const clip1 = makeClip({ id: "clip-1", trackId: "track-1" });
    const clip2 = makeClip({ id: "clip-2", trackId: "track-2" });
    const tracks = [makeTrack([clip1], "track-1"), makeTrack([clip2], "track-2")];

    const result = performBulkSplit(tracks, ["clip-1", "clip-2"], 5_000_000);
    expect(result[0].clips).toHaveLength(2);
    expect(result[1].clips).toHaveLength(2);
  });

  // ── Test 2: sourceId preserved in both halves for each clip ─────
  it("sourceId is preserved in both halves for every split clip", () => {
    const clip1 = makeClip({ id: "clip-1", trackId: "track-1", sourceId: "asset-X" });
    const clip2 = makeClip({ id: "clip-2", trackId: "track-2", sourceId: "asset-Y" });
    const tracks = [makeTrack([clip1], "track-1"), makeTrack([clip2], "track-2")];

    const result = performBulkSplit(tracks, ["clip-1", "clip-2"], 5_000_000);

    const track1Clips = result[0].clips;
    const track2Clips = result[1].clips;
    expect(track1Clips[0].sourceId).toBe("asset-X");
    expect(track1Clips[1].sourceId).toBe("asset-X");
    expect(track2Clips[0].sourceId).toBe("asset-Y");
    expect(track2Clips[1].sourceId).toBe("asset-Y");
  });

  // ── Test 3: Duration invariant holds for each clip ───────────────
  it("durationA + durationB equals original duration for each split clip", () => {
    const clip1 = makeClip({ id: "clip-1", trackId: "track-1", duration: 10_000_000 });
    const clip2 = makeClip({ id: "clip-2", trackId: "track-2", duration: 8_000_000 });
    const tracks = [makeTrack([clip1], "track-1"), makeTrack([clip2], "track-2")];

    const result = performBulkSplit(tracks, ["clip-1", "clip-2"], 4_000_000);

    const [a1, b1] = result[0].clips;
    const [a2, b2] = result[1].clips;
    expect(a1.duration + b1.duration).toBe(10_000_000);
    expect(a2.duration + b2.duration).toBe(8_000_000);
  });

  // ── Test 4: mediaOffset invariant holds for each clip ───────────
  it("clipB.mediaOffset equals original.mediaOffset + durationA for each split clip", () => {
    const clip1 = makeClip({ id: "clip-1", trackId: "track-1", mediaOffset: 500_000, duration: 10_000_000 });
    const clip2 = makeClip({ id: "clip-2", trackId: "track-2", mediaOffset: 2_000_000, duration: 10_000_000 });
    const tracks = [makeTrack([clip1], "track-1"), makeTrack([clip2], "track-2")];

    const splitTime = 4_000_000;
    const result = performBulkSplit(tracks, ["clip-1", "clip-2"], splitTime);

    const [a1, b1] = result[0].clips;
    const [a2, b2] = result[1].clips;
    expect(b1.mediaOffset).toBe(500_000 + a1.duration);
    expect(b2.mediaOffset).toBe(2_000_000 + a2.duration);
  });

  // ── Test 5: Group-aware right-half linking ───────────────────────
  it("clips sharing a groupId get the same new right-groupId", () => {
    const groupId = "group-G1";
    const clip1 = makeClip({ id: "clip-1", trackId: "track-1", groupId });
    const clip2 = makeClip({ id: "clip-2", trackId: "track-2", groupId });
    const tracks = [makeTrack([clip1], "track-1"), makeTrack([clip2], "track-2")];

    const result = performBulkSplit(tracks, ["clip-1", "clip-2"], 5_000_000);

    const rightGroupT1 = result[0].clips[1].groupId;
    const rightGroupT2 = result[1].clips[1].groupId;
    expect(rightGroupT1).toBeDefined();
    expect(rightGroupT2).toBeDefined();
    expect(rightGroupT1).toBe(rightGroupT2);
    expect(rightGroupT1).not.toBe(groupId);
  });

  // ── Test 6: Clips entirely before or after splitTime are unchanged
  it("clips entirely before splitTime are returned unchanged", () => {
    const earlyClip = makeClip({ id: "clip-early", trackId: "track-1", startTime: 0, duration: 2_000_000 });
    const tracks = [makeTrack([earlyClip], "track-1")];

    const result = performBulkSplit(tracks, ["clip-early"], 5_000_000);
    expect(result[0].clips).toHaveLength(1);
    expect(result[0].clips[0].id).toBe("clip-early");
    expect(result[0].clips[0].duration).toBe(2_000_000);
  });

  it("clips entirely after splitTime are returned unchanged", () => {
    const lateClip = makeClip({ id: "clip-late", trackId: "track-1", startTime: 8_000_000, duration: 4_000_000 });
    const tracks = [makeTrack([lateClip], "track-1")];

    const result = performBulkSplit(tracks, ["clip-late"], 5_000_000);
    expect(result[0].clips).toHaveLength(1);
    expect(result[0].clips[0].id).toBe("clip-late");
    expect(result[0].clips[0].startTime).toBe(8_000_000);
  });

  it("non-selected clips on the same track are unchanged when a neighbour is split", () => {
    const splitTarget = makeClip({ id: "clip-split", trackId: "track-1", startTime: 0, duration: 10_000_000 });
    const bystander = makeClip({ id: "clip-by", trackId: "track-1", startTime: 12_000_000, duration: 3_000_000 });
    const tracks = [makeTrack([splitTarget, bystander], "track-1")];

    const result = performBulkSplit(tracks, ["clip-split"], 5_000_000);
    // 2 halves + 1 bystander
    expect(result[0].clips).toHaveLength(3);
    const byCopy = result[0].clips.find((c) => c.id === "clip-by");
    expect(byCopy).toBeDefined();
    expect(byCopy!.startTime).toBe(12_000_000);
    expect(byCopy!.duration).toBe(3_000_000);
  });

  // ── Media pool delta is zero (no new/removed pool entries) ───────
  it("media pool delta is zero: split creates no new pool entries and removes none", () => {
    // The media pool lives outside tracks; split only touches clips.
    // We verify indirectly: sourceIds in result clips are unchanged,
    // meaning GC scan returns the same referencedId set as before the split.
    const clip = makeClip({ id: "clip-1", trackId: "track-1", sourceId: "asset-pool-42" });
    const tracks = [makeTrack([clip], "track-1")];

    const beforeIds = new Set(tracks.flatMap((t) => t.clips.map((c) => c.sourceId)));

    const result = performBulkSplit(tracks, ["clip-1"], 5_000_000);
    const afterIds = new Set(result.flatMap((t) => t.clips.map((c) => c.sourceId)));

    expect(afterIds).toEqual(beforeIds);
  });
});
