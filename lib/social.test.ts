import { describe, it, expect } from "vitest";

// ──────────────────────────────────────────────────────────────
// Heat Tier pipeline — Spec 1 Foundation
// ──────────────────────────────────────────────────────────────
import {
  computeHeatThresholds,
  tierFor,
  enrichWithHeatTiers,
  type HeatTier,
  type HeatThresholds,
} from "./social";
import type { FeedPost } from "./store/feed-store";

// Shared post factory — mock enough to pass getVelocityScore.
function mockPost(overrides: Partial<FeedPost> & { id: string; hoursOld: number; likes: number; comments?: number }): FeedPost {
  const now = 1_700_000_000_000; // fixed
  return {
    id: overrides.id,
    user: { handle: "u", initial: "U", hue: 0 },
    title: "t",
    tags: [],
    bg: "#000",
    accent: "#fff",
    duration: "0:10",
    likes: overrides.likes,
    comments: overrides.comments ?? 0,
    featured: false,
    createdAt: now - overrides.hoursOld * 3_600_000,
    ...overrides,
  };
}
const FIXED_NOW = 1_700_000_000_000;

describe("computeHeatThresholds", () => {
  it("returns Infinity cuts for an empty pool", () => {
    const t = computeHeatThresholds([], FIXED_NOW);
    expect(t.warm).toBe(Infinity);
    expect(t.hot).toBe(Infinity);
    expect(t.trending).toBe(Infinity);
  });

  it("respects absolute floors for a tiny pool", () => {
    const pool = [mockPost({ id: "1", hoursOld: 4, likes: 5 })];
    const t = computeHeatThresholds(pool, FIXED_NOW);
    expect(t.warm).toBeGreaterThanOrEqual(5);       // FLOOR_WARM
    expect(t.hot).toBeGreaterThanOrEqual(20);       // FLOOR_HOT
    expect(t.trending).toBeGreaterThanOrEqual(50);  // FLOOR_TRENDING
  });
});

describe("tierFor", () => {
  const t: HeatThresholds = { warm: 10, hot: 50, trending: 200 };

  it("returns undefined below warm", () => {
    expect(tierFor(9, t)).toBeUndefined();
  });
  it("returns 'warm' at the warm threshold", () => {
    expect(tierFor(10, t)).toBe("warm");
  });
  it("returns 'warm' just below hot", () => {
    expect(tierFor(49, t)).toBe("warm");
  });
  it("returns 'hot' at the hot threshold", () => {
    expect(tierFor(50, t)).toBe("hot");
  });
  it("returns 'trending' at the trending threshold", () => {
    expect(tierFor(200, t)).toBe("trending");
  });
  it("returns 'trending' above", () => {
    expect(tierFor(999, t)).toBe("trending");
  });
});

describe("enrichWithHeatTiers", () => {
  it("is deterministic for the same input + now", () => {
    const pool = [
      mockPost({ id: "a", hoursOld: 4, likes: 200 }),
      mockPost({ id: "b", hoursOld: 4, likes: 40 }),
      mockPost({ id: "c", hoursOld: 4, likes: 5 }),
    ];
    const out1 = enrichWithHeatTiers(pool, FIXED_NOW);
    const out2 = enrichWithHeatTiers(pool, FIXED_NOW);
    expect(out1.map((p) => p.heatTier)).toEqual(out2.map((p) => p.heatTier));
  });

  it("assigns undefined heatTier to posts below the warm floor", () => {
    const pool = [
      mockPost({ id: "hot",  hoursOld: 4, likes: 300 }),
      mockPost({ id: "cold", hoursOld: 4, likes: 2 }),
    ];
    const out = enrichWithHeatTiers(pool, FIXED_NOW);
    expect(out.find((p) => p.id === "cold")?.heatTier).toBeUndefined();
  });

  it("never returns a tier when the pool is too cold even at percentile", () => {
    const pool = [
      mockPost({ id: "1", hoursOld: 4, likes: 3 }),
      mockPost({ id: "2", hoursOld: 4, likes: 2 }),
      mockPost({ id: "3", hoursOld: 4, likes: 1 }),
    ];
    const out = enrichWithHeatTiers(pool, FIXED_NOW);
    expect(out.every((p) => p.heatTier === undefined)).toBe(true);
  });

  it("is immutable — returns new array, never mutates input", () => {
    const pool = [mockPost({ id: "x", hoursOld: 4, likes: 300 })];
    const frozen = Object.freeze([...pool]);
    expect(() => enrichWithHeatTiers(frozen, FIXED_NOW)).not.toThrow();
  });

  it("guards against divide-by-zero for brand-new uploads", () => {
    const pool = [
      mockPost({ id: "fresh",   hoursOld: 0, likes: 10_000 }),
      mockPost({ id: "1s-old",  hoursOld: 1 / 3600, likes: 10_000 }),
    ];
    const out = enrichWithHeatTiers(pool, FIXED_NOW);
    for (const p of out) {
      if (p.heatTier !== undefined) {
        expect(["warm", "hot", "trending"] as HeatTier[]).toContain(p.heatTier);
      }
    }
  });

  it("does not attach tier to already-enriched posts when called twice", () => {
    const pool = [mockPost({ id: "a", hoursOld: 4, likes: 300 })];
    const once  = enrichWithHeatTiers(pool, FIXED_NOW);
    const twice = enrichWithHeatTiers(once, FIXED_NOW);
    expect(twice[0].heatTier).toBe(once[0].heatTier);
  });
});
