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

// ── Clip drag grab-offset invariants ────────────────────────────────────────
//
// Drag formula (from clip-event.tsx):
//   grabOffset = (clientX_down + scrollLeft_down) / pps * 1e6 - clipStart
//   proposedStart = (clientX_now + scrollLeft_now) / pps * 1e6 - grabOffset
//
// This reduces to:
//   proposedStart = clipStart + (deltaX + deltaScroll) / pps * 1e6
//
// rect.left cancels out and is excluded for simplicity.
//
function dragGrabOffset(clientXDown: number, scrollLeftDown: number, pps: number, clipStart: number): number {
  return ((clientXDown + scrollLeftDown) / pps) * 1_000_000 - clipStart;
}

function dragProposedStart(clientXNow: number, scrollLeftNow: number, pps: number, grabOffset: number): number {
  return Math.max(0, Math.round(((clientXNow + scrollLeftNow) / pps) * 1_000_000 - grabOffset));
}

describe("clip drag grab-offset math", () => {
  describe("zoom 0.1 (pps=10)", () => {
    const pps = 10;

    it("no movement → proposedStart equals clipStart", () => {
      const clipStart = 2_000_000;
      const grabOffset = dragGrabOffset(200, 0, pps, clipStart);
      expect(dragProposedStart(200, 0, pps, grabOffset)).toBe(clipStart);
    });

    it("100px right → proposedStart = clipStart + 10_000_000µs (10s)", () => {
      const clipStart = 0;
      const grabOffset = dragGrabOffset(0, 0, pps, clipStart);
      expect(dragProposedStart(100, 0, pps, grabOffset)).toBe(10_000_000);
    });

    it("scroll changes by 50px during drag → clip moves 5_000_000µs extra", () => {
      const clipStart = 5_000_000;
      const grabOffset = dragGrabOffset(100, 0, pps, clipStart);
      // cursor stays at 100, but scrollLeft increases by 50 (auto-scroll right)
      expect(dragProposedStart(100, 50, pps, grabOffset)).toBe(clipStart + 5_000_000);
    });
  });

  describe("zoom 1.0 (pps=100)", () => {
    const pps = 100;

    it("no movement → proposedStart equals clipStart", () => {
      const clipStart = 3_000_000;
      const grabOffset = dragGrabOffset(300, 500, pps, clipStart);
      expect(dragProposedStart(300, 500, pps, grabOffset)).toBe(clipStart);
    });

    it("100px right → proposedStart = clipStart + 1_000_000µs (1s)", () => {
      const clipStart = 2_000_000;
      const grabOffset = dragGrabOffset(0, 0, pps, clipStart);
      expect(dragProposedStart(100, 0, pps, grabOffset)).toBe(clipStart + 1_000_000);
    });

    it("cursor moves left 50px → proposedStart decreases by 500_000µs (0.5s)", () => {
      const clipStart = 5_000_000;
      const grabOffset = dragGrabOffset(200, 0, pps, clipStart);
      expect(dragProposedStart(150, 0, pps, grabOffset)).toBe(clipStart - 500_000);
    });

    it("scroll changes by 200px during drag corrects position", () => {
      const clipStart = 1_000_000;
      const grabOffset = dragGrabOffset(100, 0, pps, clipStart);
      // 200px scroll change = 2_000_000µs shift
      expect(dragProposedStart(100, 200, pps, grabOffset)).toBe(clipStart + 2_000_000);
    });
  });

  describe("zoom 3.0 (pps=300)", () => {
    const pps = 300;

    it("no movement → proposedStart equals clipStart", () => {
      const clipStart = 1_500_000;
      const grabOffset = dragGrabOffset(450, 0, pps, clipStart);
      expect(dragProposedStart(450, 0, pps, grabOffset)).toBe(clipStart);
    });

    it("300px right → proposedStart = clipStart + 1_000_000µs (1s)", () => {
      const clipStart = 0;
      const grabOffset = dragGrabOffset(0, 0, pps, clipStart);
      expect(dragProposedStart(300, 0, pps, grabOffset)).toBe(1_000_000);
    });

    it("clamps to 0 when drag would produce negative startTime", () => {
      const clipStart = 500_000; // 0.5s in
      const grabOffset = dragGrabOffset(150, 0, pps, clipStart); // grabbed at clip center
      // drag 150px left of origin → proposedStart would be negative
      expect(dragProposedStart(0, 0, pps, grabOffset)).toBe(0);
    });
  });
});
