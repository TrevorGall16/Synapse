import { describe, it, expect } from "vitest";
import { trimClipsToSelection, trimTracksToSelection } from "./publish-trim";
import type { ClipEvent, Track } from "@/lib/store/types";

function makeClip(overrides: Partial<ClipEvent> = {}): ClipEvent {
  return {
    id: "c1",
    trackId: "t1",
    sourceId: "a1",
    startTime: 0,
    duration: 10_000_000,
    mediaOffset: 0,
    ...overrides,
  };
}

describe("trimClipsToSelection", () => {
  it("leaves a fully-enclosed clip untouched except for rebased startTime", () => {
    const c = makeClip({ startTime: 6_000_000, duration: 2_000_000, mediaOffset: 1_000_000 });
    const out = trimClipsToSelection(c, 5_000_000, 5_000_000); // selection [5s, 10s)
    expect(out.startTime).toBe(1_000_000);
    expect(out.duration).toBe(2_000_000);
    expect(out.mediaOffset).toBe(1_000_000);
  });

  it("head-trims a clip that starts before the selection (mediaOffset advances)", () => {
    // Clip spans 3s→13s, media starts at 0. Selection is 5s→10s (5s long).
    // Visible portion is 5s→10s which is clip-local 2s→7s, so mediaOffset +=2s and duration=5s.
    const c = makeClip({ startTime: 3_000_000, duration: 10_000_000, mediaOffset: 0 });
    const out = trimClipsToSelection(c, 5_000_000, 5_000_000);
    expect(out.startTime).toBe(0);
    expect(out.mediaOffset).toBe(2_000_000);
    expect(out.duration).toBe(5_000_000);
  });

  it("tail-trims a clip that ends after the selection", () => {
    // Clip spans 8s→18s. Selection is 5s→12s (7s long).
    // Head trim: 0 (clip starts inside). Tail trim: 18-12 = 6s. New duration = 10-6 = 4s.
    const c = makeClip({ startTime: 8_000_000, duration: 10_000_000, mediaOffset: 500_000 });
    const out = trimClipsToSelection(c, 5_000_000, 7_000_000);
    expect(out.startTime).toBe(3_000_000);
    expect(out.mediaOffset).toBe(500_000);
    expect(out.duration).toBe(4_000_000);
  });

  it("both head- and tail-trims a clip that straddles both boundaries", () => {
    // Clip spans 0s→20s. Selection is 5s→12s (7s).
    // Head trim 5s, tail trim 8s → duration 7s, mediaOffset 5s.
    const c = makeClip({ startTime: 0, duration: 20_000_000, mediaOffset: 0 });
    const out = trimClipsToSelection(c, 5_000_000, 7_000_000);
    expect(out.startTime).toBe(0);
    expect(out.mediaOffset).toBe(5_000_000);
    expect(out.duration).toBe(7_000_000);
  });

  it("preserves an existing mediaOffset when head-trimming", () => {
    const c = makeClip({ startTime: 3_000_000, duration: 10_000_000, mediaOffset: 1_500_000 });
    const out = trimClipsToSelection(c, 5_000_000, 5_000_000);
    expect(out.mediaOffset).toBe(1_500_000 + 2_000_000);
  });
});

describe("trimTracksToSelection", () => {
  function makeTrack(clips: ClipEvent[]): Track {
    return {
      id: "t1",
      type: "video",
      name: "V1",
      color: "#fff",
      height: 60,
      collapsed: false,
      locked: false,
      isMuted: false,
      isSolo: false,
      opacityOrVolume: 100,
      clips,
    };
  }

  it("drops clips that lie entirely outside the selection", () => {
    const t = makeTrack([
      makeClip({ id: "before", startTime: 0,          duration: 1_000_000 }),
      makeClip({ id: "inside", startTime: 6_000_000,  duration: 2_000_000 }),
      makeClip({ id: "after",  startTime: 20_000_000, duration: 5_000_000 }),
    ]);
    const [out] = trimTracksToSelection([t], 5_000_000, 5_000_000);
    expect(out.clips.map((c) => c.id)).toEqual(["inside"]);
  });

  it("trims straddling clips instead of passing them through unchanged", () => {
    const t = makeTrack([
      makeClip({ id: "head", startTime: 3_000_000, duration: 5_000_000 }),
      makeClip({ id: "tail", startTime: 8_000_000, duration: 6_000_000 }),
    ]);
    const [out] = trimTracksToSelection([t], 5_000_000, 5_000_000);
    const head = out.clips.find((c) => c.id === "head")!;
    const tail = out.clips.find((c) => c.id === "tail")!;
    expect(head.startTime).toBe(0);
    expect(head.mediaOffset).toBe(2_000_000);
    expect(head.duration).toBe(3_000_000);
    expect(tail.startTime).toBe(3_000_000);
    expect(tail.mediaOffset).toBe(0);
    expect(tail.duration).toBe(2_000_000);
  });
});
