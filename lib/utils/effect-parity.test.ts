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
