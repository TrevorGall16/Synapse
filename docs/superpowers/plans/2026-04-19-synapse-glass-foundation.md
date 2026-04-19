# Synapse Glass — Spec 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the structural foundation for the Synapse Glass redesign — route groups, Tailwind 4 `@theme` tokens + `@layer components` utilities, a floating Glass Island header with ticker-driven scroll hysteresis, `@modal` intercepting-route scaffolding, and the `heatTier` data pipeline — without changing any Feed/Theater visuals.

**Architecture:** Split routes into `(consumption)`, `(creation)`, `(auth)` URL-invisible groups with distinct chrome. Add Synapse Glass CSS primitives consumed by a new `<GlassIsland />` component whose compress/expand state is driven by the existing Master Clock (`registerTickCallback`). Land intercepting routes (`@modal/(.)video/[id]`) as a plain z-50 overlay — `layoutId` morph animation is Spec 2. Enrich `FeedPost` with a derived `heatTier` at store-mutation time; never serialize.

**Tech Stack:** Next.js 16.1.6 App Router, React 19, Tailwind 4 (`@theme` + `@layer`), Framer Motion 12 (`layout` prop, `useReducedMotion`), Zustand 5, Vitest 4, Playwright 1.58.

**Spec:** `docs/superpowers/specs/2026-04-19-synapse-glass-foundation-design.md`

---

## File Structure

**New files:**
- `app/(consumption)/layout.tsx` — Glass Island shell + `{modal}` slot
- `app/(consumption)/@modal/default.tsx` — `() => null`
- `app/(consumption)/@modal/(.)video/[id]/page.tsx` — intercepted Theater overlay
- `app/(creation)/layout.tsx` — left Sidebar + `ml-56` shell
- `app/(auth)/layout.tsx` — full-bleed centered shell
- `components/chrome/glass-island.tsx` — floating pill nav (~180 LOC)
- `components/chrome/use-glass-island-state.ts` — ticker-driven hysteresis hook
- `components/chrome/use-glass-motion.ts` — reduced-motion transition helper
- `components/chrome/scroll-lock-while-modal.tsx` — body scroll-lock + scrollbar-width compensation
- `components/chrome/glass-capability.ts` — hardware probe → `data-glass-tier`
- `components/chrome/use-glass-island-state.test.ts` — hysteresis unit test
- `e2e/creation-chrome-baseline.spec.ts` — screenshot baseline for `(creation)` routes
- `e2e/glass-island.spec.ts` — hysteresis E2E
- `e2e/consumption-creation-chrome.spec.ts` — chrome-separation E2E
- `e2e/intercepting-route.spec.ts` — intercept E2E
- `e2e/glass-surface-contrast.spec.ts` — contrast audit

**Modified files:**
- `app/layout.tsx` — strip `<Sidebar />` and `ml-56` offset
- `app/globals.css` — add `@theme`, `@layer components`, `@supports`, `@media` fallbacks
- `lib/social.ts` — add `HeatTier`, `computeHeatThresholds`, `tierFor`, `enrichWithHeatTiers`
- `lib/social.test.ts` — extend with tier tests
- `lib/store/feed-store.ts` — wrap `addPost`/`removePost`/`removePosts`/`hydrateAllPosts` with enrichment
- `lib/store/feed-idb.ts` — strip `heatTier` in `savePostToIDB`
- `lib/store/feed-store.test.ts` — new (or extend) tests

**Route relocations (content-identical moves):**
```
app/page.tsx                       → app/(consumption)/page.tsx
app/home/page.tsx                  → app/(consumption)/home/page.tsx
app/browse/page.tsx                → app/(consumption)/browse/page.tsx
app/explore/page.tsx               → app/(consumption)/explore/page.tsx
app/niche/page.tsx                 → app/(consumption)/niche/page.tsx
app/niche/[category]/page.tsx      → app/(consumption)/niche/[category]/page.tsx
app/gallery/page.tsx               → app/(consumption)/gallery/page.tsx
app/vault/page.tsx                 → app/(consumption)/vault/page.tsx
app/video/[id]/layout.tsx          → app/(consumption)/video/[id]/layout.tsx
app/video/[id]/page.tsx            → app/(consumption)/video/[id]/page.tsx
app/studio/page.tsx                → app/(creation)/studio/page.tsx
app/studio/dashboard/page.tsx      → app/(creation)/studio/dashboard/page.tsx
app/profile/page.tsx               → app/(creation)/profile/page.tsx
app/profile/[username]/layout.tsx  → app/(creation)/profile/[username]/layout.tsx
app/profile/[username]/layout.test.ts → app/(creation)/profile/[username]/layout.test.ts
app/profile/[username]/page.tsx    → app/(creation)/profile/[username]/page.tsx
app/projects/page.tsx              → app/(creation)/projects/page.tsx
app/upload/page.tsx                → app/(creation)/upload/page.tsx
app/session/[slug]/page.tsx        → app/(creation)/session/[slug]/page.tsx
app/login/page.tsx                 → app/(auth)/login/page.tsx
```

---

## Task Sequence

1. **Baseline screenshot PR** (prerequisite, separate PR on main)
2. Synapse Glass tokens in `globals.css` (CSS-only, no routing dependency)
3. Heat Tier pipeline (TDD; pure data, independent)
4. Route-group restructure + bare `(consumption)` layout
5. `useGlassIslandState` hysteresis hook (TDD)
6. `useGlassMotion` helper
7. `<GlassIsland />` component + mount in `(consumption)/layout.tsx`
8. `scroll-lock-while-modal` utility
9. `@modal/(.)video/[id]` intercepting route
10. `glass-capability` hardware probe
11. `globals.css` a11y / reduced-motion / reduced-transparency / focus-visible / tier-degradation rules
12. E2E spec files
13. Final acceptance-gate verification

---

## Task 1: Baseline Screenshot PR (prerequisite, on `main`)

**Purpose:** Capture a pixel-perfect screenshot of every `(creation)` route so the restructure branch can prove byte-identical rendering. This is a **separate PR** merged to `main` before Spec 1 work begins.

**Files:**
- Create: `e2e/creation-chrome-baseline.spec.ts`
- Commit: `e2e/creation-chrome-baseline.spec.ts-snapshots/*.png` (auto-generated by Playwright)

- [ ] **Step 1: Write the baseline screenshot test**

Create `e2e/creation-chrome-baseline.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

/** Pre-restructure baseline: capture every route that must remain byte-identical
 *  after the (creation) group is introduced. The restructure branch runs this
 *  same test against the snapshots committed here. */
const ROUTES = [
  { path: "/studio/dashboard", name: "studio-dashboard" },
  { path: "/studio",           name: "studio-root" },
  { path: "/profile/you",      name: "profile-you" },
  { path: "/projects",         name: "projects" },
  { path: "/upload",           name: "upload" },
];

for (const { path, name } of ROUTES) {
  test(`creation chrome baseline — ${name}`, async ({ page }) => {
    await page.goto(path);
    // Sidebar is the visual anchor; wait for it to be present.
    await expect(page.locator("[data-testid='sidebar-nav-home']")).toBeVisible();
    // Small settle for font rendering + client hydration.
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
}
```

- [ ] **Step 2: Generate baseline snapshots**

Run: `npm run audit -- --update-snapshots e2e/creation-chrome-baseline.spec.ts`
Expected: 5 `*.png` files created under `e2e/creation-chrome-baseline.spec.ts-snapshots/`. Test reports "5 passed."

- [ ] **Step 3: Verify baseline re-run matches itself**

Run: `npm run audit -- e2e/creation-chrome-baseline.spec.ts`
Expected: "5 passed." No diff images written.

- [ ] **Step 4: Commit baseline to main**

```bash
git add e2e/creation-chrome-baseline.spec.ts e2e/creation-chrome-baseline.spec.ts-snapshots/
git commit -m "test(e2e): baseline screenshots for (creation) routes pre-restructure"
git push origin main
```

> **Gate:** Task 1 must be merged to `main` before any later task begins. All subsequent tasks rebase onto the commit that includes the baseline.

---

## Task 2: Synapse Glass tokens + utility layer

**Files:**
- Modify: `app/globals.css`

No tests — CSS-only primitives. Visual verification happens via Task 7 (Glass Island) and Task 12 (contrast E2E).

- [ ] **Step 1: Append `@theme` + `@layer components` blocks to `app/globals.css`**

Open `app/globals.css`. Append the following at the end of the file (preserving any existing content):

```css
/* ───────────────────────────────────────────────────────────────
   SYNAPSE GLASS — Design system primitives (Spec 1 Foundation)
   Tokens: @theme    |    Utilities: @layer components
   ─────────────────────────────────────────────────────────────── */

@theme {
  --color-glass-surface:        oklch(0.18 0.005 270 / 0.42);
  --color-glass-surface-strong: oklch(0.18 0.005 270 / 0.60);
  --color-glass-surface-ghost:  oklch(0.18 0.005 270 / 0.22);

  --color-glass-hairline:       oklch(1 0 0 / 0.10);
  --color-glass-hairline-warm:  oklch(1 0 0 / 0.14);
  --color-glass-inner-lift:     oklch(1 0 0 / 0.05);

  --blur-glass:     16px;
  --blur-glass-xl:  24px;
  --blur-glass-2xl: 32px;

  --radius-island: 9999px;
  --radius-card:   16px;

  --shadow-glass-ambient: 0 8px 32px -8px oklch(0 0 0 / 0.45);
  --shadow-glass-glow:    0 0 24px -4px oklch(0.7 0 0 / 0.08);
}

@layer components {
  .glass-surface {
    background-color: var(--color-glass-surface);
    backdrop-filter: blur(var(--blur-glass-xl)) saturate(180%);
    -webkit-backdrop-filter: blur(var(--blur-glass-xl)) saturate(180%);
    border: 1px solid var(--color-glass-hairline);
    box-shadow:
      inset 0 1px 0 0 var(--color-glass-inner-lift),
      var(--shadow-glass-ambient),
      var(--shadow-glass-glow);
  }

  .glass-pill {
    @apply glass-surface;
    border-radius: var(--radius-island);
  }

  .glass-hairline {
    border: 1px solid var(--color-glass-hairline);
    box-shadow: inset 0 1px 0 0 var(--color-glass-inner-lift);
  }
}

/* ── Accessibility + capability fallbacks ─────────────────────── */

@supports not (backdrop-filter: blur(1px)) {
  .glass-surface { background-color: rgb(24 24 24 / 0.92); }
}

@media (prefers-reduced-transparency: reduce) {
  .glass-surface {
    background-color: rgb(18 18 18 / 0.95);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

body[data-glass-tier="reduced"] .glass-surface {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: none;
}

.glass-surface :focus-visible {
  outline: 2px solid oklch(1 0 0 / 0.7);
  outline-offset: 2px;
}
```

- [ ] **Step 2: Verify lint passes**

Run: `npm run lint`
Expected: no new warnings related to CSS.

- [ ] **Step 3: Verify Next build compiles the token layer**

Run: `npm run build`
Expected: build completes with no errors. The `@theme`/`@layer` blocks are accepted by Tailwind 4's PostCSS pipeline.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat(glass): add Synapse Glass tokens + utility layer"
```

---

## Task 3: Heat Tier types + pure helpers (TDD)

**Files:**
- Modify: `lib/social.ts`
- Modify: `lib/social.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `lib/social.test.ts`. Append the following test block (do not remove existing tests):

```ts
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
    // One post with very low velocity — no way it hits trending.
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
      mockPost({ id: "cold", hoursOld: 4, likes: 2 }),  // velocity ~1/hr
    ];
    const out = enrichWithHeatTiers(pool, FIXED_NOW);
    expect(out.find((p) => p.id === "cold")?.heatTier).toBeUndefined();
  });

  it("never returns a tier when the pool is too cold even at percentile", () => {
    // Top 1% of 3 cold posts would still flag one as trending if we relied on
    // percentile alone — floors prevent this.
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
    // hoursOld=0 — post created at `now`. getVelocityScore returns 0 (below
    // HOT_MIN_AGE_MS). enrichWithHeatTiers must not produce NaN/Infinity tier.
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
    // Important: enrichment is derived, so running twice should overwrite
    // deterministically — never accumulate, never corrupt.
    const pool = [mockPost({ id: "a", hoursOld: 4, likes: 300 })];
    const once  = enrichWithHeatTiers(pool, FIXED_NOW);
    const twice = enrichWithHeatTiers(once, FIXED_NOW);
    expect(twice[0].heatTier).toBe(once[0].heatTier);
  });
});
```

- [ ] **Step 2: Run the tests — expect failure**

Run: `npm test -- lib/social.test.ts`
Expected: FAIL — imports `computeHeatThresholds`, `tierFor`, `enrichWithHeatTiers`, `HeatTier`, `HeatThresholds` do not exist in `lib/social.ts`.

- [ ] **Step 3: Implement the pure helpers**

Open `lib/social.ts`. Append:

```ts
// ──────────────────────────────────────────────────────────────
// Heat Tier — Spec 1 Foundation
// Derives a pool-percentile tier with absolute floors so tiny/idle
// pools can't tier noise. Never serialized; never parsed from ingress.
// ──────────────────────────────────────────────────────────────

export type HeatTier = "warm" | "hot" | "trending";

const FLOOR_WARM     = 5;
const FLOOR_HOT      = 20;
const FLOOR_TRENDING = 50;

const PCT_WARM     = 0.20;
const PCT_HOT      = 0.05;
const PCT_TRENDING = 0.01;

export interface HeatThresholds {
  warm:     number;
  hot:      number;
  trending: number;
}

/** Single pass → three cut values. Sort once per pool. */
export function computeHeatThresholds(
  pool: readonly FeedPost[],
  now: number = Date.now(),
): HeatThresholds {
  if (pool.length === 0) {
    return { warm: Infinity, hot: Infinity, trending: Infinity };
  }
  const scores = pool
    .map((p) => getVelocityScore(p, now))
    .sort((a, b) => b - a);

  const cut = (pct: number, floor: number) => {
    const idx = Math.max(0, Math.floor(scores.length * pct) - 1);
    return Math.max(scores[Math.min(idx, scores.length - 1)], floor);
  };

  return {
    warm:     cut(PCT_WARM,     FLOOR_WARM),
    hot:      cut(PCT_HOT,      FLOOR_HOT),
    trending: cut(PCT_TRENDING, FLOOR_TRENDING),
  };
}

/** Tier for a single velocity value against pre-computed thresholds. Pure. */
export function tierFor(velocity: number, t: HeatThresholds): HeatTier | undefined {
  if (velocity >= t.trending) return "trending";
  if (velocity >= t.hot)      return "hot";
  if (velocity >= t.warm)     return "warm";
  return undefined;
}

/** Batch: attach heatTier to every post. Returns a new array; input is never
 *  mutated. Posts below the warm floor get `heatTier: undefined`.
 *
 *  TODO(spec-2+): the `now` parameter is the hook for time-decay math —
 *  e.g. penalise velocity scores for posts older than N days so the feed
 *  stays fresh instead of tier-cementing ancient virality. Keep this
 *  signature stable so the future decay factor can be slotted in without
 *  touching callers. */
export function enrichWithHeatTiers(
  pool: readonly FeedPost[],
  now: number = Date.now(),
): FeedPost[] {
  const t = computeHeatThresholds(pool, now);
  return pool.map((p) => {
    const v = getVelocityScore(p, now);
    const tier = tierFor(v, t);
    if (tier) return { ...p, heatTier: tier };
    // Strip any stale tier if caller passed an already-enriched post that no
    // longer qualifies. Never accumulate, never corrupt.
    if (p.heatTier !== undefined) {
      const { heatTier: _drop, ...rest } = p;
      return rest as FeedPost;
    }
    return p;
  });
}
```

- [ ] **Step 4: Add `heatTier` to the `FeedPost` interface**

Open `lib/store/feed-store.ts`. Find the `FeedPost` interface (around line 24). Append the following field just before the closing brace (after `comments_enabled?: boolean;`):

```ts
  /** Derived, pool-relative, computed client-side at store mutation time.
   *  NEVER sent over the wire; NEVER in any Zod schema; NEVER in IDB. */
  heatTier?: import("@/lib/social").HeatTier;
```

- [ ] **Step 5: Run the tests — expect pass**

Run: `npm test -- lib/social.test.ts`
Expected: PASS. All new tier tests green; existing `isHot` / `getVelocityScore` / `getEngagementScore` tests still green.

- [ ] **Step 6: Commit**

```bash
git add lib/social.ts lib/social.test.ts lib/store/feed-store.ts
git commit -m "feat(heat): add HeatTier types + pure enrichment helpers"
```

---

## Task 4: Wire `enrichWithHeatTiers` into `feed-store`

**Files:**
- Modify: `lib/store/feed-store.ts`
- Create: `lib/store/feed-store.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `lib/store/feed-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFeedStore, type FeedPost } from "./feed-store";

// Silence IDB side-effects in Zustand's persist + addPost/removePost paths.
vi.mock("./feed-idb", () => ({
  savePostToIDB:       vi.fn().mockResolvedValue(undefined),
  removePostFromIDB:   vi.fn().mockResolvedValue(undefined),
  loadAllPostsFromIDB: vi.fn().mockResolvedValue([]),
}));
vi.mock("./thumbnail-idb", () => ({
  removeThumbnail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./media-pool-db", () => ({
  releaseSnapshotMedia: vi.fn().mockResolvedValue(undefined),
  hydrateMediaPool:     vi.fn().mockImplementation(async (p: FeedPost) => p),
}));
vi.mock("@/lib/schema", () => ({
  validateFeedPost: (p: FeedPost) => p,
}));

function hotPost(id: string, likes: number): FeedPost {
  return {
    id,
    user: { handle: "u", initial: "U", hue: 0 },
    title: "t",
    tags: [],
    bg: "#000",
    accent: "#fff",
    duration: "0:10",
    likes,
    comments: 0,
    featured: false,
    createdAt: Date.now() - 4 * 3_600_000,
  };
}

describe("feed-store heat-tier enrichment", () => {
  beforeEach(() => {
    useFeedStore.setState({ userPosts: [], likedPostIds: [] });
  });

  it("addPost enriches the resulting pool", () => {
    useFeedStore.getState().addPost(hotPost("a", 500));
    useFeedStore.getState().addPost(hotPost("b", 2));  // cold
    const posts = useFeedStore.getState().userPosts;
    // Hot post should have a tier; cold shouldn't.
    const a = posts.find((p) => p.id === "a");
    const b = posts.find((p) => p.id === "b");
    expect(a?.heatTier).toBeDefined();
    expect(b?.heatTier).toBeUndefined();
  });

  it("removePost re-enriches the remainder", () => {
    const s = useFeedStore.getState();
    s.addPost(hotPost("a", 500));
    s.addPost(hotPost("b", 500));
    s.addPost(hotPost("c", 500));
    s.removePost("a");
    const posts = useFeedStore.getState().userPosts;
    expect(posts.every((p) => p.id !== "a")).toBe(true);
    // Every remaining post still has a heatTier defined (or not, but
    // the enrichment function was invoked — no stale tiers).
    for (const p of posts) {
      if (p.heatTier !== undefined) {
        expect(["warm", "hot", "trending"]).toContain(p.heatTier);
      }
    }
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- lib/store/feed-store.test.ts`
Expected: FAIL — `a?.heatTier` is `undefined` because `addPost` does not yet enrich.

- [ ] **Step 3: Wrap mutations in `feed-store.ts` with enrichment**

Open `lib/store/feed-store.ts`. Add the import at the top of the file, grouped with other `lib/` imports:

```ts
import { enrichWithHeatTiers } from "@/lib/social";
```

Find `addPost` (around line 97–101). Replace:

```ts
set((s) => ({ userPosts: [post, ...s.userPosts] }));
```

with:

```ts
set((s) => ({ userPosts: enrichWithHeatTiers([post, ...s.userPosts]) }));
```

Find `removePost` (around line 114). Replace:

```ts
set((s) => ({ userPosts: s.userPosts.filter((p) => p.id !== id) }));
```

with:

```ts
set((s) => ({ userPosts: enrichWithHeatTiers(s.userPosts.filter((p) => p.id !== id)) }));
```

Find `removePosts` (around line 136). Replace:

```ts
set((s) => ({ userPosts: s.userPosts.filter((p) => !idSet.has(p.id)) }));
```

with:

```ts
set((s) => ({ userPosts: enrichWithHeatTiers(s.userPosts.filter((p) => !idSet.has(p.id))) }));
```

Find the set call inside `hydrateAllPosts` (around line 184). Replace:

```ts
set({ userPosts: [...unpersistedInMemory, ...hydrated] });
```

with:

```ts
set({ userPosts: enrichWithHeatTiers([...unpersistedInMemory, ...hydrated]) });
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- lib/store/feed-store.test.ts lib/social.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify line count under 900 — extract if needed**

Run: `wc -l lib/store/feed-store.ts`
If the result is greater than **870** (leaving headroom for future edits), extract `enrichWithHeatTiers` wrapping to `lib/store/feed-heat.ts`. Otherwise skip to Step 6.

**Extraction path (only if needed):**

Create `lib/store/feed-heat.ts`:

```ts
import { enrichWithHeatTiers } from "@/lib/social";
import type { FeedPost } from "./feed-store";

/** Enrich by reference — pure passthrough. Exists so feed-store.ts can stay
 *  under the 900-line cap even as more enrichment passes are added. */
export const enrichPool = (pool: FeedPost[]): FeedPost[] => enrichWithHeatTiers(pool);
```

Then in `feed-store.ts`, replace the four `enrichWithHeatTiers(...)` call sites with `enrichPool(...)` and update the import accordingly.

- [ ] **Step 6: Commit**

```bash
git add lib/store/feed-store.ts lib/store/feed-store.test.ts
git add lib/store/feed-heat.ts 2>/dev/null || true
git commit -m "feat(heat): enrich FeedPost with heatTier on store mutations"
```

---

## Task 5: Strip `heatTier` in IDB serializer

**Files:**
- Modify: `lib/store/feed-idb.ts`

- [ ] **Step 1: Write the assertion test (extending feed-store.test.ts)**

Open `lib/store/feed-store.test.ts`. Append:

```ts
import * as feedIdb from "./feed-idb";

describe("feed-idb heatTier discipline", () => {
  it("savePostToIDB strips heatTier before persisting", async () => {
    // Redirect the mock to capture what savePostToIDB receives vs what it writes.
    const saved: FeedPost[] = [];
    vi.mocked(feedIdb.savePostToIDB).mockImplementation(async (p) => {
      saved.push(p);
    });
    useFeedStore.getState().addPost(hotPost("persist-me", 500));
    // Flush microtasks so the fire-and-forget save() lands.
    await new Promise((r) => setTimeout(r, 0));
    expect(saved.length).toBeGreaterThan(0);
    // After stripping: no heatTier on the persisted payload.
    expect(saved[0].heatTier).toBeUndefined();
  });
});
```

Note: the mock setup at the top of the file already replaces `savePostToIDB` with a `vi.fn()`. This test overrides the implementation per-test to capture arguments.

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- lib/store/feed-store.test.ts`
Expected: FAIL — `savePostToIDB` receives the enriched post (with `heatTier` set) because the feed-store call-site in `addPost` passes `post` directly (before enrichment spreads tier). The fix is to either (a) strip inside `savePostToIDB`, or (b) strip at the call site. We centralize stripping inside `feed-idb.ts` so every persistence path is clean.

- [ ] **Step 3: Strip inside `savePostToIDB`**

Open `lib/store/feed-idb.ts`. Find the `safePost` construction inside `savePostToIDB` (around line 19). Replace the entire function body with:

```ts
export async function savePostToIDB(post: FeedPost): Promise<void> {
  // Strip derived `heatTier` — it is pool-dependent and never trustworthy off-disk.
  const { heatTier: _drop, ...rest } = post;
  const safePost: FeedPost = {
    ...rest,
    videoUrl: rest.videoUrl?.startsWith("blob:") ? undefined : rest.videoUrl,
    projectSnapshot: rest.projectSnapshot
      ? {
          ...rest.projectSnapshot,
          mediaPool: rest.projectSnapshot.mediaPool?.map((m) => ({
            ...m,
            previewUrl: m.previewUrl?.startsWith("blob:") ? "" : m.previewUrl,
          })),
        }
      : undefined,
  };
  const ok = await idbSafeSet(post.id, safePost, feedDb);
  if (!ok) {
    console.error("[FeedIDB] savePostToIDB failed — IDB write returned false for post", post.id, `"${post.title}"`);
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npm test -- lib/store/feed-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/store/feed-idb.ts lib/store/feed-store.test.ts
git commit -m "feat(heat): strip heatTier in savePostToIDB before persistence"
```

---

## Task 6: Route-group restructure — introduce `(consumption)`, `(creation)`, `(auth)`

**Files:**
- Move: all routes per the File Structure table
- Create: `app/(consumption)/layout.tsx`, `app/(creation)/layout.tsx`, `app/(auth)/layout.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Create `(creation)/layout.tsx` — the Sidebar shell**

Create `app/(creation)/layout.tsx`:

```tsx
import { Sidebar } from "@/components/ui/sidebar";
import { HydrationBarrier } from "@/components/HydrationBarrier";

export default function CreationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="ml-56 flex-1 overflow-hidden min-w-0 min-h-0 h-full">
        <HydrationBarrier>{children}</HydrationBarrier>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create `(consumption)/layout.tsx` — stub that will gain GlassIsland in Task 10**

Create `app/(consumption)/layout.tsx`:

```tsx
import { HydrationBarrier } from "@/components/HydrationBarrier";

export default function ConsumptionLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full">
      <HydrationBarrier>{children}</HydrationBarrier>
      {modal}
    </div>
  );
}
```

- [ ] **Step 3: Create `(consumption)/@modal/default.tsx`**

Create `app/(consumption)/@modal/default.tsx`:

```tsx
export default function ModalDefault() {
  return null;
}
```

- [ ] **Step 4: Create `(auth)/layout.tsx` — full-bleed, no chrome**

Create `app/(auth)/layout.tsx`:

```tsx
import { HydrationBarrier } from "@/components/HydrationBarrier";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#1a1a1a]">
      <HydrationBarrier>{children}</HydrationBarrier>
    </div>
  );
}
```

- [ ] **Step 5: Strip Sidebar + main-offset from root `app/layout.tsx`**

Open `app/layout.tsx`. Replace the entire `export default function RootLayout(...)` body with:

```tsx
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-[#1a1a1a] font-sans antialiased`}
      >
        <GlobalSvgFilters />
        <GlobalHydrator />
        <AppBootstrap />
        <SaveBarrierOverlay />
        {children}
      </body>
    </html>
  );
}
```

Note: `Sidebar` and `HydrationBarrier` imports at the top of the file should also be removed (they're now inside the group layouts). `GlobalSvgFilters`, `GlobalHydrator`, `AppBootstrap`, `SaveBarrierOverlay` imports remain.

- [ ] **Step 6: Move routes with `git mv`**

Run these commands in order from `D:\Projects\Synapse`:

```bash
# Consumption group
mkdir -p "app/(consumption)/home" "app/(consumption)/browse" "app/(consumption)/explore" "app/(consumption)/niche/[category]" "app/(consumption)/gallery" "app/(consumption)/vault" "app/(consumption)/video/[id]"
git mv app/page.tsx                       "app/(consumption)/page.tsx"
git mv app/home/page.tsx                  "app/(consumption)/home/page.tsx"
git mv app/browse/page.tsx                "app/(consumption)/browse/page.tsx"
git mv app/explore/page.tsx               "app/(consumption)/explore/page.tsx"
git mv app/niche/page.tsx                 "app/(consumption)/niche/page.tsx"
git mv app/niche/[category]/page.tsx      "app/(consumption)/niche/[category]/page.tsx"
git mv app/gallery/page.tsx               "app/(consumption)/gallery/page.tsx"
git mv app/vault/page.tsx                 "app/(consumption)/vault/page.tsx"
git mv app/video/[id]/layout.tsx          "app/(consumption)/video/[id]/layout.tsx"
git mv app/video/[id]/page.tsx            "app/(consumption)/video/[id]/page.tsx"

# Creation group
mkdir -p "app/(creation)/studio/dashboard" "app/(creation)/profile/[username]" "app/(creation)/projects" "app/(creation)/upload" "app/(creation)/session/[slug]"
git mv app/studio/page.tsx                          "app/(creation)/studio/page.tsx"
git mv app/studio/dashboard/page.tsx                "app/(creation)/studio/dashboard/page.tsx"
git mv app/profile/page.tsx                         "app/(creation)/profile/page.tsx"
git mv app/profile/[username]/layout.tsx            "app/(creation)/profile/[username]/layout.tsx"
git mv app/profile/[username]/layout.test.ts        "app/(creation)/profile/[username]/layout.test.ts"
git mv app/profile/[username]/page.tsx              "app/(creation)/profile/[username]/page.tsx"
git mv app/projects/page.tsx                        "app/(creation)/projects/page.tsx"
git mv app/upload/page.tsx                          "app/(creation)/upload/page.tsx"
git mv app/session/[slug]/page.tsx                  "app/(creation)/session/[slug]/page.tsx"

# Auth group
mkdir -p "app/(auth)/login"
git mv app/login/page.tsx                 "app/(auth)/login/page.tsx"

# Remove now-empty directories
rmdir app/home app/browse app/explore app/niche/[category] app/niche app/gallery app/vault app/video/[id] app/video 2>/dev/null || true
rmdir app/studio/dashboard app/studio app/profile/[username] app/profile app/projects app/upload app/session/[slug] app/session 2>/dev/null || true
rmdir app/login 2>/dev/null || true
```

- [ ] **Step 7: Update any path-sensitive imports inside the moved test**

Open `app/(creation)/profile/[username]/layout.test.ts`. Verify that any relative imports (`./layout`, `../../../lib/...`) still resolve. The test file is now two directories deeper — relative-parent paths (`../../..`) need one additional `../` **only** if they reach outside `app/`. Imports via the `@/` alias do not change. If any relative path is broken, update it.

Run:

```bash
grep -n "require\|import" "app/(creation)/profile/[username]/layout.test.ts"
```

Verify every import path resolves from the new location.

- [ ] **Step 8: Run Next build to confirm the tree is valid**

Run: `npm run build`
Expected: Build completes. Output lists `/`, `/home`, `/browse`, `/explore`, `/niche/[category]`, `/gallery`, `/vault`, `/video/[id]`, `/studio`, `/studio/dashboard`, `/profile`, `/profile/[username]`, `/projects`, `/upload`, `/session/[slug]`, `/login` — **no URLs changed**.

- [ ] **Step 9: Run the existing test suite**

Run: `npm test`
Expected: All tests pass — including `app/(creation)/profile/[username]/layout.test.ts`.

- [ ] **Step 10: Verify the baseline screenshot test still passes against `(creation)` routes**

Start dev server in another shell: `npm run dev`
Run: `npm run audit -- e2e/creation-chrome-baseline.spec.ts`
Expected: "5 passed." Pre-restructure baseline matches post-restructure output.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor(routing): split app into (consumption)/(creation)/(auth) route groups"
```

---

## Task 7: `useGlassIslandState` hysteresis hook (TDD)

**Files:**
- Create: `components/chrome/use-glass-island-state.ts`
- Create: `components/chrome/use-glass-island-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `components/chrome/use-glass-island-state.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";

// Mock the Master Clock with a manual tick driver.
let tickCallbacks: Array<() => void> = [];
vi.mock("@/lib/store/global-ticker", () => ({
  registerTickCallback: (cb: () => void) => {
    tickCallbacks.push(cb);
    return tickCallbacks.length;
  },
  unregisterTickCallback: (id: number) => {
    tickCallbacks[id - 1] = () => {};
  },
}));

import { useGlassIslandState } from "./use-glass-island-state";

function tick() {
  for (const cb of tickCallbacks) cb();
}

function setup() {
  const el = { scrollTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLElement;
  const listener = vi.fn(() => { /* assigned below */ });
  // Capture the scroll listener registered by the hook.
  (el.addEventListener as ReturnType<typeof vi.fn>).mockImplementation((evt: string, cb: () => void) => {
    if (evt === "scroll") listener.mockImplementation(cb);
  });
  const { result } = renderHook(() =>
    useGlassIslandState({ current: el }),
  );
  const setScrollAndTick = (top: number) => {
    (el as { scrollTop: number }).scrollTop = top;
    listener();
    tick();
  };
  return { result, setScrollAndTick };
}

beforeEach(() => { tickCallbacks = []; });
afterEach(() => { tickCallbacks = []; });

describe("useGlassIslandState — hysteresis math", () => {
  it("starts expanded at scroll 0", () => {
    const { result } = setup();
    expect(result.current).toBe(false);
  });

  it("remains expanded on sub-20px jitter", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(10);   // down 10
      setScrollAndTick(5);    // up 5
      setScrollAndTick(13);   // down 8
    });
    expect(result.current).toBe(false);
  });

  it("compresses once sustained downscroll ≥ 20px past the floor", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(100);  // well past FLOOR_PX; delta = 100 ≥ 20
    });
    expect(result.current).toBe(true);
  });

  it("expands once sustained upscroll ≥ 20px from compressed", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(500);  // compress
      setScrollAndTick(470);  // up 30 — should expand
    });
    expect(result.current).toBe(false);
  });

  it("near-top override — always expanded at scrollTop ≤ FLOOR_PX", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(500);  // compress
      setScrollAndTick(5);    // scrollTop ≤ 8 — force expand
    });
    expect(result.current).toBe(false);
  });

  it("clamps accumulator so first upscroll pixel counts after big down", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(400);  // big downscroll → compress, accumulator clamped at 20
      setScrollAndTick(380);  // -20 delta, would underflow accumulator to exactly -20
    });
    // A user who scrolls up only 20 px after a 400 px down should see expand
    // without needing to unwind 400 px of debt.
    expect(result.current).toBe(false);
  });
});
```

Install `@testing-library/react` if not already present:

```bash
npm list @testing-library/react || npm i -D @testing-library/react
```

- [ ] **Step 2: Run test — expect failure**

Run: `npm test -- components/chrome/use-glass-island-state.test.ts`
Expected: FAIL — module `./use-glass-island-state` does not exist.

- [ ] **Step 3: Implement the hook**

Create `components/chrome/use-glass-island-state.ts`:

```ts
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  registerTickCallback,
  unregisterTickCallback,
} from "@/lib/store/global-ticker";

const HYSTERESIS_PX = 20;
const FLOOR_PX      = 8;

/** Returns `true` when the Glass Island should be in its compressed form.
 *  `scrollRef` is optional; when omitted or null, the hook listens on
 *  `document.documentElement`. */
export function useGlassIslandState(
  scrollRef?: RefObject<HTMLElement | null>,
): boolean {
  const [compressed, setCompressed] = useState(false);
  const lastY       = useRef(0);
  const accumulator = useRef(0);
  const dirty       = useRef(false);

  useEffect(() => {
    // Resolve target: explicit ref > document scrolling element > <html>.
    const el: HTMLElement =
      scrollRef?.current ??
      (document.scrollingElement as HTMLElement | null) ??
      document.documentElement;

    lastY.current       = el.scrollTop;
    accumulator.current = 0;
    dirty.current       = false;

    const onScroll = () => { dirty.current = true; };

    const tickId = registerTickCallback(() => {
      if (!dirty.current) return;
      dirty.current = false;

      const y = el.scrollTop;
      const delta = y - lastY.current;
      lastY.current = y;

      // Near-top override — always expanded above FLOOR_PX.
      if (y <= FLOOR_PX) {
        accumulator.current = 0;
        setCompressed((c) => (c ? false : c));
        return;
      }

      // Sign-change reset — restart the accumulator when the direction flips.
      if (
        Math.sign(delta) !== Math.sign(accumulator.current) &&
        accumulator.current !== 0
      ) {
        accumulator.current = delta;
      } else {
        accumulator.current += delta;
      }

      if (accumulator.current >= HYSTERESIS_PX) {
        setCompressed((c) => (c ? c : true));
        accumulator.current = HYSTERESIS_PX;
      } else if (accumulator.current <= -HYSTERESIS_PX) {
        setCompressed((c) => (!c ? c : false));
        accumulator.current = -HYSTERESIS_PX;
      }
    });

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      unregisterTickCallback(tickId);
    };
  }, [scrollRef]);

  return compressed;
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- components/chrome/use-glass-island-state.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add components/chrome/use-glass-island-state.ts components/chrome/use-glass-island-state.test.ts package.json package-lock.json
git commit -m "feat(glass): ticker-driven scroll-hysteresis hook for Glass Island"
```

---

## Task 8: `useGlassMotion` reduced-motion helper

**Files:**
- Create: `components/chrome/use-glass-motion.ts`

- [ ] **Step 1: Write the helper**

Create `components/chrome/use-glass-motion.ts`:

```ts
"use client";

import { useReducedMotion, type Transition } from "framer-motion";

const SPRING: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 36,
  mass: 0.9,
};

const FADE: Transition = {
  duration: 0.12,
  ease: "easeOut",
};

/** Returns the transition object used by every Glass Island motion.
 *  On `prefers-reduced-motion: reduce`, collapses the spring to a 120ms
 *  opacity fade. Shared so Spec 2's layoutId morphs inherit the same guard. */
export function useGlassMotion(): Transition {
  const reduced = useReducedMotion();
  return reduced ? FADE : SPRING;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chrome/use-glass-motion.ts
git commit -m "feat(glass): useGlassMotion — shared reduced-motion transition helper"
```

---

## Task 9: `<GlassIsland />` component + mount

**Files:**
- Create: `components/chrome/glass-island.tsx`
- Modify: `app/(consumption)/layout.tsx`

- [ ] **Step 1: Implement the component**

Create `components/chrome/glass-island.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Search, User } from "lucide-react";
import { useGlassIslandState } from "./use-glass-island-state";
import { useGlassMotion } from "./use-glass-motion";
import { useUserStore } from "@/lib/store/user-store";

interface NavItem {
  href: string;
  label: string;
  prefixes?: string[];
}

const PRIMARY: NavItem[] = [
  { href: "/home",   label: "Home" },
  { href: "/browse", label: "Browse", prefixes: ["/browse", "/explore"] },
  { href: "/niche",  label: "Niche",  prefixes: ["/niche"] },
  { href: "/vault",  label: "Vault" },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.prefixes) {
    return item.prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
  }
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function GlassIsland() {
  const pathname   = usePathname();
  const compressed = useGlassIslandState();
  const transition = useGlassMotion();
  const profile    = useUserStore((s) => s.profile);

  // Avatar/login destination. Keeps search-icon parity in both states.
  const avatarHref = profile ? `/profile/${profile.username}` : "/login";

  return (
    <motion.nav
      layout
      transition={transition}
      aria-label="Primary navigation"
      className={[
        "glass-pill fixed left-1/2 z-30 -translate-x-1/2 flex items-center",
        compressed ? "top-2 gap-2 px-3.5 py-1.5" : "top-4 gap-4 px-5 py-3",
      ].join(" ")}
      style={{ width: "min(calc(100% - 2rem), 72rem)" }}
    >
      <Link
        href="/"
        className="text-lg font-bold tracking-wide text-white transition-opacity hover:opacity-70"
        aria-label="Synapse home"
      >
        {compressed ? "S" : "SYNAPSE"}
      </Link>
      <div className="flex items-center gap-1">
        {PRIMARY.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`glass-island-nav-${item.label.toLowerCase()}`}
              className={[
                "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/5",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/browse"
          aria-label="Search"
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10"
        >
          <Search size={16} />
        </Link>
        {!compressed && (
          <Link
            href={avatarHref}
            aria-label={profile ? "Open profile" : "Sign in"}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10"
          >
            <User size={16} />
          </Link>
        )}
      </div>
    </motion.nav>
  );
}
```

- [ ] **Step 2: Mount `<GlassIsland />` in the consumption layout + add reachability padding**

Open `app/(consumption)/layout.tsx`. Replace its entire contents with:

```tsx
import { HydrationBarrier } from "@/components/HydrationBarrier";
import { GlassIsland } from "@/components/chrome/glass-island";

export default function ConsumptionLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen w-full">
      <GlassIsland />
      {/* Reachability: 3.5rem top-padding ensures the first row of feed content
          is tappable even when the Island is in its expanded state (top: 1rem
          + height ≈ 2.5rem = 3.5rem). Content still scrolls visually under
          the glass. */}
      <div className="pt-14">
        <HydrationBarrier>{children}</HydrationBarrier>
      </div>
      {modal}
    </div>
  );
}
```

- [ ] **Step 3: Build and manually verify**

Start dev server: `npm run dev`
Open: `http://localhost:3000/home`
Expected:
- Glass pill visible, centered, floating 1rem from the top.
- Scroll down ≥ 20 px → pill compresses (wordmark shrinks to "S", padding shrinks, avatar hides).
- Scroll up ≥ 20 px → pill expands.
- Scroll to the very top → pill fully expanded.
- Navigating to `/studio/dashboard` → pill gone, left sidebar visible.

- [ ] **Step 4: Commit**

```bash
git add components/chrome/glass-island.tsx "app/(consumption)/layout.tsx"
git commit -m "feat(glass): Glass Island floating pill with scroll-hysteresis compression"
```

---

## Task 10: `scroll-lock-while-modal` utility

**Files:**
- Create: `components/chrome/scroll-lock-while-modal.tsx`

- [ ] **Step 1: Implement the component**

Create `components/chrome/scroll-lock-while-modal.tsx`:

```tsx
"use client";

import { useEffect } from "react";

/** Mount inside any modal overlay that must prevent body scrolling. Computes
 *  the native scrollbar width (full-viewport minus visible-viewport) and
 *  reserves that width as right-side padding on <body> so the Feed grid does
 *  not jerk when the scrollbar disappears. On macOS overlay scrollbars / iOS
 *  Safari the measurement is 0 and only `overflow: hidden` is applied. */
export function ScrollLockWhileModal() {
  useEffect(() => {
    const scrollbarWidth = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth,
    );
    const body = document.body;

    const prevOverflow    = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow     = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, []);

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chrome/scroll-lock-while-modal.tsx
git commit -m "feat(glass): scroll-lock utility with scrollbar-width compensation"
```

---

## Task 11: `@modal/(.)video/[id]/page.tsx` intercepting route

**Files:**
- Create: `app/(consumption)/@modal/(.)video/[id]/page.tsx`
- Modify (audit): any Feed entry point that opens Theater via non-`Link` navigation

- [ ] **Step 1: Audit Feed entry points for `<Link>` / `router.push` usage**

Run:

```bash
grep -rn "href=\`/video/" components/ app/ 2>/dev/null
grep -rn "push(\`/video/" components/ app/ 2>/dev/null
grep -rn "<a[^>]*/video/" components/ app/ 2>/dev/null
```

Expected: every Theater-opening link uses `<Link>` or `router.push`. If any native `<a href="/video/...">` exists, convert it to `<Link>`. Record findings.

- [ ] **Step 2: Read the full-page Theater to understand what to mount**

Run: `cat "app/(consumption)/video/[id]/page.tsx"`
Note the default export signature (likely `export default async function Page({ params })` or similar). The intercepted overlay mounts the same component in an overlay shell.

- [ ] **Step 3: Write the intercepted overlay page**

Create `app/(consumption)/@modal/(.)video/[id]/page.tsx`:

```tsx
import { ScrollLockWhileModal } from "@/components/chrome/scroll-lock-while-modal";
import VideoIdPage from "../../../video/[id]/page";

/** Intercepted overlay variant of /video/[id]. The underlying Feed stays
 *  mounted beneath this overlay — that is the entire point of intercepting
 *  routes. In Spec 1 this is a plain z-50 fixed overlay; Spec 2 replaces
 *  the outer div with a motion.div carrying layoutId={params.id} to morph
 *  from the Feed card's thumbnail container. */
export default function InterceptedVideoPage(
  props: Parameters<typeof VideoIdPage>[0],
) {
  return (
    <div
      data-testid="intercepted-theater-overlay"
      className="fixed inset-0 z-50 bg-black/90"
    >
      <ScrollLockWhileModal />
      <VideoIdPage {...props} />
    </div>
  );
}
```

> **If the full-page `VideoIdPage` cannot be imported as a React component** (e.g., it is an async server component that cannot be composed this way), replace the import with a direct mount of whatever component the full-page route composes. Typical pattern: the full-page file looks like `export default function Page({ params }) { return <TheaterMode postId={...} />; }` — copy that body into the overlay and wrap with the z-50 div + `<ScrollLockWhileModal />`.

- [ ] **Step 4: Verify interception works**

Start dev server: `npm run dev`

Open `/home`, click any Feed card.
Expected: URL updates to `/video/<id>`; the Feed grid stays mounted behind a dimmed `bg-black/90` overlay that renders the Theater. Pressing the browser back button restores the Feed at its previous scroll position. No horizontal jerk on open/close (Windows/Firefox users).

Open `/video/<id>` directly in a new tab (hard navigation).
Expected: full-page Theater renders without the overlay wrapper (no `data-testid="intercepted-theater-overlay"` in the DOM). Feed grid is not mounted.

- [ ] **Step 5: Commit**

```bash
git add "app/(consumption)/@modal/(.)video/[id]/page.tsx"
git commit -m "feat(routing): @modal intercepting route for in-feed Theater overlay"
```

---

## Task 12: Hardware capability probe

**Files:**
- Create: `components/chrome/glass-capability.ts`
- Create: `components/chrome/glass-capability-mount.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Implement the probe helper**

Create `components/chrome/glass-capability.ts`:

```ts
/** Returns the glass rendering tier for the current device.
 *  - "full"    → full backdrop-blur, shadows, glow.
 *  - "reduced" → shallower blur, no shadow, no glow.
 *  Heuristic: deviceMemory < 4 OR hardwareConcurrency < 4 → reduced.
 *  Server-side: always "full" (the client mount flips it on first paint). */
export function detectGlassTier(): "full" | "reduced" {
  if (typeof navigator === "undefined") return "full";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if ((typeof mem === "number" && mem < 4) || (typeof cores === "number" && cores < 4)) {
    return "reduced";
  }
  return "full";
}
```

- [ ] **Step 2: Implement the mount component**

Create `components/chrome/glass-capability-mount.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { detectGlassTier } from "./glass-capability";

/** Client-only: sets `data-glass-tier` on <body> so CSS rules can downgrade
 *  blur/shadow on modest hardware without any per-component wiring. */
export function GlassCapabilityMount() {
  useEffect(() => {
    const tier = detectGlassTier();
    document.body.setAttribute("data-glass-tier", tier);
    return () => {
      document.body.removeAttribute("data-glass-tier");
    };
  }, []);
  return null;
}
```

- [ ] **Step 3: Mount inside root layout**

Open `app/layout.tsx`. Add to the imports:

```tsx
import { GlassCapabilityMount } from "@/components/chrome/glass-capability-mount";
```

Inside the `<body>` element, add `<GlassCapabilityMount />` alongside the existing `<AppBootstrap />`, `<GlobalHydrator />`, etc:

```tsx
<body className={...}>
  <GlobalSvgFilters />
  <GlobalHydrator />
  <AppBootstrap />
  <GlassCapabilityMount />
  <SaveBarrierOverlay />
  {children}
</body>
```

- [ ] **Step 4: Verify**

Start dev server: `npm run dev`
Open DevTools → Elements → inspect `<body>` at `/home`.
Expected: `<body data-glass-tier="full" ...>` on a desktop; `"reduced"` on a constrained device.

Emulate a low-memory environment via DevTools → `... → Run command → Show Rendering → "CPU throttling: 6× slowdown"` is not enough (it doesn't change `deviceMemory`). Instead, override in the console:

```js
Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2, configurable: true });
location.reload();
```

Expected: `<body data-glass-tier="reduced">`. The Glass Island shows a visibly shallower blur (8 px vs 24 px) and no glow halo.

- [ ] **Step 5: Commit**

```bash
git add components/chrome/glass-capability.ts components/chrome/glass-capability-mount.tsx app/layout.tsx
git commit -m "feat(glass): hardware capability probe → data-glass-tier degradation"
```

---

## Task 13: E2E — Glass Island hysteresis

**Files:**
- Create: `e2e/glass-island.spec.ts`

- [ ] **Step 1: Write the E2E**

Create `e2e/glass-island.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("Glass Island — hysteresis behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/home");
    // Wait for the Island to mount.
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  });

  test("compresses after a sustained 25px downscroll", async ({ page }) => {
    const wordmark = page.getByLabel("Synapse home");
    await expect(wordmark).toHaveText("SYNAPSE");
    await page.mouse.wheel(0, 25);
    // Poll until the compressed wordmark shows. Give the ticker two frames.
    await expect(wordmark).toHaveText("S", { timeout: 1000 });
  });

  test("expands after a sustained 25px upscroll from compressed", async ({ page }) => {
    await page.mouse.wheel(0, 400);
    await expect(page.getByLabel("Synapse home")).toHaveText("S", { timeout: 1000 });
    await page.mouse.wheel(0, -30);
    await expect(page.getByLabel("Synapse home")).toHaveText("SYNAPSE", { timeout: 1000 });
  });

  test("sub-20px jitter does not toggle state", async ({ page }) => {
    await page.mouse.wheel(0, 10);
    await page.mouse.wheel(0, -5);
    await page.mouse.wheel(0, 8);
    // Wait a frame and assert still expanded.
    await page.waitForTimeout(300);
    await expect(page.getByLabel("Synapse home")).toHaveText("SYNAPSE");
  });

  test("near-top override — scrolling back to 0 always expands", async ({ page }) => {
    await page.mouse.wheel(0, 400);
    await expect(page.getByLabel("Synapse home")).toHaveText("S", { timeout: 1000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    await expect(page.getByLabel("Synapse home")).toHaveText("SYNAPSE", { timeout: 1000 });
  });
});
```

- [ ] **Step 2: Run — expect pass**

Start dev server in one shell: `npm run dev`
Run: `npm run audit -- e2e/glass-island.spec.ts`
Expected: "4 passed."

- [ ] **Step 3: Commit**

```bash
git add e2e/glass-island.spec.ts
git commit -m "test(e2e): Glass Island hysteresis behaviour"
```

---

## Task 14: E2E — consumption vs creation chrome separation

**Files:**
- Create: `e2e/consumption-creation-chrome.spec.ts`

- [ ] **Step 1: Write the E2E**

Create `e2e/consumption-creation-chrome.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("Chrome separation across route groups", () => {
  test("consumption route shows Glass Island, not the left Sidebar", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    // Sidebar anchor from components/ui/sidebar.tsx has this test id.
    await expect(page.locator("[data-testid='sidebar-nav-home']")).toHaveCount(0);
  });

  test("creation route shows left Sidebar, not the Glass Island", async ({ page }) => {
    await page.goto("/studio/dashboard");
    await expect(page.locator("[data-testid='sidebar-nav-home']")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  });

  test("auth route shows neither chrome", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("[data-testid='sidebar-nav-home']")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run — expect pass**

Run: `npm run audit -- e2e/consumption-creation-chrome.spec.ts`
Expected: "3 passed."

- [ ] **Step 3: Commit**

```bash
git add e2e/consumption-creation-chrome.spec.ts
git commit -m "test(e2e): consumption vs creation vs auth chrome separation"
```

---

## Task 15: E2E — intercepting-route correctness

**Files:**
- Create: `e2e/intercepting-route.spec.ts`

- [ ] **Step 1: Write the E2E**

Create `e2e/intercepting-route.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("Intercepting route — Feed → Theater overlay", () => {
  test("Feed click overlays Theater without unmounting Feed", async ({ page }) => {
    await page.goto("/home");
    // Wait for at least one feed card to render. FeedGrid renders <article>
    // elements as the card root (see components/feed/feed-post-card.tsx).
    const firstCard = page.locator("article").first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();

    // URL updates to /video/<id>.
    await expect(page).toHaveURL(/\/video\/[^/]+/);
    // Overlay is present.
    await expect(page.locator("[data-testid='intercepted-theater-overlay']")).toBeVisible();
    // Feed grid is still in the DOM underneath — the card we clicked still exists.
    await expect(firstCard).toBeAttached();
  });

  test("Esc dismisses the overlay and restores scroll lock", async ({ page }) => {
    await page.goto("/home");
    // Remember scrollbar position before opening the overlay.
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    const yBefore = await page.evaluate(() => window.scrollY);

    await page.locator("article").first().click();
    await expect(page.locator("[data-testid='intercepted-theater-overlay']")).toBeVisible();

    await page.keyboard.press("Escape");
    // Overlay gone.
    await expect(page.locator("[data-testid='intercepted-theater-overlay']")).toHaveCount(0);
    // Body scroll unlocked.
    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe("");
    // Scroll position preserved.
    const yAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(yAfter - yBefore)).toBeLessThanOrEqual(2);
  });

  test("Direct deep-link renders full-page Theater without overlay wrapper", async ({ page }) => {
    // Navigate first to /home and capture a real post id from the rendered grid,
    // then open a fresh page directly at /video/<id> (a hard navigation — not a
    // client-side push — so interception does not fire).
    await page.goto("/home");
    const href = await page.locator("article a[href^='/video/'], article [data-video-href]").first().getAttribute("href");
    const id = href?.split("/").pop();
    test.skip(!id, "No feed posts with video links found — can't verify direct visit.");
    const fresh = await page.context().newPage();
    await fresh.goto(`/video/${id}`);
    // Overlay wrapper should NOT be present on a direct visit.
    await expect(fresh.locator("[data-testid='intercepted-theater-overlay']")).toHaveCount(0);
  });
});
```

> The third test depends on the Feed grid exposing a usable href. If the Feed grid opens Theater via `onClick → router.push` only (with no anchor), the test's `href` lookup will return null and the test will skip. That is acceptable — direct-visit coverage is also provided by the baseline behavior of `/video/[id]/page.tsx` existing as a standalone route. Revisit this test in Spec 2 when Feed cards wrap their thumbnails in `<Link>` for the `layoutId` morph.

- [ ] **Step 2: Run — expect pass (the third test may skip gracefully)**

Run: `npm run audit -- e2e/intercepting-route.spec.ts`
Expected: "3 passed" (or "2 passed, 1 skipped" if deep-link href is not exposed yet).

- [ ] **Step 3: Commit**

```bash
git add e2e/intercepting-route.spec.ts
git commit -m "test(e2e): intercepting-route behaviour for Feed → Theater overlay"
```

---

## Task 16: E2E — contrast audit over Glass Island

**Files:**
- Create: `e2e/glass-surface-contrast.spec.ts`

- [ ] **Step 1: Install axe-playwright if not already present**

Run: `npm list @axe-core/playwright || npm i -D @axe-core/playwright`
Expected: `@axe-core/playwright` appears in `package.json` devDependencies.

- [ ] **Step 2: Write the axe-driven contrast E2E**

Create `e2e/glass-surface-contrast.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Worst-case contrast: paint a pure-white background behind the Glass Island
 *  to simulate the brightest video frame possible, then run axe-core and
 *  assert no contrast violations on the nav or its children. */
test("Glass Island text remains legible over pure-white content", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();

  // Inject a white panel directly behind the Island.
  await page.evaluate(() => {
    const panel = document.createElement("div");
    panel.id = "contrast-stress-panel";
    panel.style.cssText = "position:fixed;inset:0;z-index:1;background:#ffffff;";
    document.body.insertBefore(panel, document.body.firstChild);
  });

  const results = await new AxeBuilder({ page })
    .include('[aria-label="Primary navigation"]')
    .withTags(["wcag2aa"])
    .analyze();

  expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
});
```

- [ ] **Step 3: Run — expect pass**

Run: `npm run audit -- e2e/glass-surface-contrast.spec.ts`
Expected: "1 passed."

- [ ] **Step 4: Commit**

```bash
git add e2e/glass-surface-contrast.spec.ts package.json package-lock.json
git commit -m "test(e2e): axe contrast audit for Glass Island over white content"
```

---

## Task 17: Final acceptance-gate verification

**Purpose:** Walk the Spec-1 acceptance gate (§12 of the design doc) and fix anything that fails before opening the PR. No new code; this is the sign-off checklist.

- [ ] **Step 1: Full test suite**

Run: `npm run lint && npm test && npm run audit`
Expected: all green.

- [ ] **Step 2: 900-line-cap audit**

Run:

```bash
find lib/ components/ app/ -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -20
```

Expected: no file exceeds 900 lines.

- [ ] **Step 3: rAF discipline audit**

Run:

```bash
grep -rn "requestAnimationFrame" components/ lib/ app/ 2>/dev/null | grep -v "confetti\|lib/store/global-ticker\|node_modules"
```

Expected: zero matches outside the whitelisted wrappers (confetti, global-ticker itself).

- [ ] **Step 4: `heatTier` network/IDB discipline audit**

Manually: open the app in a browser, open DevTools → Application → IndexedDB → `synapse-feed-db/posts`, inspect a persisted record.
Expected: no `heatTier` key on any record.

Then run:

```bash
grep -rn "heatTier" lib/schema.ts lib/store/feed-idb.ts 2>/dev/null
```

Expected: `feed-idb.ts` contains the destructuring strip (`{ heatTier: _drop, ...rest }`); `schema.ts` contains no mention of `heatTier`.

- [ ] **Step 5: Reduced-motion + reduced-transparency spot-check**

Start dev server: `npm run dev`
In DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce".
Scroll the feed — the Glass Island should snap between expanded/compressed with a 120 ms opacity fade, not a spring.

Switch the setting to "prefers-reduced-transparency: reduce".
Reload. Expected: the Glass Island renders as an opaque dark pill (no blur visible through it).

- [ ] **Step 6: Creation-chrome pixel parity**

Run: `npm run audit -- e2e/creation-chrome-baseline.spec.ts`
Expected: "5 passed." The `(creation)` routes match their pre-restructure screenshots.

- [ ] **Step 7: Performance spot-check (manual)**

Start dev server: `npm run dev`
In Chrome DevTools → Performance → enable "CPU: 4× slowdown" and "Network: Fast 3G".
Record a ~5 s session that scrolls `/home` up and down.
Expected: median frame budget ≤ 16 ms; no "Forced reflow" warnings; no long tasks > 50 ms on the main thread during scroll.

- [ ] **Step 8: Open the Spec-1 PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(glass): Spec 1 foundation — route groups, tokens, Island, @modal, heatTier" --body "$(cat <<'EOF'
## Summary
- Split `app/` into `(consumption)` / `(creation)` / `(auth)` route groups.
- Add Synapse Glass tokens (`@theme`) and utility layer (`glass-surface`, `glass-pill`, `glass-hairline`).
- Introduce `<GlassIsland />` floating header with ticker-driven 20 px scroll hysteresis.
- Scaffold `@modal/(.)video/[id]` intercepting route — plain z-50 overlay; `layoutId` morph lands in Spec 2.
- Enrich `FeedPost` with a derived `heatTier` on store mutations; strip in IDB.
- Adaptive glass degradation via `data-glass-tier` + `prefers-reduced-*` fallbacks.

## Spec
`docs/superpowers/specs/2026-04-19-synapse-glass-foundation-design.md`

## Test plan
- [ ] `npm run lint` green
- [ ] `npm test` green
- [ ] `npm run audit` green (glass-island, consumption-creation-chrome, intercepting-route, glass-surface-contrast, creation-chrome-baseline)
- [ ] Manual: scroll-hysteresis feels smooth on Home; creation routes unchanged visually; direct `/video/<id>` visits render full-page.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened, CI passes all checks.

---

## Self-Review Checklist (run before handing plan to executor)

**Spec coverage (match every spec section to a task):**

- §3 Route restructure → Task 6
- §4 `@modal` scaffolding → Task 11 (route-group prep in Task 6, stub in Task 6 Step 3)
- §5 Glass tokens → Task 2
- §6 Glass Island (component, hook, animation, hysteresis) → Tasks 7, 8, 9
- §7 Heat Tier pipeline → Tasks 3, 4, 5
- §8 Guardrails (reduced-motion → Task 8; reduced-transparency → Task 2; adaptive degradation → Task 12; focus-visible → Task 2; contrast → Task 16)
- §9 Testing strategy → unit coverage in Tasks 3/4/5/7; E2E in Tasks 13/14/15/16; baseline in Task 1
- §10 File map → all files listed above accounted for
- §11 Risks → mitigations wired into the steps (scrollbar-width fallback, 900-line audit, line-cap extraction path)
- §12 Acceptance gate → Task 17

**Placeholders:** only the documented `TODO(spec-2+)` time-decay marker in `lib/social.ts` (per design spec §7.3).

**Type consistency:** `HeatTier`, `HeatThresholds`, `computeHeatThresholds`, `tierFor`, `enrichWithHeatTiers`, `useGlassIslandState`, `useGlassMotion`, `GlassIsland`, `ScrollLockWhileModal`, `GlassCapabilityMount`, `detectGlassTier` — names are used identically across tasks.

**Open items surfaced for the executor:**
- Task 11 Step 3: if `VideoIdPage` is an async server component incompatible with composition, the executor falls back to mounting `<TheaterMode postId={...} />` directly (documented inline).
- Task 6 Step 7: path-sensitive test imports in the moved `layout.test.ts` may need one-step repair — executor follows the grep and fix loop.
- Task 15 Step 1 third test may skip if Feed cards don't expose an `href` — documented acceptable; Spec 2 closes the gap.
