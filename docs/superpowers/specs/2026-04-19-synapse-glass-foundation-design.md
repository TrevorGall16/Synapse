# Synapse Glass — Spec 1: The Foundation

**Date:** 2026-04-19
**Status:** Approved, ready for implementation plan
**Scope:** Structural plumbing for the "Synapse Glass" redesign: route groups,
Glass tokens, the floating Glass Island header, `@modal` intercepting-route
scaffolding, and the `heatTier` data pipeline.

Spec 2 (Engagement & Continuity) covers the visible "payoff" — `layoutId`
morphs, 3-tier heat visuals, sibling dimming, satin scrim, Remix Graph queue.
Spec 2 depends on this spec; it cannot start until this ships.

Phase-4 guardrails (performance, accessibility, reduced-motion) are **not a
phase** — they are hard blockers that gate the merge of *both* specs.

---

## 1. Goals

1. Introduce a route-group split so that "consumption" surfaces (Home, Browse,
   Niche, Explore, Vault, Gallery, Theater) render full-bleed behind a floating
   pill-shaped header, while "creation" surfaces (Studio, Profile, Projects,
   Upload, Session) keep the current left-sidebar chrome. Login becomes its
   own chrome-free "auth" surface.
2. Establish a disciplined **Synapse Glass** token layer: Tailwind 4 `@theme`
   variables plus a minimal `@layer components` utility layer. No component
   abstraction; call sites stay Tailwind-native.
3. Ship the **Glass Island** floating header with a mathematically-correct
   scroll-hysteresis compress/expand behavior driven by the project's Master
   Clock (`registerTickCallback`), not by ad-hoc `requestAnimationFrame`.
4. Scaffold Next.js **intercepting routes** (`@modal/(.)video/[id]`) so a Feed
   card click overlays Theater atop the live Feed while keeping the URL
   shareable. The `layoutId` morph itself is Spec 2; Spec 1 lands only the
   routing plumbing.
5. Land the **`heatTier` data pipeline** end-to-end: derive the tier from
   velocity once at feed hydration, attach to `FeedPost` in memory, never
   serialize to disk or the wire. Spec 2 consumes this to render 3-tier
   visuals; Spec 1 does not change any card UI.
6. Enforce the cross-cutting guardrails (`prefers-reduced-motion`,
   `prefers-reduced-transparency`, 60fps scroll, adaptive hardware
   degradation, focus-visible over glass, AA contrast) as merge gates.

## 2. Non-goals (Spec 1)

Explicitly deferred to Spec 2:

- `layoutId` Feed→Theater shared-element morph animation.
- Reverse snap-back morph on backdrop click.
- Moving `<video>` element during morph (thumbnail swap guardrail).
- 3-tier heat visuals (amber hairline pulse, orange-pink neon, electric-pink
  LIVE chip + flame icon rendering).
- CSS `:has()` sibling dimming on Feed cards.
- Multi-stop satin scrim replacement on Feed cards.
- Infinite vertical Remix Graph queue + `IntersectionObserver` prefetch at
  800 px.
- Desktop right-edge pull-out "Remix Tree" panel.
- Softly-incrementing view counters.
- Mobile glass bottom-bar.

---

## 3. Route-group restructure

Two visible route groups plus an auth group. URLs are unchanged; parenthesised
segments are invisible to the browser.

```
app/
├── layout.tsx                    # Root: html/body, fonts, GlobalHydrator,
│                                 # SaveBarrierOverlay, GlobalSvgFilters,
│                                 # HydrationBarrier.
│                                 # No <Sidebar />. No ml-56 offset.
├── (consumption)/
│   ├── layout.tsx                # <GlassIsland />, {children}, {modal}
│   ├── @modal/
│   │   ├── default.tsx           # export default () => null
│   │   └── (.)video/[id]/
│   │       └── page.tsx          # intercepted Theater overlay
│   ├── page.tsx                  # "/" home feed (was app/page.tsx)
│   ├── home/page.tsx
│   ├── browse/page.tsx
│   ├── explore/page.tsx
│   ├── niche/…
│   ├── gallery/page.tsx
│   ├── vault/page.tsx
│   └── video/[id]/page.tsx       # full-page Theater for direct visits
├── (creation)/
│   ├── layout.tsx                # <Sidebar /> + <main className="ml-56">
│   ├── studio/…
│   ├── profile/…
│   ├── projects/page.tsx
│   ├── upload/page.tsx
│   └── session/[slug]/page.tsx
└── (auth)/
    ├── layout.tsx                # centered full-bleed, no chrome
    └── login/page.tsx
```

**Invariants during the restructure:**

- Every route-relocation is a pure directory move — page contents are
  byte-identical before and after.
- Root providers (`GlobalHydrator`, `AppBootstrap`, `SaveBarrierOverlay`,
  `GlobalSvgFilters`, `HydrationBarrier`) stay at `app/layout.tsx` so both
  groups share them and no state is wiped on group transitions.
- No URL changes; `(consumption)`, `(creation)`, `(auth)` are invisible
  segments.
- `app/profile/[username]/layout.test.ts` moves with its route into
  `(creation)`; verify path constants inside still resolve.

## 4. `@modal` parallel-slot scaffolding (routing only)

Spec 1 lands the routing mechanics so Spec 2 can animate into them. No
`motion.*` components land in Spec 1.

### 4.1. Files

```
app/(consumption)/
├── layout.tsx                              # { children, modal } props
├── @modal/
│   ├── default.tsx                         # () => null
│   └── (.)video/[id]/
│       └── page.tsx                        # intercepted Theater overlay
└── video/[id]/
    └── page.tsx                            # direct-visit full-page Theater
```

### 4.2. Layout contract

```tsx
export default function ConsumptionLayout({
  children,
  modal,
}: { children: React.ReactNode; modal: React.ReactNode }) {
  return (
    <>
      <GlassIsland />
      {children}
      {modal}
    </>
  );
}
```

### 4.3. Intercepted vs direct routes

| Path the user sees                        | Rendered by                                  | Shell                                                      |
| ----------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `/video/abc` via Feed card click          | `@modal/(.)video/[id]/page.tsx`              | Overlay on top of live Feed; Feed scroll-locked, visible.  |
| `/video/abc` via deep link / reload       | `video/[id]/page.tsx`                        | Full-screen Theater; Feed not mounted.                     |

Both mount the same `<TheaterMode post={...} />` component. Only the wrapper
differs. In Spec 1 the modal wrapper is a plain
`fixed inset-0 z-50 bg-black/90` overlay — enough to verify the interception
behaviour. Spec 2 replaces that wrapper with a `motion.div` carrying
`layoutId`.

### 4.4. Scroll-lock with scrollbar-width compensation

New client component `components/chrome/scroll-lock-while-modal.tsx`
(~40 lines). Mounted inside the intercepted page. On mount it computes the
scrollbar width as `window.innerWidth - document.documentElement.clientWidth`
(the difference between the full viewport and the viewport minus the native
scrollbar track), then applies both `overflow: hidden` **and**
`padding-right: <scrollbarWidth>px` to `document.body` so the Feed grid does
not jerk when the native scrollbar disappears. If the measured width is
`0` (macOS overlay scrollbars, iOS Safari), both styles degrade to just
`overflow: hidden` — no padding. Both styles are restored on unmount.

### 4.5. Back-button semantics

Clicking the overlay backdrop or pressing `Esc` calls `router.back()`.
Next.js pops the intercepted route and the underlying `(consumption)/…`
tree stays mounted the whole time — scroll position and
`@tanstack/react-virtual` state are preserved by construction.

### 4.6. Entry-point audit (required)

Intercepting routes only fire on soft client-side navigations. Every Feed
entry point that opens Theater **must** use the Next.js `<Link>` component
or `router.push`. No native `<a href>`. Audit:

- `components/feed/feed-post-card.tsx` (`onOpen` callbacks).
- `components/feed/feed-grid.tsx`.
- `components/feed/global-search.tsx` (search-result click).
- `app/(creation)/profile/[username]/page.tsx` feed grids (when they link to
  Theater — verify they route through `/video/[id]`).
- `app/(consumption)/niche/[category]/page.tsx`.

Anywhere that opens Theater by *component mounting* (e.g.
`components/feed/theater-mode.tsx` used directly) stays untouched — those
are Spec 2's morph-source paths.

### 4.7. Z-index hierarchy (explicit)

- `<GlassIsland />`: `z-30` (sticky header).
- Intercepted modal overlay: `z-50` (Theater swallows the screen).
- Root `SaveBarrierOverlay`: `z-[60]` (must win over everything).

### 4.8. Acceptance criteria (§4)

1. **Deep-link test:** visiting `/video/<id>` directly renders the full-page
   version; no Feed grid is mounted.
2. **Navigation test:** clicking a card in `/home` updates the URL to
   `/video/<id>`; the Feed grid stays fully mounted and visible behind the
   overlay (verify via React DevTools tree inspection).
3. **Escape test:** clicking the backdrop or pressing `Esc` calls
   `router.back()`, dismisses the intercepting route, and releases the
   scroll lock — including removing the compensating `padding-right` from
   `document.body`.
4. **No scrollbar jump:** during open/close the Feed grid does not shift
   horizontally even by 1 px on a platform with a visible native scrollbar
   (Windows Chrome / Firefox).

---

## 5. Synapse Glass token layer

### 5.1. `@theme` block (in `app/globals.css`)

```css
@theme {
  /* ── Glass surfaces ──────────────────────────────────────────────
     Dark Apple base: neutral-900 at 42% opacity with a whispered
     white lift. OKLCH keeps the neutrals chromatically clean. */
  --color-glass-surface:        oklch(0.18 0.005 270 / 0.42);
  --color-glass-surface-strong: oklch(0.18 0.005 270 / 0.60);
  --color-glass-surface-ghost:  oklch(0.18 0.005 270 / 0.22);

  /* ── Hairlines & highlights ────────────────────────────────────── */
  --color-glass-hairline:       oklch(1 0 0 / 0.10);
  --color-glass-hairline-warm:  oklch(1 0 0 / 0.14);
  --color-glass-inner-lift:     oklch(1 0 0 / 0.05);

  /* ── Blur depths ──────────────────────────────────────────────── */
  --blur-glass:     16px;
  --blur-glass-xl:  24px;
  --blur-glass-2xl: 32px;

  /* ── Radii ─────────────────────────────────────────────────────── */
  --radius-island: 9999px;
  --radius-card:   16px;

  /* ── Shadows ──────────────────────────────────────────────────── */
  --shadow-glass-ambient: 0 8px 32px -8px oklch(0 0 0 / 0.45);
  --shadow-glass-glow:    0 0 24px -4px oklch(0.7 0 0 / 0.08);
}
```

### 5.2. `@layer components` utilities

```css
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
```

### 5.3. Usage rule

Components compose utilities directly. No `<GlassSurface>` / `<GlassPill>`
React wrappers. Example (illustrative — no Spec 1 call-site changes
required):

```tsx
<div className="glass-pill px-5 py-2.5 text-sm text-white/90">…</div>
```

---

## 6. Glass Island header

### 6.1. Component shape

- **File:** `components/chrome/glass-island.tsx` (~180 lines).
- **Usage:** rendered by `app/(consumption)/layout.tsx` as the only element
  above `{children}`.
- **Client component** (needs `usePathname`, scroll listener, `useUserStore`).
- **Props:** none. Reads route + user state from hooks.

### 6.2. Expanded and compressed states

Expanded:
```
┌──────────────────────────────────────────────────────────────┐
│  [SYNAPSE]   Home  Browse  Niche  Vault   [ 🔍 ]  [Profile]  │
└──────────────────────────────────────────────────────────────┘
```

Compressed:
```
    ┌──────────────────────────┐
    │  [S]  Home  Browse  [🔍] │
    └──────────────────────────┘
```

- Wordmark: full in expanded, single-letter in compressed.
- Search: full input in expanded, icon-only in compressed.
- Nav links: always visible; subdued colour in compressed.
- Secondary links (Profile avatar): visible in expanded, hidden in
  compressed.
- Wrapper classes: `glass-pill px-5 py-3` expanded, `glass-pill px-3.5 py-1.5`
  compressed.
- Layout: `position: sticky; top: 1rem;` with
  `width: min(calc(100% - 2rem), 72rem); margin-inline: auto;`.

### 6.3. Nav items

Five items in the Sidebar today: Home, Browse, Studio, Profile, Login.
Consumption surfaces should not advertise creation chrome — so the Glass
Island shows **Home, Browse, Niche, Vault** as primary links, plus an avatar
menu that includes Studio, Profile, and Login. Search sits between the nav
links and the avatar.

### 6.4. Animation

Framer Motion's `layout` prop on a single `motion.nav` element — the library
measures before/after DOM sizes and interpolates width/padding/border-radius
automatically. No manual keyframes. Transition:
`{ type: "spring", stiffness: 380, damping: 36, mass: 0.9 }`.

`useReducedMotion()` disables the spring and substitutes a 120 ms opacity
fade for the size transition.

### 6.5. Scroll-hysteresis hook

**File:** `components/chrome/use-glass-island-state.ts` (~70 lines).

**Constants:**
```ts
const HYSTERESIS_PX = 20;   // minimum sustained directional delta to flip
const FLOOR_PX      = 8;    // always-expanded zone near the top
```

**Algorithm:**

1. Track `lastY` (previous `scrollTop`) and `accumulator` (signed running
   sum of deltas in the current direction).
2. On each scroll event, coalesce via **the project's Master Clock**
   (`registerTickCallback`) — *not* `requestAnimationFrame`. The hook sets a
   dirty flag on the scroll listener; the tick callback reads the flag and
   runs the math once per frame, then clears it. This preserves the project
   invariant "no logic-driven rAF" (CLAUDE.md invariant #4) by routing all
   motion through the Master Clock.
3. Near-top override: if `scrollTop ≤ FLOOR_PX`, force `compressed = false`
   and reset `accumulator = 0`. This guarantees the header is always
   expanded at the top of the page regardless of momentum state.
4. Sign-change reset: when `Math.sign(delta) !== Math.sign(accumulator)` and
   `accumulator !== 0`, reset `accumulator = delta`. This is the hysteresis:
   a user who scrolls 15 px down then 5 px up sees no state change.
5. Clamp after flip: when `accumulator` reaches `±HYSTERESIS_PX`, clamp it
   there so the *first* pixel of an upscroll after a 200 px downscroll
   immediately counts toward the expand threshold, instead of needing to
   unwind 200 px of accumulated debt.
6. Use functional `setCompressed(c => …)` updates with an identity check
   (`c => (c ? c : true)`) so redundant updates never trigger a re-render.

**Pseudocode:**

```ts
const HYSTERESIS_PX = 20;
const FLOOR_PX      = 8;

export function useGlassIslandState(scrollRef: RefObject<HTMLElement>) {
  const [compressed, setCompressed] = useState(false);
  const lastY       = useRef(0);
  const accumulator = useRef(0);
  const dirty       = useRef(false);

  useEffect(() => {
    const el = scrollRef.current ?? document.documentElement;
    const onScroll = () => { dirty.current = true; };

    const tickId = registerTickCallback(() => {
      if (!dirty.current) return;
      dirty.current = false;

      const y = el.scrollTop;
      const delta = y - lastY.current;
      lastY.current = y;

      if (y <= FLOOR_PX) {
        accumulator.current = 0;
        setCompressed((c) => (c ? false : c));
        return;
      }

      if (Math.sign(delta) !== Math.sign(accumulator.current)
          && accumulator.current !== 0) {
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

### 6.6. Mobile

At viewport width `< 640 px` the Island is always in the compressed form and
the scroll listener short-circuits (no accumulator math). Horizontal padding
on the outer wrapper collapses to `mx-3`.

### 6.7. Acceptance criteria (§6)

1. **Hysteresis math:** scroll 10 px down, 5 px up, 8 px down → Island stays
   expanded. Scroll 25 px sustained down → compresses within one frame.
   Scroll 25 px sustained up → expands within one frame.
2. **Near-top override:** at `scrollTop ≤ 8` the Island is always expanded,
   regardless of accumulator state.
3. **No layout thrash:** Chrome DevTools Performance panel shows ≤ 1 layout
   per scroll transition; no forced-reflow warnings.
4. **Firefox fallback:** with `backdrop-filter` disabled the Island renders
   with a solid dark fill and readable text.
5. **Reduced motion:** `prefers-reduced-motion: reduce` disables the spring;
   state still toggles but snaps instead of animating.
6. **Mobile:** at `< 640 px` the Island is always compressed; no scroll
   listener runs.
7. **Reachability:** the compressed Island does not functionally obscure the
   top row of the content grid. Content passes under the glass visually, but
   the first interactive element in the grid is tappable without the header
   intercepting the touch. Enforced by the consumption layout's top padding
   (`pt-[calc(1rem+var(--island-height-compressed))]` on the inner
   content wrapper).

---

## 7. Heat Tier data pipeline

### 7.1. Types

In `lib/store/feed-store.ts`:

```ts
export type HeatTier = "warm" | "hot" | "trending";

export interface FeedPost {
  // …existing fields unchanged
  /** Derived, pool-relative, computed client-side at store hydration.
   *  NEVER sent over the wire; NEVER in the Zod schema; NEVER in IDB. */
  heatTier?: HeatTier;
}
```

Optional by type so a `FeedPost` freshly parsed from the Zod schema (before
enrichment) is still a valid `FeedPost`. In practice the store only holds
enriched posts.

### 7.2. Schema discipline (CLAUDE.md invariant #1)

`lib/schema.ts` **does not** add `heatTier` to any Zod schema. `.strip()` on
`FeedPostSchema` silently discards any forged `heatTier` field in untrusted
ingress. The flow:

```
untrusted JSON → FeedPostSchema.parse() → FeedPost (no tier)
                                             ↓
                                 enrichWithHeatTiers(posts)
                                             ↓
                                  store holds FeedPost + tier
```

Any code path that serializes `FeedPost` (e.g. `lib/store/feed-idb.ts`)
strips `heatTier` before writing and tolerates its presence/absence on
read.

### 7.3. Math (`lib/social.ts` additions)

```ts
// Absolute floors — prevent tiny/idle pools from tier-ing noise.
// Velocity unit: engagement-per-hour since publish (from getVelocityScore).
const FLOOR_WARM     = 5;
const FLOOR_HOT      = 20;
const FLOOR_TRENDING = 50;

// Pool percentile cuts.
const PCT_WARM     = 0.20;
const PCT_HOT      = 0.05;
const PCT_TRENDING = 0.01;

export interface HeatThresholds {
  warm:     number;
  hot:      number;
  trending: number;
}

/** One pass over the pool → the three cut values. Sort once. */
export function computeHeatThresholds(
  pool: readonly FeedPost[],
  now: number = Date.now(),
): HeatThresholds { /* … */ }

/** Tier for a single post given pre-computed thresholds. Pure. */
export function tierFor(
  velocity: number,
  t: HeatThresholds,
): HeatTier | undefined { /* … */ }

/** Batch: attach heatTier to every post against one shared threshold set.
 *  Returns a new array (no in-place mutation).
 *
 *  TODO(spec-2+): the `now` parameter is the hook for time-decay math —
 *  e.g. penalise velocity scores for posts older than N days so the feed
 *  stays fresh instead of tier-cementing ancient virality. Keep this signature
 *  stable so the future decay factor can be slotted in without touching
 *  callers. */
export function enrichWithHeatTiers(
  pool: readonly FeedPost[],
  now: number = Date.now(),
): FeedPost[] { /* … */ }
```

`isHot(post, pool)` is kept as a thin shim:

```ts
export function isHot(post: FeedPost, pool: readonly FeedPost[], now = Date.now()): boolean {
  if (post.heatTier) return post.heatTier === "hot" || post.heatTier === "trending";
  const t = computeHeatThresholds(pool, now);
  const v = getVelocityScore(post, now);
  const tier = tierFor(v, t);
  return tier === "hot" || tier === "trending";
}
```

This keeps the existing amber "Hot" badge call in `FeedPostCard`
(`pool && isHot(post, pool) && …`) working unchanged through Spec 1. Spec 2
replaces that call site with `post.heatTier`-driven 3-tier visuals.

### 7.4. Enrichment triggers (`lib/store/feed-store.ts`)

```ts
setFeed: (posts: FeedPost[]) => {
  set({ posts: enrichWithHeatTiers(posts) });
},

addPost: (post: FeedPost) => {
  set((state) => ({ posts: enrichWithHeatTiers([...state.posts, post]) }));
},

removePost: (id: string) => {
  set((state) => ({
    posts: enrichWithHeatTiers(state.posts.filter((p) => p.id !== id)),
  }));
},
```

**Like-toggling does not re-enrich.** Rationale: likes are high-frequency
input. Recomputing the whole pool per like would waste CPU and produce
jarring tier flicker ("I just liked this post and it became Trending"). Tiers
refresh only on genuine feed loads. This preserves the "milestone" feel of
earning a tier.

### 7.5. Pool definition

The pool is **global, not page-relative** — the set of all posts currently
in `feedStore.posts`. A post displayed on `/home` and on `/niche/hypno` has
the same `heatTier`. Filtering a subset of the feed for a niche/creator view
never changes tiers for posts in that subset.

### 7.6. File-size guard

`lib/store/feed-store.ts` currently sits near the 900-line cap. If the
HeatTier additions push it past the cap at build time, extract
`enrichWithHeatTiers` wrapping to a new `lib/store/feed-heat.ts` and have
the store import it. This is an in-build judgment call; do not modify the
spec to re-consult.

### 7.7. Views-in-last-hour fast path

The spec mentioned a "Trending: top 1% velocity **or** > X views in the
last hour" condition. Today there is no `viewsLastHour` field on `FeedPost`
and no view-tracking pipeline. Spec 1 implements velocity-percentile only.
Spec 2 follow-up: once the view pipeline lands, extend `tierFor` to
force-upgrade to `"trending"` when `post.viewsLastHour >= X`, documented in
the known-gaps section of this spec.

### 7.8. Acceptance criteria (§7)

1. **Determinism:** `enrichWithHeatTiers(pool, now)` run twice on the same
   input produces byte-identical output.
2. **Page-agnostic tiers:** a given post has the same `heatTier` when
   rendered under `/home` and under `/niche/hypno` (verify via React
   DevTools).
3. **Schema guard:** ingressing JSON with a forged `heatTier: "trending"`
   field through `FeedPostSchema.parse` yields `heatTier === undefined`.
4. **No render-time compute:** React Profiler shows zero time in
   `enrichWithHeatTiers` during scroll, hover, or like-toggle. Only
   `setFeed` / `addPost` / `removePost` trigger enrichment.
5. **Backward compat:** the existing `isHot(post, pool)` call in
   `FeedPostCard` still lights the amber badge for posts newly ranked hot
   or trending.
6. **IDB/cloud cleanliness:** `heatTier` does not appear in any IndexedDB
   record or cloud-synced payload (verified via DevTools → Application →
   IndexedDB and network log inspection).
7. **Divide-by-zero guard:** a post with `createdAt` within a few seconds of
   `now` never produces `NaN` or `Infinity` velocity. `getVelocityScore`
   already enforces `HOT_MIN_AGE_MS` and a denominator floor; extend tests
   to assert this for freshly-uploaded posts at the exact boundary and one
   second below.

---

## 8. Cross-cutting guardrails (merge-blocking)

Phase 4 is enforced as acceptance gates on Spec 1 *and* Spec 2. Spec 1 does
not ship unless all five pass.

### 8.1. `prefers-reduced-motion`

`useReducedMotion()` is read inside `<GlassIsland />` (and every future
`motion.*` component added in Spec 2). When `true`, the spring transition is
replaced with a 120 ms opacity fade for the compress/expand size change. A
small shared helper `components/chrome/use-glass-motion.ts` (~15 lines)
returns the correct transition object so Spec 2 inherits the same guard
without duplication.

### 8.2. `prefers-reduced-transparency`

Handled entirely in CSS via a media query on `.glass-surface` (see §5.2).
Applies everywhere glass is used — no per-component wiring.

### 8.3. 60fps target + adaptive hardware degradation

- **Target:** median scroll frame ≤ 16 ms on mid-tier hardware (Apple M1,
  mid-range Android).
- **Probe:** a new `components/chrome/glass-capability.ts` (~30 lines)
  reads `navigator.deviceMemory` and `navigator.hardwareConcurrency` once
  on mount and sets `data-glass-tier` on `<body>` to `"full"` or
  `"reduced"`. Heuristic: `deviceMemory < 4 || hardwareConcurrency < 4`
  ⇒ `"reduced"`.
- **CSS consumes the attribute:**
  ```css
  body[data-glass-tier="reduced"] .glass-surface {
    backdrop-filter: blur(8px);
    box-shadow: none;
  }
  ```

### 8.4. Focus-visible clarity on glass

In `globals.css`:

```css
.glass-surface :focus-visible {
  outline: 2px solid oklch(1 0 0 / 0.7);
  outline-offset: 2px;
}
```

Tab order inside `<GlassIsland />`: wordmark → nav links left-to-right →
search → avatar.

### 8.5. Contrast

Text on `.glass-surface` defaults to `text-white/90` (AA+ against the
darkest supported video frame). Never go below `/85`. Covered by a new
Playwright test (see §9.3).

---

## 9. Testing strategy

### 9.1. Unit (vitest)

- `lib/social.test.ts` extensions:
  - `computeHeatThresholds` — empty pool, single post, all-zero velocities,
    large pool, floor enforcement, percentile boundaries.
  - `tierFor` — exact threshold boundaries (`=== warm` → `"warm"`;
    `=== warm − ε` → `undefined`).
  - `enrichWithHeatTiers` — determinism under identical `now`.
  - Divide-by-zero: posts with `createdAt` 0 / 1 / near-boundary seconds
    away from `now`.
- New `components/chrome/use-glass-island-state.test.ts` — pure-function
  test of hysteresis math by feeding synthetic scroll deltas into the hook
  (mock scroll target, mock `registerTickCallback`, drive the tick manually).

### 9.2. Integration (vitest)

- New `lib/store/feed-store.test.ts` cases:
  - `setFeed(mockPosts)` enriches posts with `heatTier`.
  - `addPost` re-enriches.
  - `removePost` re-enriches.
  - IDB-write paths strip `heatTier`.

### 9.3. End-to-end (Playwright, `npm run audit`)

- New `e2e/glass-island.spec.ts` — scroll 25 px down compresses; scroll
  25 px up expands; jitter under 20 px produces no state change;
  near-top override.
- New `e2e/consumption-creation-chrome.spec.ts` — `/home` has no
  `<aside>` sidebar; `/studio/dashboard` does.
- New `e2e/intercepting-route.spec.ts` — click Feed card updates URL
  without unmounting Feed (`data-testid` survives on the Feed grid);
  Esc/backdrop dismisses; scroll position preserved.
- New `e2e/glass-surface-contrast.spec.ts` — render Home with a pure-white
  image injected behind `<GlassIsland />`, run `axe-core`, assert no
  contrast violations.

### 9.4. Screenshot-diff baseline

Before the restructure branch lands, commit a screenshot-diff baseline PR
against `main` that captures the *current* `(creation)` route output. The
restructure branch then asserts pixel-perfect parity against that baseline
for `/studio/dashboard`, `/profile/<handle>`, `/projects`, `/upload`, and
`/session/<slug>`. Two merges, one spec.

---

## 10. File map

### 10.1. New files (14)

| Path | Purpose | Est. lines |
| --- | --- | ---: |
| `app/(consumption)/layout.tsx` | Glass Island + `{modal}` slot | 30 |
| `app/(consumption)/@modal/default.tsx` | `() => null` | 3 |
| `app/(consumption)/@modal/(.)video/[id]/page.tsx` | Intercepted Theater overlay | 45 |
| `app/(creation)/layout.tsx` | Left `<Sidebar />` + `ml-56` shell | 25 |
| `app/(auth)/layout.tsx` | Centered full-bleed | 20 |
| `components/chrome/glass-island.tsx` | Floating pill nav | 180 |
| `components/chrome/use-glass-island-state.ts` | Ticker-driven hysteresis hook | 70 |
| `components/chrome/use-glass-motion.ts` | Shared reduced-motion transition helper | 15 |
| `components/chrome/scroll-lock-while-modal.tsx` | Scroll-lock + scrollbar-width compensation | 40 |
| `components/chrome/glass-capability.ts` | Hardware-tier probe | 30 |
| `e2e/glass-island.spec.ts` | Hysteresis E2E | — |
| `e2e/consumption-creation-chrome.spec.ts` | Chrome-separation E2E | — |
| `e2e/intercepting-route.spec.ts` | Intercept E2E | — |
| `e2e/glass-surface-contrast.spec.ts` | Contrast audit | — |

### 10.2. Modified files (5)

| Path | Change | Δ lines |
| --- | --- | ---: |
| `app/layout.tsx` | Strip `<Sidebar />` + main offset; keep root providers | −10 |
| `app/globals.css` | `@theme` + `@layer components` utilities + fallbacks + `data-glass-tier` rules | +90 |
| `lib/social.ts` | `computeHeatThresholds`, `tierFor`, `enrichWithHeatTiers` + time-decay TODO; `isHot` shim | +85 |
| `lib/store/feed-store.ts` | `HeatTier` type + wrap `setFeed`/`addPost`/`removePost` (or extract to `feed-heat.ts` if cap reached) | +25 |
| `lib/store/feed-idb.ts` (+ any other `FeedPost` serializer) | Strip `heatTier` before write; tolerate on read | +10 |

### 10.3. Route relocations (content-identical moves)

```
app/page.tsx                  → app/(consumption)/page.tsx
app/home/page.tsx             → app/(consumption)/home/page.tsx
app/browse/page.tsx           → app/(consumption)/browse/page.tsx
app/explore/page.tsx          → app/(consumption)/explore/page.tsx
app/niche/…                   → app/(consumption)/niche/…
app/gallery/page.tsx          → app/(consumption)/gallery/page.tsx
app/vault/page.tsx            → app/(consumption)/vault/page.tsx
app/video/[id]/…              → app/(consumption)/video/[id]/…
app/studio/…                  → app/(creation)/studio/…
app/profile/…                 → app/(creation)/profile/…
app/projects/page.tsx         → app/(creation)/projects/page.tsx
app/upload/page.tsx           → app/(creation)/upload/page.tsx
app/session/[slug]/…          → app/(creation)/session/[slug]/…
app/login/page.tsx            → app/(auth)/login/page.tsx
```

### 10.4. Line-budget check (900-line cap, CLAUDE.md)

| File | Existing | After change | Under cap |
| --- | ---: | ---: | :---: |
| `lib/social.ts` | ~102 | ~187 | ✅ |
| `lib/store/feed-store.ts` | verify during build | +25 | verify |
| `components/chrome/glass-island.tsx` | new | ~180 | ✅ |
| `components/feed/feed-post-card.tsx` | 490 | unchanged | ✅ |
| `components/feed/theater/TheaterUI.tsx` | 369 | unchanged | ✅ |

If `feed-store.ts` approaches the cap, extract to `lib/store/feed-heat.ts`
per §7.6.

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Route-group move breaks hardcoded paths in e2e tests | Medium | URLs don't change (groups invisible). Grep for file-path references in test imports. |
| Intercepting route conflicts with an unknown existing `/video/[id]` query-string pattern | Low | `video/[id]/page.tsx` still exists for direct visits; behaviour identical on reload/share. |
| `backdrop-filter` causes scroll jank on a specific machine | Medium | §8.3 degrades blur depth and removes glow shadow via `data-glass-tier="reduced"`. Fallback is solid fill, not a crash. |
| `feed-store.ts` overflows 900-line cap after HeatTier additions | Low | §7.6: extract to `lib/store/feed-heat.ts`. |
| Sidebar removal from `app/layout.tsx` accidentally removes from `(creation)` routes | Low | `app/(creation)/layout.tsx` re-adds it; `app/(creation)/profile/[username]/layout.test.ts` catches regression. |
| Ticker-driven hysteresis feels laggier than raw rAF | Medium | Measure during build; if perceivable, fall back to `requestAnimationFrame` and document the deviation here. The invariant is for *logic* rAF; a scroll-coalescer is a gray area that can be revisited with data. |
| Scrollbar-width compensation breaks on browsers reporting zero for `clientWidth` difference | Low | Use `window.innerWidth - document.documentElement.clientWidth` as fallback; no-op if both return 0 (e.g. overlay scrollbars on macOS). |

---

## 12. Acceptance gate (Spec 1 done criteria)

All of the following must be green before merge:

1. All section-level acceptance criteria in §§3–8 pass in CI.
2. No file exceeds 900 lines.
3. No `requestAnimationFrame` added outside the whitelisted library
   wrappers — hysteresis uses `registerTickCallback`.
4. No `heatTier` field is serialized to IndexedDB or any network payload
   (verified via DevTools Application tab + network log inspection).
5. `prefers-reduced-motion` and `prefers-reduced-transparency` are respected
   on `/`, `/home`, `/browse`, `/explore`, `/niche/*`, `/vault`, `/gallery`,
   and direct `/video/[id]` visits.
6. Chrome DevTools Performance recording on `/home` shows median scroll
   frame ≤ 16 ms on a throttled "Fast 3G / 4× CPU slowdown" profile.
7. `(creation)` routes render byte-identically to their current
   pre-restructure output (screenshot-diff test passes against the baseline
   committed in the prior PR).
8. `npm run lint && npm test && npm run audit` all green.

---

## 13. Known gaps / Spec-2 inputs

- **3-tier heat visuals** consume `post.heatTier` from §7. Spec 2 maps
  `"warm"` → amber hairline pulse, `"hot"` → orange-pink neon + flame icon,
  `"trending"` → electric-pink (#ff007a) neon pulse + flame + LIVE chip.
- **`layoutId` morphs** mount inside `@modal/(.)video/[id]/page.tsx` from
  §4; the Spec-1 plain overlay wrapper is replaced with a `motion.div`
  carrying `layoutId={post.id}`. The feed card's thumbnail container gets
  the same `layoutId`. Morph the *poster image*, not the active `<video>`
  element, to avoid GPU stutter.
- **Views-in-last-hour fast path** (§7.7) depends on a view-tracking
  pipeline that does not exist in Spec 1.
- **Mobile glass bottom-bar** deferred per scope decision; add a second
  scroll-aware consumer once Spec 1 stabilises.
