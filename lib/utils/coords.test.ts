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
    // clientX=350, rect.left=50, scrollLeft=200 → (350 - 50) / 1 + 200 = 500
    expect(screenPxToTimelinePx(350, mockRect(50), 200)).toBe(500);
  });

  it("applies zoomScale to the screen-space offset", () => {
    // clientX=350, rect.left=50, scrollLeft=200, zoomScale=2
    // → (350 - 50) / 2 + 200 = 150 + 200 = 350
    expect(screenPxToTimelinePx(350, mockRect(50), 200, 2)).toBe(350);
  });

  it("zoomScale=1 is the default and matches unscaled formula", () => {
    const result1 = screenPxToTimelinePx(500, mockRect(100), 50);
    const result2 = screenPxToTimelinePx(500, mockRect(100), 50, 1);
    expect(result1).toBe(result2);
    expect(result1).toBe(450); // (500 - 100) / 1 + 50
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

  it("CSS scaleX=2 halves the effective screen offset", () => {
    // clientX=200, rect.left=0, scrollLeft=0, pps=100, zoomScale=2
    // timelinePx = (200 - 0) / 2 + 0 = 100
    // time = 100 / 100 * 1e6 = 1_000_000µs
    expect(screenXToTimeMicros(200, mockRect(0), 0, 100, 2)).toBe(1_000_000);
  });

  it("CSS scaleX=0.5 doubles the effective screen offset", () => {
    // clientX=100, rect.left=0, scrollLeft=0, pps=100, zoomScale=0.5
    // timelinePx = (100 - 0) / 0.5 + 0 = 200
    // time = 200 / 100 * 1e6 = 2_000_000µs
    expect(screenXToTimeMicros(100, mockRect(0), 0, 100, 0.5)).toBe(2_000_000);
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
// Unified drag formula (uses screenXToTimeMicros with container rect):
//   grabOffset = screenXToTimeMicros(clientX_down, rect, scrollLeft, pps, zoomScale) - clipStart
//   proposedStart = screenXToTimeMicros(clientX_now, rect, scrollLeft, pps, zoomScale) - grabOffset
//
// This reduces to:
//   proposedStart = clipStart + ((deltaX / zoomScale) + deltaScroll) / pps * 1e6
//
// At zoomScale=1 this matches the legacy formula.
//
function dragGrabOffset(clientXDown: number, scrollLeftDown: number, pps: number, clipStart: number, rect: DOMRect = mockRect(0), zoomScale: number = 1): number {
  return screenXToTimeMicros(clientXDown, rect, scrollLeftDown, pps, zoomScale) - clipStart;
}

function dragProposedStart(clientXNow: number, scrollLeftNow: number, pps: number, grabOffset: number, rect: DOMRect = mockRect(0), zoomScale: number = 1): number {
  return Math.max(0, Math.round(screenXToTimeMicros(clientXNow, rect, scrollLeftNow, pps, zoomScale) - grabOffset));
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
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(0, 0, pps, clipStart, rect);
      expect(dragProposedStart(100, 0, pps, grabOffset, rect)).toBe(10_000_000);
    });

    it("scroll changes by 50px during drag → clip moves 5_000_000µs extra", () => {
      const clipStart = 5_000_000;
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(100, 0, pps, clipStart, rect);
      expect(dragProposedStart(100, 50, pps, grabOffset, rect)).toBe(clipStart + 5_000_000);
    });
  });

  describe("zoom 1.0 (pps=100)", () => {
    const pps = 100;

    it("no movement → proposedStart equals clipStart", () => {
      const clipStart = 3_000_000;
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(300, 500, pps, clipStart, rect);
      expect(dragProposedStart(300, 500, pps, grabOffset, rect)).toBe(clipStart);
    });

    it("100px right → proposedStart = clipStart + 1_000_000µs (1s)", () => {
      const clipStart = 2_000_000;
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(0, 0, pps, clipStart, rect);
      expect(dragProposedStart(100, 0, pps, grabOffset, rect)).toBe(clipStart + 1_000_000);
    });

    it("cursor moves left 50px → proposedStart decreases by 500_000µs (0.5s)", () => {
      const clipStart = 5_000_000;
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(200, 0, pps, clipStart, rect);
      expect(dragProposedStart(150, 0, pps, grabOffset, rect)).toBe(clipStart - 500_000);
    });

    it("scroll changes by 200px during drag corrects position", () => {
      const clipStart = 1_000_000;
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(100, 0, pps, clipStart, rect);
      expect(dragProposedStart(100, 200, pps, grabOffset, rect)).toBe(clipStart + 2_000_000);
    });
  });

  describe("zoom 3.0 (pps=300)", () => {
    const pps = 300;

    it("no movement → proposedStart equals clipStart", () => {
      const clipStart = 1_500_000;
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(450, 0, pps, clipStart, rect);
      expect(dragProposedStart(450, 0, pps, grabOffset, rect)).toBe(clipStart);
    });

    it("300px right → proposedStart = clipStart + 1_000_000µs (1s)", () => {
      const clipStart = 0;
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(0, 0, pps, clipStart, rect);
      expect(dragProposedStart(300, 0, pps, grabOffset, rect)).toBe(1_000_000);
    });

    it("clamps to 0 when drag would produce negative startTime", () => {
      const clipStart = 500_000;
      const rect = mockRect(0);
      const grabOffset = dragGrabOffset(150, 0, pps, clipStart, rect);
      expect(dragProposedStart(0, 0, pps, grabOffset, rect)).toBe(0);
    });
  });

  describe("with CSS scaleX (zoomScale != 1)", () => {
    it("zoomScale=2 at pps=100: 100px screen delta → 500_000µs (half normal)", () => {
      const clipStart = 0;
      const rect = mockRect(0);
      const pps = 100;
      const zs = 2;
      const grabOffset = dragGrabOffset(0, 0, pps, clipStart, rect, zs);
      // 100 screen px / zoomScale(2) = 50 timeline px → 50/100 * 1e6 = 500_000µs
      expect(dragProposedStart(100, 0, pps, grabOffset, rect, zs)).toBe(500_000);
    });

    it("zoomScale=0.5 at pps=100: 100px screen delta → 2_000_000µs (double normal)", () => {
      const clipStart = 0;
      const rect = mockRect(0);
      const pps = 100;
      const zs = 0.5;
      const grabOffset = dragGrabOffset(0, 0, pps, clipStart, rect, zs);
      expect(dragProposedStart(100, 0, pps, grabOffset, rect, zs)).toBe(2_000_000);
    });

    it("no-movement invariant holds under zoomScale=3", () => {
      const clipStart = 5_000_000;
      const rect = mockRect(200);
      const pps = 100;
      const zs = 3;
      const grabOffset = dragGrabOffset(500, 100, pps, clipStart, rect, zs);
      expect(dragProposedStart(500, 100, pps, grabOffset, rect, zs)).toBe(clipStart);
    });

    it("container rect.left offsets cancel in grab-offset delta", () => {
      const clipStart = 1_000_000;
      const rect = mockRect(250); // container starts at x=250
      const pps = 100;
      const zs = 1.5;
      const grabOffset = dragGrabOffset(350, 0, pps, clipStart, rect, zs);
      // Move 150px right: (150 / 1.5) / 100 * 1e6 = 1_000_000µs
      expect(dragProposedStart(500, 0, pps, grabOffset, rect, zs)).toBe(clipStart + 1_000_000);
    });
  });
});
