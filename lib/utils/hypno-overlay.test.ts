import { describe, it, expect } from "vitest";
import { buildHypnoOverlayStyle, ORBIT_PCT } from "./hypno-overlay";

describe("buildHypnoOverlayStyle", () => {
  it("anchors the gradient center at exactly 50/50 at elapsed=0 with default rotation", () => {
    const out = buildHypnoOverlayStyle({ fxParams: {}, elapsedSeconds: 0 });
    // tRotation default 0, elapsed 0 → angle 0 → cx = 50 + ORBIT_PCT, cy = 50.
    expect(out.cx).toBeCloseTo(50 + ORBIT_PCT, 6);
    expect(out.cy).toBeCloseTo(50, 6);
  });

  it("keeps the orbit bounded within ±ORBIT_PCT of center (no drift off-axis)", () => {
    for (let t = 0; t < 10; t += 0.1) {
      const out = buildHypnoOverlayStyle({ fxParams: { tunnelSpeed: 40 }, elapsedSeconds: t });
      expect(Math.abs(out.cx - 50)).toBeLessThanOrEqual(ORBIT_PCT + 1e-9);
      expect(Math.abs(out.cy - 50)).toBeLessThanOrEqual(ORBIT_PCT + 1e-9);
    }
  });

  it("scales opacity by clip level (levelScale)", () => {
    const full = buildHypnoOverlayStyle({ fxParams: { tunnelOpacity: 80 }, level: 100, elapsedSeconds: 0 });
    const half = buildHypnoOverlayStyle({ fxParams: { tunnelOpacity: 80 }, level: 50,  elapsedSeconds: 0 });
    expect(full.opacity).toBeCloseTo(0.8, 6);
    expect(half.opacity).toBeCloseTo(0.4, 6);
  });

  it("is deterministic — identical inputs produce identical background strings (parity source-of-truth)", () => {
    const args = { fxParams: { tunnelSpeed: 30, tunnelCount: 8, tunnelOpacity: 60, tunnelRotation: 15, intensity: 70 }, level: 85, elapsedSeconds: 2.7 };
    const a = buildHypnoOverlayStyle(args);
    const b = buildHypnoOverlayStyle(args);
    expect(a.background).toBe(b.background);
    expect(a.spacing).toBe(b.spacing);
    expect(a.ringWidth).toBe(b.ringWidth);
  });
});
