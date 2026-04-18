import { describe, it, expect, vi, beforeEach } from "vitest";
import { mergeAndGuard } from "./use-safe-url-sync";

describe("mergeAndGuard", () => {
  it("returns null when the mutation produces no change vs current search", () => {
    const result = mergeAndGuard("?channel=anal", (p) => {
      p.set("channel", "anal");
    });
    expect(result).toBeNull();
  });

  it("returns the next search string when the mutation changes it", () => {
    const result = mergeAndGuard("?channel=anal", (p) => {
      p.set("channel", "feet");
    });
    expect(result).toBe("channel=feet");
  });

  it("preserves unrelated params the caller did not touch (merge, not overwrite)", () => {
    const result = mergeAndGuard("?v=abc123&channel=anal", (p) => {
      p.delete("channel");
    });
    expect(result).toBe("v=abc123");
  });

  it("reads the provided search verbatim — callers pass window.location.search", () => {
    const result = mergeAndGuard("?v=xyz", (p) => {
      p.set("channel", "anal");
    });
    expect(result).toContain("v=xyz");
    expect(result).toContain("channel=anal");
  });

  it("returns empty string when mutation clears all params", () => {
    const result = mergeAndGuard("?channel=anal", (p) => {
      p.delete("channel");
    });
    expect(result).toBe("");
  });
});
