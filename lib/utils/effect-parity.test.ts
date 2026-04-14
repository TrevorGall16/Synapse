import { describe, it, expect } from "vitest";
import { buildFxFilter } from "./preview-helpers";
import type { ClipEvent } from "@/lib/store/types";

/**
 * LOCK: Studio/Theater effect parity.
 *
 * Studio's PreviewMonitor and the Theater tick loop MUST render effects using
 * the same pure `buildFxFilter(clips, playheadPosition)` helper. This file
 * pins its contract for the five representative effects in the acceptance
 * criteria — Hue Rotate, Hypno-Tunnel, Blur, Glitch, Strobe — plus a static
 * hue check so both "animated" and "static" code paths are covered.
 *
 * If either side starts doing its own CSS math, these assertions fail and
 * surface the drift before users do.
 */

function fxClip(overrides: Partial<ClipEvent> & { fxParams: Record<string, unknown> }): ClipEvent {
  return {
    id: "fx1",
    trackId: "efx",
    sourceId: "",
    startTime: 0,
    duration: 10_000_000,
    mediaOffset: 0,
    level: 100,
    ...overrides,
  };
}

describe("buildFxFilter — deterministic 5-effect parity fixture", () => {
  it("Hue Rotate (animated by speed) rotates measurably from t=0 to t=2s", () => {
    const c = fxClip({
      fxParams: { effectType: "hue-rotate", speed: 60, intensity: 50, hueRotate: 0 },
    });
    const t0 = buildFxFilter([c], 0);
    const t2 = buildFxFilter([c], 2_000_000);
    const match0 = /hue-rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(t0.filter);
    const match2 = /hue-rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(t2.filter);
    expect(match0).not.toBeNull();
    expect(match2).not.toBeNull();
    // Speed drives animation — must change between frames.
    expect(match0![1]).not.toBe(match2![1]);
    // At speed=60 × intensity=0.5 → 108 deg/sec → ~216° after 2s (mod 360).
    expect(Number(match2![1])).toBeCloseTo(216, 0);
  });

  it("Hue Rotate (static degrees, speed=0) matches the hueRotate param exactly", () => {
    // A preset may ship hueRotate as a static CC adjustment. This variant must
    // survive publish without drift — the value shows up verbatim in filter.
    const c = fxClip({
      fxParams: { effectType: "hue-rotate", speed: 0, intensity: 0, hueRotate: 45 },
    });
    const r = buildFxFilter([c], 1_500_000);
    expect(r.filter).toContain("hue-rotate(0deg)"); // animated term zeroes out
    // The static CC branch also emits its own hue-rotate with the explicit degrees.
    expect(r.filter).toMatch(/hue-rotate\(45deg\)/);
  });

  it("Hypno-Tunnel produces a hypnoTunnel.background gradient (not a filter) and no transform", () => {
    const c = fxClip({
      fxParams: {
        effectType: "hypno-tunnel",
        intensity: 70, speed: 40,
        tunnelColor: "#ff00ff", tunnelSpacing: 30, tunnelRotation: 90,
      },
    });
    const r = buildFxFilter([c], 1_000_000);
    expect(r.hypnoTunnel).toBeDefined();
    expect(r.hypnoTunnel!.background).toMatch(/radial-gradient/);
    // Hypno is the whole effect — no mirror/glitch/pixelate transforms piggyback.
    expect(r.glitchTransform).toBeUndefined();
    expect(r.mirrorTransform).toBeUndefined();
  });

  it("Blur emits filter: blur(Npx) scaled by level", () => {
    const c = fxClip({
      level: 80,
      fxParams: { effectType: "blur", blurAmount: 10, intensity: 50 },
    });
    const r = buildFxFilter([c], 0);
    // level=80 → 10 * 0.8 = 8px
    expect(r.filter).toContain("blur(8px)");
  });

  it("Glitch emits glitchTransform (translateX) seeded by playhead — same seed ⇒ same shift", () => {
    const c = fxClip({
      fxParams: { effectType: "glitch", displacement: 30, speed: 50, intensity: 60 },
    });
    const a = buildFxFilter([c], 1_000_000);
    const b = buildFxFilter([c], 1_000_000);
    const c2 = buildFxFilter([c], 1_100_000);
    expect(a.glitchTransform).toBeDefined();
    expect(a.glitchTransform).toMatch(/^translateX\(-?\d+(?:\.\d+)?px\)$/);
    // Deterministic: same playhead ⇒ identical output (studio/theater parity depends on this).
    expect(a.glitchTransform).toBe(b.glitchTransform);
    // Different playhead ⇒ different bucket ⇒ (almost certainly) different shift.
    expect(a.glitchTransform).not.toBe(c2.glitchTransform);
  });

  it("Strobe emits filter: brightness(...) flipping between on-phase and off-phase", () => {
    const c = fxClip({
      fxParams: {
        effectType: "strobe", speed: 50, intensity: 60, strobeDutyCycle: 50,
      },
    });
    // speed=50 → 5 Hz → 200ms period → 100ms on-phase, 100ms off-phase.
    const onPhase = buildFxFilter([c], 50_000);    // 0.05s — within on-phase
    const offPhase = buildFxFilter([c], 150_000);  // 0.15s — within off-phase
    expect(onPhase.filter).toMatch(/brightness\(\d+(?:\.\d+)?\)/);
    expect(offPhase.filter).toContain("brightness(0)");
    expect(onPhase.filter).not.toBe(offPhase.filter);
  });

  it("Determinism: same input ⇒ byte-identical output (Studio↔Theater byte parity)", () => {
    // Both sides call buildFxFilter with the same signature. If output ever
    // diverges for identical input, Studio and Theater will show different
    // effects — by construction this must not happen.
    const clips: ClipEvent[] = [
      fxClip({ id: "h", fxParams: { effectType: "hue-rotate", speed: 30, intensity: 70, hueRotate: 10 } }),
    ];
    const a = buildFxFilter(clips, 777_777);
    const b = buildFxFilter(clips, 777_777);
    expect(a).toEqual(b);
  });
});

describe("multi-effect stacking — Hue + Blur + Glitch + Strobe on one clip", () => {
  /**
   * LOCK: published posts must render the full effect chain, not just the first.
   * Regression root cause: Theater used `.find()` to pick a single active effect,
   * so a stack of 4 effects rendered as 1. This test pins the contract that
   * `buildFxFilter` composes EVERY active effect into one FxResult.
   */
  const baseRange = { startTime: 0, duration: 10_000_000, mediaOffset: 0, level: 100 };
  const clips: ClipEvent[] = [
    fxClip({ id: "h", trackId: "fx1", ...baseRange,
      fxParams: { effectType: "hue-rotate", speed: 60, intensity: 50, hueRotate: 0 } }),
    fxClip({ id: "b", trackId: "fx2", ...baseRange,
      fxParams: { effectType: "blur", blurAmount: 6, intensity: 50 } }),
    fxClip({ id: "g", trackId: "fx3", ...baseRange,
      fxParams: { effectType: "glitch", displacement: 30, speed: 50, intensity: 60 } }),
    fxClip({ id: "s", trackId: "fx4", ...baseRange,
      fxParams: { effectType: "strobe", speed: 50, intensity: 60, strobeDutyCycle: 50 } }),
  ];

  it("filter string contains hue-rotate, blur, and a brightness term from the stack", () => {
    const r = buildFxFilter(clips, 1_000_000);
    expect(r.filter).not.toBe("none");
    expect(r.filter).toMatch(/hue-rotate\(-?\d+(?:\.\d+)?deg\)/);
    expect(r.filter).toMatch(/blur\(\d+(?:\.\d+)?px\)/);
    // Strobe always emits brightness(...) (on-phase or brightness(0)); glitch may
    // also add one. At least one brightness term MUST be present — asserting
    // "first match wins" would have failed here and surfaces the regression.
    expect(r.filter).toMatch(/brightness\(/);
  });

  it("glitchTransform is populated alongside the filter chain (transform + filter coexist)", () => {
    const r = buildFxFilter(clips, 1_000_000);
    expect(r.glitchTransform).toBeDefined();
    expect(r.glitchTransform).toMatch(/^translateX\(-?\d+(?:\.\d+)?px\)$/);
  });

  it("hue-rotate still animates within the 4-effect stack (speed-driven term changes across frames)", () => {
    // If earlier effects short-circuited the loop, the hue term would be frozen.
    // Pin the full-chain contract: hue-rotate's animated degrees value changes
    // between frames even with three other effects stacked on top.
    const a = buildFxFilter(clips, 0);
    const b = buildFxFilter(clips, 2_000_000);
    const hueA = /hue-rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(a.filter)?.[1];
    const hueB = /hue-rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(b.filter)?.[1];
    expect(hueA).toBeDefined();
    expect(hueB).toBeDefined();
    expect(hueA).not.toBe(hueB);
  });

  it("dropping hue, blur, or strobe each shrinks the filter chain; dropping glitch drops glitchTransform", () => {
    // The stack is additive. Each clip must contribute, else we'd regress back to
    // "first-match wins" silently. Glitch's `filter` contribution is probabilistic
    // (flicker fires ~30% of the time), so we assert its transform instead.
    const full = buildFxFilter(clips, 1_000_000);
    const dropHue = buildFxFilter([clips[1], clips[2], clips[3]], 1_000_000);
    const dropBlur = buildFxFilter([clips[0], clips[2], clips[3]], 1_000_000);
    const dropStrobe = buildFxFilter([clips[0], clips[1], clips[2]], 1_000_000);
    const dropGlitch = buildFxFilter([clips[0], clips[1], clips[3]], 1_000_000);
    expect(dropHue.filter.length).toBeLessThan(full.filter.length);
    expect(dropBlur.filter.length).toBeLessThan(full.filter.length);
    expect(dropStrobe.filter.length).toBeLessThan(full.filter.length);
    expect(dropGlitch.glitchTransform).toBeUndefined();
    expect(full.glitchTransform).toBeDefined();
  });
});

describe("publish → playback payload preservation", () => {
  it("a hue-rotate clip with fxParams survives a JSON snapshot round-trip (no fxParams loss)", () => {
    // Snapshots go through IDB as JSON (Synapse .5MB cap) — must not mutate
    // fxParams via JSON.stringify/parse. This is the core of the "effect
    // visible in Studio, missing in Theater" bug class.
    const clip: ClipEvent = fxClip({
      fxParams: { effectType: "hue-rotate", speed: 45, intensity: 60, hueRotate: 12 },
    });
    const roundTripped = JSON.parse(JSON.stringify(clip)) as ClipEvent;
    expect(roundTripped.fxParams).toEqual(clip.fxParams);
    // And rendering through buildFxFilter after the round-trip matches pre-round-trip.
    const before = buildFxFilter([clip], 500_000);
    const after = buildFxFilter([roundTripped], 500_000);
    expect(after.filter).toBe(before.filter);
  });
});
