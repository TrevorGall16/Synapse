// lib/utils/coords.test.ts
import { describe, it, expect } from "vitest";
import {
  screenPxToTimelinePx,
  timelinePxToTimeMicros,
  timeMicrosToTimelinePx,
  screenXToTimeMicros,
} from "./coords";

function mockRect(left: number): DOMRect {
  return {
    left,
    right: left + 800,
    top: 0,
    bottom: 600,
    width: 800,
    height: 600,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("screenPxToTimelinePx", () => {
  it("subtracts rect.left and adds scrollLeft", () => {
    // clientX=350, rect.left=50, scrollLeft=200 → 350 - 50 + 200 = 500
    expect(screenPxToTimelinePx(350, mockRect(50), 200)).toBe(500);
  });
});

describe("screenXToTimeMicros", () => {
  it("zero scroll, zoom 1.0 (pps=100), clientX=300, rect.left=0 → 3_000_000µs", () => {
    expect(screenXToTimeMicros(300, mockRect(0), 0, 100)).toBe(3_000_000);
  });

  it("500px scroll offset, pps=100, clientX=300 → 8_000_000µs", () => {
    // (300 - 0 + 500) / 100 * 1_000_000 = 8_000_000
    expect(screenXToTimeMicros(300, mockRect(0), 500, 100)).toBe(8_000_000);
  });

  it("zoom 0.1 (pps=10), zero scroll, clientX=100 → 10_000_000µs", () => {
    expect(screenXToTimeMicros(100, mockRect(0), 0, 10)).toBe(10_000_000);
  });

  it("zoom 3.0 (pps=300), zero scroll, clientX=300 → 1_000_000µs", () => {
    expect(screenXToTimeMicros(300, mockRect(0), 0, 300)).toBe(1_000_000);
  });
});

describe("round-trip", () => {
  it("timeMicrosToTimelinePx → timelinePxToTimeMicros is identity within 1µs", () => {
    const t = 7_500_000;
    const pps = 150;
    const px = timeMicrosToTimelinePx(t, pps);
    const result = timelinePxToTimeMicros(px, pps);
    expect(Math.abs(result - t)).toBeLessThanOrEqual(1);
  });
});
