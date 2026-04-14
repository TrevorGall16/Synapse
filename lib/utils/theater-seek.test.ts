import { describe, it, expect } from "vitest";
import {
  computeSeekTarget,
  timelineUsFromMedia,
  mediaSecFromTimeline,
  isOutsideDemoWindow,
  type ClipWithUrl,
} from "./theater-seek";

function makeClip(overrides: Partial<ClipWithUrl> = {}): ClipWithUrl {
  return {
    id: "c1",
    trackId: "t1",
    sourceId: "a1",
    startTime: 0,
    duration: 7_000_000,
    mediaOffset: 0,
    url: "blob:clip",
    ...overrides,
  };
}

const RECT = { left: 0, width: 1000 };

describe("computeSeekTarget — paused/playing parity", () => {
  const demoStartUs = 0;
  const demoDurUs = 7_000_000;
  const clips: ClipWithUrl[] = [makeClip({ duration: 7_000_000, mediaOffset: 4_000_000 })];

  it("middle of the bar lands halfway through the demo window", () => {
    const out = computeSeekTarget(500, RECT, demoStartUs, demoDurUs, clips)!;
    expect(out.ratio).toBeCloseTo(0.5, 6);
    expect(out.timelineUs).toBe(3_500_000);
    expect(out.targetClip!.id).toBe("c1");
    // mediaSec = (3_500_000 - 0 + 4_000_000) / 1e6 = 7.5s — middle of a 4→11s ruler window.
    expect(out.mediaSec).toBeCloseTo(7.5, 6);
  });

  it("returns identical output regardless of play/pause — helper has no branch on state", () => {
    const paused = computeSeekTarget(317, RECT, demoStartUs, demoDurUs, clips);
    const playing = computeSeekTarget(317, RECT, demoStartUs, demoDurUs, clips);
    expect(paused).toEqual(playing);
  });

  it("repeated seeks while playing produce monotonic timelineUs aligned to ratio", () => {
    const xs = [0, 125, 250, 375, 500, 625, 750, 875, 1000];
    const results = xs.map((x) => computeSeekTarget(x, RECT, demoStartUs, demoDurUs, clips)!);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].timelineUs).toBeGreaterThanOrEqual(results[i - 1].timelineUs);
    }
    expect(results[0].timelineUs).toBe(0);
    expect(results[results.length - 1].timelineUs).toBe(demoDurUs);
  });

  it("clamps pointer X outside the rect (does not seek past the window)", () => {
    const before = computeSeekTarget(-50, RECT, demoStartUs, demoDurUs, clips)!;
    const after = computeSeekTarget(9999, RECT, demoStartUs, demoDurUs, clips)!;
    expect(before.ratio).toBe(0);
    expect(before.timelineUs).toBe(0);
    expect(after.ratio).toBe(1);
    expect(after.timelineUs).toBe(demoDurUs);
  });

  it("returns null for degenerate rect / zero demo duration", () => {
    expect(computeSeekTarget(10, { left: 0, width: 0 }, 0, demoDurUs, clips)).toBeNull();
    expect(computeSeekTarget(10, RECT, 0, 0, clips)).toBeNull();
  });
});

describe("timelineUsFromMedia / mediaSecFromTimeline", () => {
  it("round-trips for a clip with nonzero mediaOffset (4–11s ruler selection fixture)", () => {
    const clip = makeClip({ startTime: 0, duration: 7_000_000, mediaOffset: 4_000_000 });
    // Timeline 0 → media currentTime 4s (the selection's first visible frame).
    const mediaSec = mediaSecFromTimeline(clip, 0);
    expect(mediaSec).toBe(4);
    // And back.
    const timelineUs = timelineUsFromMedia(clip, mediaSec);
    expect(timelineUs).toBe(0);
  });

  it("maps media currentTime through the clip offset (no coord-space conflation)", () => {
    const clip = makeClip({ startTime: 2_000_000, duration: 7_000_000, mediaOffset: 4_000_000 });
    // Media at 5.5s on a clip that starts at timeline 2s with mediaOffset 4s
    //   → timeline = 2_000_000 + (5_500_000 - 4_000_000) = 3_500_000
    expect(timelineUsFromMedia(clip, 5.5)).toBe(3_500_000);
  });

  it("falls back safely when there is no active clip", () => {
    expect(timelineUsFromMedia(null, 2.5)).toBe(2_500_000);
    expect(mediaSecFromTimeline(null, 2_500_000)).toBe(2.5);
  });
});

describe("isOutsideDemoWindow", () => {
  it("returns false inside the window", () => {
    expect(isOutsideDemoWindow(3_500_000, 0, 7_000_000)).toBe(false);
  });
  it("returns true before the window", () => {
    expect(isOutsideDemoWindow(-1, 0, 7_000_000)).toBe(true);
  });
  it("returns true within the trailing slack near the end", () => {
    expect(isOutsideDemoWindow(6_990_000, 0, 7_000_000)).toBe(true);
  });
  it("respects nonzero demoStartUs", () => {
    expect(isOutsideDemoWindow(1_500_000, 2_000_000, 5_000_000)).toBe(true);
    expect(isOutsideDemoWindow(4_000_000, 2_000_000, 5_000_000)).toBe(false);
  });
});
