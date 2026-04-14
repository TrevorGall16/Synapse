import { describe, it, expect } from "vitest";
import { EFFECTS, EFFECT_IDS, fillEffectDefaults, type EffectId } from "./effects-manifest";
import { buildFxFilter } from "./utils/preview-helpers";
import type { ClipEvent } from "./store/types";

describe("effects-manifest", () => {
  it("declares a self-consistent spec for every effect", () => {
    for (const id of EFFECT_IDS) {
      const spec = EFFECTS[id];
      expect(spec.id).toBe(id);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.outputs.length).toBeGreaterThan(0);
      // Every slider bound key must appear in defaults so Studio never shows
      // a slider whose value is literally `undefined`.
      for (const key of Object.keys(spec.params)) {
        expect(Object.prototype.hasOwnProperty.call(spec.defaults, key)).toBe(true);
      }
    }
  });

  it("fillEffectDefaults merges defaults under caller overrides without mutating input", () => {
    const input = { effectType: "hue-rotate" as const, speed: 99 };
    const out = fillEffectDefaults(input);
    expect(out.effectType).toBe("hue-rotate");
    expect(out.speed).toBe(99); // caller wins
    expect(out.hueRotate).toBe(0); // from defaults
    // Input must be untouched (referential purity — store hydration relies on this).
    expect(input).toEqual({ effectType: "hue-rotate", speed: 99 });
  });

  it("returns inputs verbatim for unknown effect types (no silent coercion)", () => {
    expect(fillEffectDefaults({ effectType: "mystery" })).toEqual({ effectType: "mystery" });
    expect(fillEffectDefaults(undefined)).toEqual({});
  });

  it("every animated effect actually produces time-varying output via buildFxFilter", () => {
    // The `animated: true` flag is a CLAIM that must be backed by the renderer —
    // if someone toggles the flag without updating buildFxFilter (or vice versa)
    // this test catches it before Theater/Studio drift.
    const animated = EFFECT_IDS.filter((id) => EFFECTS[id].animated);
    for (const id of animated) {
      const clip: ClipEvent = {
        id: "t", trackId: "e", sourceId: "", startTime: 0, duration: 10_000_000,
        mediaOffset: 0, level: 100,
        fxParams: { ...EFFECTS[id].defaults, effectType: id },
      };
      const a = buildFxFilter([clip], 0);
      const b = buildFxFilter([clip], 1_500_000);
      const serializeA = JSON.stringify(a);
      const serializeB = JSON.stringify(b);
      // For animated effects, SOME field (filter, transform, or hypnoTunnel)
      // must differ between the two frames.
      expect(serializeA, `animated effect "${id}" produced identical output across frames`).not.toBe(serializeB);
    }
  });

  it("static effects are truly stable across frames", () => {
    const staticIds = EFFECT_IDS.filter((id) => !EFFECTS[id].animated) as EffectId[];
    for (const id of staticIds) {
      const clip: ClipEvent = {
        id: "t", trackId: "e", sourceId: "", startTime: 0, duration: 10_000_000,
        mediaOffset: 0, level: 100,
        fxParams: { ...EFFECTS[id].defaults, effectType: id },
      };
      const a = buildFxFilter([clip], 0);
      const b = buildFxFilter([clip], 1_500_000);
      expect(JSON.stringify(a), `static effect "${id}" produced drifting output`).toBe(JSON.stringify(b));
    }
  });
});
