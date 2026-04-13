// lib/store/text-clip-persistence.test.ts — regression: text survives style toggles
import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal in-memory Zustand mock — we only need updateClipFxParams logic
// extracted from project-store.ts lines 373-377

type FxParams = Record<string, unknown>;

interface Clip {
  id: string;
  fxParams: FxParams;
}

function applyFxUpdate(
  clip: Clip,
  params: FxParams,
  mode: "merge" | "replace" = "replace",
): Clip {
  return {
    ...clip,
    fxParams: mode === "merge" ? { ...clip.fxParams, ...params } : params,
  };
}

describe("Text clip fxParams persistence", () => {
  const INITIAL_PARAMS: FxParams = {
    content: "Hello Synapse",
    fontSize: 48,
    x: 50,
    y: 50,
    color: "#ffffff",
    revealType: "none",
    glow: 0,
    outline: 0,
    shadow: 0,
    typewriterSpeed: 10,
    textBlur: 0,
  };

  let clip: Clip;

  beforeEach(() => {
    clip = { id: "text-1", fxParams: { ...INITIAL_PARAMS } };
  });

  it("preserves content when revealType changes with merge mode", () => {
    clip = applyFxUpdate(clip, { revealType: "typewriter" }, "merge");
    expect(clip.fxParams.content).toBe("Hello Synapse");
    expect(clip.fxParams.revealType).toBe("typewriter");
  });

  it("DESTROYS content when revealType changes with replace mode (the old bug)", () => {
    clip = applyFxUpdate(clip, { revealType: "typewriter" }, "replace");
    expect(clip.fxParams.content).toBeUndefined();
    expect(clip.fxParams.revealType).toBe("typewriter");
  });

  it("survives 10 consecutive style toggles without content loss", () => {
    const styles: [string, unknown][] = [
      ["revealType", "typewriter"],
      ["revealType", "none"],
      ["fontSize", 72],
      ["glow", 20],
      ["color", "#ff0000"],
      ["revealType", "typewriter"],
      ["shadow", 5],
      ["outline", 3],
      ["revealType", "none"],
      ["textBlur", 8],
    ];

    for (const [key, value] of styles) {
      clip = applyFxUpdate(clip, { [key]: value }, "merge");
      expect(clip.fxParams.content).toBe("Hello Synapse");
    }

    // Verify final state has all accumulated changes
    expect(clip.fxParams.revealType).toBe("none");
    expect(clip.fxParams.fontSize).toBe(72);
    expect(clip.fxParams.glow).toBe(20);
    expect(clip.fxParams.color).toBe("#ff0000");
    expect(clip.fxParams.shadow).toBe(5);
    expect(clip.fxParams.outline).toBe(3);
    expect(clip.fxParams.textBlur).toBe(8);
  });

  it("preserves all params when updating a single property", () => {
    const keys = Object.keys(INITIAL_PARAMS);
    for (const key of keys) {
      const before = { ...clip.fxParams };
      clip = applyFxUpdate(clip, { [key]: before[key] }, "merge");
      expect(Object.keys(clip.fxParams).sort()).toEqual(keys.sort());
    }
  });
});
