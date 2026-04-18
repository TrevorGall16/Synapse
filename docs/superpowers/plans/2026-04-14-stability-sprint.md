# Stability Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive `npm run lint` to zero errors, lock effect parity across Studio/Hover/Theater with automated + manual evidence, guard scrub/playback behavior with regression tests + dev-only churn counters, and make `npm run build` deterministic offline.

**Architecture:** No new surfaces. We repair existing code: `lib/utils/preview-helpers.ts` (`buildFxFilter`) is already the shared effect core used by all three surfaces (`components/studio/preview-monitor.tsx`, `components/feed/feed-post-card.tsx`, `components/feed/theater/TheaterPlayer.tsx`) — we expand the parity test to pin that invariant, and add a dev-only churn counter to `TheaterPlayer` to detect `v.src`/playhead-reset regressions. Lint cleanup is mechanical (React 19 strict-hooks rules). Build is hardened by swapping `next/font/google` for `next/font/local` with a vendored Geist binary.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Vitest 4 (unit), Playwright 1.58 (e2e), ESLint 9 + `eslint-config-next@16.1.6`.

**Baseline at start (2026-04-14):**
- `npm run lint` → **48 errors, 61 warnings**. Error buckets: `react-hooks/rules-of-hooks` (16), `react-hooks/refs` (13), `react-hooks/set-state-in-effect` (12), `react-hooks/immutability` (3), `react-hooks/purity` (2), `react-hooks/preserve-manual-memoization` (2).
- `npm run test` → existing parity tests in `lib/utils/effect-parity.test.ts` and seek tests in `lib/utils/theater-seek.test.ts` are green.

**Rules of engagement (from the ask):** No unrelated feature additions. Small reviewable commits — after each commit, note hash + files + tests run + risk.

---

## File Structure

### Files touched for P0 #1 (Lint burn-down)

**rules-of-hooks (conditional hooks) — 16 errors:**
- `components/studio/pan-crop-window.tsx` (13 errors) — hooks called after an early return at/around line 74. Lift the guard so all hooks run unconditionally.
- `app/profile/[username]/page.tsx` (2 errors at lines 566, 591) — two `useCallback`s after a conditional `return`.
- `e2e/fixtures/audit-page.ts` (1 error at line 256) — `auditPage` is a Playwright fixture, not a component/hook; rename variable it calls `useFixture` (if genuine hook misuse) OR add a scoped ESLint disable with a `Why:` comment. This is a fixture file, not React code — the rule is misfiring.

**refs (ref read/write during render) — 13 errors:**
- `components/timeline/timeline-ruler.tsx:53–57` — container ref read during render. Hoist scroll/client measurements into a `useLayoutEffect` + `useState`, OR use a `useSyncExternalStore` that subscribes to `scroll`/`resize`.
- `lib/hooks/use-global-tick.ts:32` — `cbRef.current = callback` in render. Move the assignment into a `useEffect` (standard "latest callback" pattern).
- `components/studio/audio-mixer.tsx:163, 165` — `isPlayingRef.current = …` in render. Move into `useEffect`.
- `components/studio/preview-fx-mask-overlay.tsx:64+` — ref read during render. Read inside `useEffect`/event handlers.
- `components/timeline/clip-event.tsx:310–367` (3 errors under this bucket flagged `immutability`) — modifying elements inside a ref array passed to a hook. See Task 1c.

**set-state-in-effect — 12 errors:**
- `app/page.tsx:212`, `components/feed/feed-post-card.tsx:104`, `components/feed/global-search.tsx:121`, `components/feed/share-sheet.tsx:82`, `components/feed/theater-mode.tsx:78, 104`, `components/feed/video-preview-card.tsx:119`, `components/studio/focused-breadcrumb.tsx:24`, `components/studio/preset-panel.tsx:143`, `lib/hooks/use-lazy-media-hydration.ts:34`, `lib/hooks/use-media-pool-url.ts:47`.
- Pattern: each one either (a) derives state from props (fix: compute during render), (b) resets state on prop change (fix: use `key` prop or `useReducer`), or (c) hydrates from an async source (fix: keep the effect but gate the `setState` behind the external resolution — already correct — the rule fires because the `setState` isn't inside an async callback; we can silence these by moving the setState behind the real async result, or add a targeted `// eslint-disable-next-line react-hooks/set-state-in-effect -- Why: …` where the pattern is genuinely correct sync-after-async).

**immutability — 3 errors:**
- `components/timeline/clip-event.tsx:307, 311, 367` — iterating `groupedElsRef.current` and mutating `m.el.style` is the rule firing on "modifying a value passed to a hook." Because `el` is a DOM node (not React state), this is a false positive in spirit, but the lint wants ref-derived mutations funneled through an effect. Fix: move the mutation block into a `useLayoutEffect`/event handler that doesn't pass the ref to a hook directly; or rewrite to read `groupedElsRef.current` into a local `const arr = groupedElsRef.current` and mutate through `arr`.

**purity — 2 errors:**
- `app/explore/page.tsx:350` — `Date.now()` in the body of an event handler's callback that happens to be called during render. Replace with a ref-backed timestamp set in `useEffect` or push to a `useRef<() => number>` holder.
- `components/feed/theater/comments-drawer.tsx:60` — `useState(Date.now())` initializer. Swap for `useState<number>(0)` + `useEffect(() => setTick(Date.now()), [])`.

**preserve-manual-memoization — 2 errors:** (counted under warnings, but if they surface as errors under React 19 strict mode, bucket here.) Address opportunistically during the related-file fix.

### Files touched for P0 #2 (Parity harness expansion)

- `lib/utils/effect-parity.test.ts` — already covers Studio↔Theater byte parity for 5 effects + multi-stack. ADD: an import-site assertion that the three surface files all import `buildFxFilter` from the same path (prevents drift via alternative-copy regressions).
- `lib/utils/fx-surface-audit.ts` — **NEW**. A tiny module that exports a list of canonical surface files and the symbol each must import. Used only by the parity test. Zero runtime cost.
- `docs/qa/effect-parity-manual.md` — **NEW**. Manual QA script: reproduce the 5-effect + hypno fixture, checklist for Studio / Hover / Theater with pass/fail evidence table.
- `e2e/effect-parity.spec.ts` — **NEW**. Playwright spec that loads a published fixture post in Theater mode, waits for playback, and snapshots computed `filter` on the video element at a fixed playhead. Compares against the Studio-side `buildFxFilter` result for the same clips+time. Thin — runs one deterministic frame.

### Files touched for P0 #3 (Scrub + playback non-regression guard)

- `lib/utils/theater-seek.test.ts` — already covers pure math. ADD: assertions for "seek while paused and seek while playing produce the same `SeekTarget`" (pin the helper has no branch on state).
- `components/feed/theater/TheaterPlayer.tsx` — ADD a dev-only counter block (guarded by `process.env.NODE_ENV !== 'production'`): increment counters on (a) any `v.src` assignment, (b) any `v.currentTime` write during a continuous pointer-drag session, and (c) unexpected `playhead → 0` resets while the seek loop is active. Expose on `window.__synapseChurn` as a plain object for test inspection.
- `e2e/theater-seek.spec.ts` — **NEW**. Playwright: open a published fixture, scrub the bar continuously for ~1.5s via pointer events, then read `window.__synapseChurn` and assert `srcReloadCount === 0` and `playheadResetCount === 0` during drag.

### Files touched for P1 #4 (Build hardening)

- `app/layout.tsx` — remove `import { Geist, Geist_Mono } from "next/font/google"`. Replace with `next/font/local` referencing vendored `.woff2` files under `public/fonts/`.
- `public/fonts/geist-sans.woff2`, `public/fonts/geist-mono.woff2` — vendored Geist binaries (MIT-licensed; fetch once and commit).
- `docs/build-strategy.md` — **NEW**. Short note: rationale, vendoring procedure, license attribution, rollback plan.

### Files touched for P1 #5 (Shared effect core — validation, not refactor)

The extraction is already done (`buildFxFilter` is canonical). P1 #5 reduces to **validation**:
- Run parity tests from P0 #2.
- Grep the repo for any inline effect math outside `lib/utils/preview-helpers.ts` and `lib/utils/hypno-overlay.ts` (those are the only two allowed homes). Add a test that asserts this (similar to the surface-audit idea) if any drift is found.

---

## Task 0: Create a work branch and baseline

**Files:**
- None modified — this task sets up the environment.

- [ ] **Step 0.1: Confirm working-tree is clean or intentionally dirty**

```bash
git status --short
```

Expected: three pre-existing modified files (`.claude/settings.local.json`, `components/timeline/clip-filmstrip.tsx`, `e2e/fixtures/audit-page.ts`). Leave them alone — they are unrelated to this sprint.

- [ ] **Step 0.2: Capture a lint baseline snapshot**

```bash
npm run lint 2>&1 | tee /tmp/lint-baseline.txt
grep -oE "react-hooks/[a-z-]+" /tmp/lint-baseline.txt | sort | uniq -c | sort -rn > /tmp/lint-baseline-counts.txt
cat /tmp/lint-baseline-counts.txt
```

Expected (2026-04-14): 16 rules-of-hooks, 13 refs, 12 set-state-in-effect, 12 exhaustive-deps, 3 immutability, 2 purity, 2 preserve-manual-memoization. Total error header: "48 errors, 61 warnings".

- [ ] **Step 0.3: Capture a test baseline**

```bash
npm run test 2>&1 | tail -30
```

Expected: all existing vitest suites pass, including `effect-parity.test.ts` and `theater-seek.test.ts`.

---

## Task 1: Lint burn-down — `react-hooks/rules-of-hooks`

Biggest concentration: `components/studio/pan-crop-window.tsx`. Fix the pattern once; the other two sites follow the same shape.

### Task 1a: `components/studio/pan-crop-window.tsx`

**Files:**
- Modify: `components/studio/pan-crop-window.tsx:74–211`

- [ ] **Step 1a.1: Read the file around line 74 to locate the early-return guard**

Run: `Read components/studio/pan-crop-window.tsx offset 60 limit 160`.
Look for a pattern like:
```tsx
if (!activePoints) return null;   // <-- early return
const doThing = useCallback(...); // <-- hooks below fire conditionally
```

- [ ] **Step 1a.2: Lift all hooks above the early return**

Rewrite so every `useRef`/`useCallback`/`useMemo` runs unconditionally at the top of the component. The guard moves to a render-only short-circuit at the end:
```tsx
// ALL hooks here, unconditionally. Use nullable inputs where needed.
const ref1 = useRef<HTMLElement | null>(null);
const handlerA = useCallback(() => { if (!activePoints) return; /* ... */ }, [activePoints]);
// ...more hooks...

// Now the early-render bailout:
if (!activePoints) return null;

return (/* JSX */);
```

- [ ] **Step 1a.3: Run the lint scoped to this file**

```bash
npx eslint components/studio/pan-crop-window.tsx
```

Expected: 0 errors in this file (warnings on `exhaustive-deps` for `activePoints` are OK to leave; they downgrade once the conditional is gone).

- [ ] **Step 1a.4: Run the vitest suite to confirm no behavior change**

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 1a.5: Commit**

```bash
git add components/studio/pan-crop-window.tsx
git commit -m "lint(pan-crop): lift all hooks above the activePoints guard (rules-of-hooks)"
```

### Task 1b: `app/profile/[username]/page.tsx`

**Files:**
- Modify: `app/profile/[username]/page.tsx:566, 591`

- [ ] **Step 1b.1: Read the file around lines 560–600**

Identify the conditional that precedes the two `useCallback` calls.

- [ ] **Step 1b.2: Lift both `useCallback`s above the conditional return**

Same pattern as 1a. If the conditionals depend on values unknown at that point, compute nullable inputs; the callbacks can early-return internally.

- [ ] **Step 1b.3: Scoped lint + test**

```bash
npx eslint app/profile/[username]/page.tsx
npm run test
```

- [ ] **Step 1b.4: Commit**

```bash
git add app/profile/[username]/page.tsx
git commit -m "lint(profile): unconditionalize useCallback calls (rules-of-hooks)"
```

### Task 1c: `e2e/fixtures/audit-page.ts`

**Files:**
- Modify: `e2e/fixtures/audit-page.ts:256`

- [ ] **Step 1c.1: Read around line 256**

`auditPage` is a Playwright fixture factory. It calls a function named `useFixture` which the React rule mistakenly thinks is a React hook. Confirm it's genuinely Playwright code.

- [ ] **Step 1c.2: Prefer renaming locally, else scope-disable**

If the call is to a helper we own named `useFixture`, rename it to `acquireFixture` in both the definition and the call site. If it's from Playwright (`@playwright/test`'s `test.extend`), add a precise disable with rationale:
```ts
// eslint-disable-next-line react-hooks/rules-of-hooks -- Why: Playwright fixture API, not a React hook
const page = await useFixture(…);
```

- [ ] **Step 1c.3: Scoped lint**

```bash
npx eslint e2e/fixtures/audit-page.ts
```

Expected: 0 errors for this file.

- [ ] **Step 1c.4: Commit**

```bash
git add e2e/fixtures/audit-page.ts
git commit -m "lint(e2e): distinguish Playwright fixtures from React hooks"
```

---

## Task 2: Lint burn-down — `react-hooks/refs`

### Task 2a: `lib/hooks/use-global-tick.ts`

**Files:**
- Modify: `lib/hooks/use-global-tick.ts:30–36`

- [ ] **Step 2a.1: Move the ref assignment into an effect**

Replace:
```ts
const cbRef = useRef<TickCallback>(callback);
cbRef.current = callback;

useEffect(() => {
  const id = registerTickCallback((ts) => cbRef.current(ts));
  return () => unregisterTickCallback(id);
}, []);
```

With:
```ts
const cbRef = useRef<TickCallback>(callback);
useEffect(() => { cbRef.current = callback; }, [callback]);

useEffect(() => {
  const id = registerTickCallback((ts) => cbRef.current(ts));
  return () => unregisterTickCallback(id);
}, []);
```

- [ ] **Step 2a.2: Scoped lint + test**

```bash
npx eslint lib/hooks/use-global-tick.ts
npm run test
```

- [ ] **Step 2a.3: Commit**

```bash
git add lib/hooks/use-global-tick.ts
git commit -m "lint(use-global-tick): move callback ref write into effect (refs)"
```

### Task 2b: `components/studio/audio-mixer.tsx:163–166`

**Files:**
- Modify: `components/studio/audio-mixer.tsx:163–166`

- [ ] **Step 2b.1: Apply the same latest-ref pattern**

Wrap both `isPlayingRef.current = isPlaying` and `volumeRef.current = volume` in `useEffect(() => { /* assign */ }, [isPlaying|volume])`.

- [ ] **Step 2b.2: Scoped lint + test + commit**

```bash
npx eslint components/studio/audio-mixer.tsx
npm run test
git add components/studio/audio-mixer.tsx
git commit -m "lint(audio-mixer): sync refs in effects, not render (refs)"
```

### Task 2c: `components/timeline/timeline-ruler.tsx:53–57`

**Files:**
- Modify: `components/timeline/timeline-ruler.tsx:40–80`

- [ ] **Step 2c.1: Replace render-time ref reads with a subscription**

Strategy: use `useSyncExternalStore` or `useState` + `useLayoutEffect` that subscribes to `scroll`/`resize` on `scrollContainerRef.current`. Store `scrollLeft` and `clientWidth` in React state and compute ticks from those.

Sketch:
```tsx
const [metrics, setMetrics] = useState({ scrollLeft: 0, viewWidth: totalWidth });
useLayoutEffect(() => {
  const container = scrollContainerRef.current;
  if (!container) return;
  const update = () => setMetrics({ scrollLeft: container.scrollLeft, viewWidth: container.clientWidth });
  update();
  container.addEventListener("scroll", update, { passive: true });
  const ro = new ResizeObserver(update);
  ro.observe(container);
  return () => { container.removeEventListener("scroll", update); ro.disconnect(); };
}, [scrollContainerRef]);
const { scrollLeft, viewWidth } = metrics;
const startSec = Math.max(0, Math.floor(scrollLeft / pixelsPerSecond / tickInterval) * tickInterval);
const endSec = Math.min(totalSeconds, (scrollLeft + viewWidth) / pixelsPerSecond + tickInterval);
```

- [ ] **Step 2c.2: Scoped lint + test**

```bash
npx eslint components/timeline/timeline-ruler.tsx
npm run test
```

- [ ] **Step 2c.3: Manually verify ruler in dev**

```bash
npm run dev
```
Open `http://localhost:3000/studio` (or wherever the ruler shows), scroll the timeline, confirm ticks still update. Record in PR body.

- [ ] **Step 2c.4: Commit**

```bash
git add components/timeline/timeline-ruler.tsx
git commit -m "lint(timeline-ruler): subscribe to scroll/resize instead of reading ref in render"
```

### Task 2d: `components/studio/preview-fx-mask-overlay.tsx`

**Files:**
- Modify: `components/studio/preview-fx-mask-overlay.tsx` around line 64

- [ ] **Step 2d.1: Move ref reads into `useEffect`**

If the ref value is used to compute render output, lift into state via subscription (as in Task 2c). If it's used only inside a later `useEffect`/handler, just move the line.

- [ ] **Step 2d.2: Scoped lint + test + commit**

```bash
npx eslint components/studio/preview-fx-mask-overlay.tsx
npm run test
git add components/studio/preview-fx-mask-overlay.tsx
git commit -m "lint(preview-fx-mask-overlay): read refs outside render (refs)"
```

---

## Task 3: Lint burn-down — `react-hooks/immutability` (clip-event.tsx)

**Files:**
- Modify: `components/timeline/clip-event.tsx:307, 311, 367`

- [ ] **Step 3.1: Read the surrounding drag/group code (lines 290–380)**

Understand what `groupedElsRef.current` holds (sibling DOM entries with `el`, `prevTransition`, `originMicros`). The rule fires because the array is passed to a hook closure, and we mutate an element inside it during render.

- [ ] **Step 3.2: Refactor to pull the array into a local, then mutate through the local**

Replace:
```ts
for (const m of groupedElsRef.current) {
  const sibPx = timeMicrosToTimelinePx(m.originMicros, pixelsPerSecond);
  m.el.style.transform = `translate3d(${sibPx}px, 0, 0)`;
  m.el.style.transition = m.prevTransition ?? "";
}
```

With:
```ts
const arr = groupedElsRef.current;            // local binding
groupedElsRef.current = [];                   // clear first (was implicit via reassignment)
for (const m of arr) {
  const sibPx = timeMicrosToTimelinePx(m.originMicros, pixelsPerSecond);
  m.el.style.transform = `translate3d(${sibPx}px, 0, 0)`;
  m.el.style.transition = m.prevTransition ?? "";
}
```

If the lint still fires (it sometimes does on `m.el.style.xxx = …` inside event-handler closures that alias the ref), the correct fix is to move the mutation block into a `useEffect` or event handler where it already lives — in which case the rule should not fire. Double-check by reading the function enclosing these lines; if it's a render-time code path, it's a real bug and must move.

- [ ] **Step 3.3: Scoped lint + test + commit**

```bash
npx eslint components/timeline/clip-event.tsx
npm run test
git add components/timeline/clip-event.tsx
git commit -m "lint(clip-event): funnel grouped-el mutations through a local binding (immutability)"
```

---

## Task 4: Lint burn-down — `react-hooks/set-state-in-effect`

All 12 sites use the same set of patterns. Fix them in one commit per file class.

### Task 4a: Mount-only / prop-reset effects

**Files:**
- Modify: `app/page.tsx:212`
- Modify: `components/feed/feed-post-card.tsx:104`
- Modify: `components/feed/global-search.tsx:121`
- Modify: `components/feed/share-sheet.tsx:82`
- Modify: `components/feed/video-preview-card.tsx:119`
- Modify: `components/studio/focused-breadcrumb.tsx:24`

- [ ] **Step 4a.1: For each site, choose the right remediation**

Cookbook:
- **"Mount-only `setMounted(true)`"** → delete the state; hydrate with a `useSyncExternalStore` that reads `typeof window !== 'undefined'`, or inline a `const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)`.
- **"Reset X when Y changes" (e.g., `setHi(0)` on `searchQuery` change)** → move reset into the `onChange` handler that updates Y, not into an effect.
- **"Reset on open prop" (`share-sheet` `if (open) { setCopied(false) }`)** → compute `copied` as derived state keyed to `open` via the `key` prop on the sheet, OR use `useReducer` keyed to `open`.
- **"Reset error on URL change" (`video-preview-card` `setHasError(false)` on `url` change)** → same reset-on-render pattern: store previous url in state, compare during render, reset `hasError`. See [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect#resetting-state-when-a-prop-changes).

```tsx
// Example: feed-post-card setMounted
- const [mounted, setMounted] = useState(false);
- useEffect(() => { setMounted(true); }, []);
+ const mounted = useSyncExternalStore(
+   () => () => {},
+   () => true,   // client
+   () => false,  // server
+ );
```

```tsx
// Example: video-preview-card hasError reset on url
- const [hasError, setHasError] = useState(false);
- useEffect(() => { setHasError(false); }, [url]);
+ const [prevUrl, setPrevUrl] = useState(url);
+ const [hasError, setHasError] = useState(false);
+ if (prevUrl !== url) {
+   setPrevUrl(url);
+   setHasError(false);
+ }
```

- [ ] **Step 4a.2: Apply each fix one file at a time, run the scoped lint after each**

```bash
npx eslint <file>
```

- [ ] **Step 4a.3: Run unit tests between files**

```bash
npm run test
```

- [ ] **Step 4a.4: Commit all six together (pattern is the same; reviewable as one diff)**

```bash
git add app/page.tsx components/feed/feed-post-card.tsx components/feed/global-search.tsx components/feed/share-sheet.tsx components/feed/video-preview-card.tsx components/studio/focused-breadcrumb.tsx
git commit -m "lint: replace reset-in-effect patterns with derived state or handler-time resets"
```

### Task 4b: Async-hydration effects

**Files:**
- Modify: `lib/hooks/use-lazy-media-hydration.ts:34`
- Modify: `lib/hooks/use-media-pool-url.ts:47`
- Modify: `components/feed/theater-mode.tsx:78, 104`
- Modify: `components/studio/preset-panel.tsx:143`

These effects sync with external systems (IDB, store). The `setState` inside them *is* the correct pattern, but the rule fires because the `setState` happens on a synchronous branch — which is what the rule is designed to catch. For each:
- If a branch returns a cached store value synchronously, restructure so `setState` sits behind the `then` of the async load (wrap the sync branch in `Promise.resolve()` OR early-`return` without `setState` and let the store selector drive re-render).
- If it's a genuine "synchronize UI to external change" (e.g., `setQueue(buildQueue(...))` in theater-mode), that's what effects are for — add a targeted disable with `Why: subscribing to post/allPosts changes to rebuild derived queue, no cascade because buildQueue is pure and the dep array is stable`.

- [ ] **Step 4b.1: Apply fixes / targeted disables per file**
- [ ] **Step 4b.2: Scoped lint + test**

```bash
for f in lib/hooks/use-lazy-media-hydration.ts lib/hooks/use-media-pool-url.ts components/feed/theater-mode.tsx components/studio/preset-panel.tsx; do npx eslint "$f"; done
npm run test
```

- [ ] **Step 4b.3: Commit**

```bash
git add lib/hooks/use-lazy-media-hydration.ts lib/hooks/use-media-pool-url.ts components/feed/theater-mode.tsx components/studio/preset-panel.tsx
git commit -m "lint: gate set-state-in-effect for async-hydration sites with rationale"
```

---

## Task 5: Lint burn-down — `react-hooks/purity`

**Files:**
- Modify: `app/explore/page.tsx:350`
- Modify: `components/feed/theater/comments-drawer.tsx:60`

- [ ] **Step 5.1: `comments-drawer.tsx` — lazy-init the tick**

```tsx
- const [tick, setTick] = useState(Date.now());
+ const [tick, setTick] = useState<number>(0);
+ useEffect(() => { setTick(Date.now()); }, []);
useEffect(() => {
  if (!isOpen) return;
  const id = setInterval(() => setTick(Date.now()), 30_000);
  return () => clearInterval(id);
}, [isOpen]);
```

- [ ] **Step 5.2: `app/explore/page.tsx:350` — move `Date.now()` out of render**

Find the calling path. If it's an `onClick`/`onSave` handler called synchronously during render (unusual), it's the real bug — move into the handler body. If it's actually an event handler and the lint is misreading the surrounding JSX, set the timestamp in the handler body, not as a JSX prop expression:

```tsx
- onClick={() => { savePreset({ savedAt: Date.now(), … }) }}  // handler body — this is fine
- ...but likely the call sits inside a JSX-returning function that runs during render.
```

Read the surrounding 20 lines to decide. If needed, wrap with `useCallback` to defer:

```tsx
const handleSave = useCallback(() => {
  savePreset({ …, savedAt: Date.now() }).catch(console.warn);
  setToast("Saved to Library");
}, [/* stable deps */]);
```

- [ ] **Step 5.3: Scoped lint + test + commit**

```bash
npx eslint app/explore/page.tsx components/feed/theater/comments-drawer.tsx
npm run test
git add app/explore/page.tsx components/feed/theater/comments-drawer.tsx
git commit -m "lint: remove Date.now() from render paths (purity)"
```

---

## Task 6: Lint gate — drive error count to zero

- [ ] **Step 6.1: Run the full lint**

```bash
npm run lint 2>&1 | tee /tmp/lint-after.txt
grep -cE "^\s+\S+:\S+\s+error" /tmp/lint-after.txt
```

Expected: `0` (zero errors). Warnings may remain — acceptable per the ask.

- [ ] **Step 6.2: If any error remains, pick the remediation**

The most likely stragglers are `preserve-manual-memoization` warnings that graduate to errors under the next ESLint release, or a missed `set-state-in-effect`. Handle inline.

- [ ] **Step 6.3: Write a short changelog**

Create `docs/lint-burndown-2026-04-14.md` with this structure (substitute real commit hashes):
```markdown
# Lint Burn-down — 2026-04-14

Before: 48 errors, 61 warnings
After:  0  errors, N warnings

## By rule
- rules-of-hooks (16 → 0): pan-crop-window, profile/[username]/page, e2e/audit-page
- refs (13 → 0): use-global-tick, audio-mixer, timeline-ruler, preview-fx-mask-overlay, clip-event (partial via immutability)
- set-state-in-effect (12 → 0): …
- immutability (3 → 0): clip-event
- purity (2 → 0): explore/page, comments-drawer

## Commits
<hashes from this sprint>
```

- [ ] **Step 6.4: Commit the changelog**

```bash
git add docs/lint-burndown-2026-04-14.md
git commit -m "docs: lint burn-down changelog"
```

---

## Task 7: Effect parity harness — expand to Studio/Hover/Theater

### Task 7a: Surface-import audit

**Files:**
- Create: `lib/utils/fx-surface-audit.ts`
- Test: `lib/utils/fx-surface-audit.test.ts`

- [ ] **Step 7a.1: Write the canonical surface list**

```ts
// lib/utils/fx-surface-audit.ts
export const FX_SURFACE_FILES: readonly string[] = [
  "components/studio/preview-monitor.tsx",
  "components/studio/preview-fx-mask-overlay.tsx",
  "components/feed/feed-post-card.tsx",
  "components/feed/theater/TheaterPlayer.tsx",
];
export const FX_CANONICAL_IMPORT = "@/lib/utils/preview-helpers";
export const FX_CANONICAL_SYMBOL = "buildFxFilter";
```

- [ ] **Step 7a.2: Write the test (fails first)**

```ts
// lib/utils/fx-surface-audit.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FX_SURFACE_FILES, FX_CANONICAL_IMPORT, FX_CANONICAL_SYMBOL } from "./fx-surface-audit";

describe("FX surface import audit", () => {
  it.each(FX_SURFACE_FILES)("%s imports %s from the canonical module", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    const re = new RegExp(
      String.raw`import\s*\{[^}]*\b${FX_CANONICAL_SYMBOL}\b[^}]*\}\s*from\s*["']${FX_CANONICAL_IMPORT}["']`,
      "m",
    );
    expect(src).toMatch(re);
  });
});
```

- [ ] **Step 7a.3: Run the test — expect PASS on the canonical repo**

```bash
npm run test -- lib/utils/fx-surface-audit.test.ts
```

Expected: PASS (surfaces already use buildFxFilter — baseline confirmed).

- [ ] **Step 7a.4: Commit**

```bash
git add lib/utils/fx-surface-audit.ts lib/utils/fx-surface-audit.test.ts
git commit -m "test(fx-parity): pin Studio/Hover/Theater to the canonical buildFxFilter import"
```

### Task 7b: Extend `effect-parity.test.ts` with the 5-effect + Hypno combined fixture

**Files:**
- Modify: `lib/utils/effect-parity.test.ts`

- [ ] **Step 7b.1: Add a fixture with Hue + Blur + Glitch + Strobe + Hypno stacked**

The existing `describe("multi-effect stacking")` already covers Hue + Blur + Glitch + Strobe. Extend that `clips` array to also include a Hypno-Tunnel clip and assert:
- `r.hypnoTunnel?.background` matches `radial-gradient`
- `r.filter` still contains `hue-rotate`, `blur`, a `brightness(` term
- `r.glitchTransform` still present
- Stacking Hypno does NOT clear the other effects (regression guard)

- [ ] **Step 7b.2: Add a fixture snapshot for "same input twice ⇒ deepEqual"**

Ensure the full 5-effect stack still returns byte-identical output across calls — this is the Studio/Hover/Theater parity lock.

- [ ] **Step 7b.3: Run tests + commit**

```bash
npm run test -- lib/utils/effect-parity.test.ts
git add lib/utils/effect-parity.test.ts
git commit -m "test(fx-parity): add 5-effect + Hypno combined fixture"
```

### Task 7c: Manual QA script

**Files:**
- Create: `docs/qa/effect-parity-manual.md`

- [ ] **Step 7c.1: Write the manual QA script**

Template:
```markdown
# Effect Parity — Manual QA Script
Runs against a known fixture post: `scripts/seed-fixture-post.ts` (creates a clip with Hue + Blur + Glitch + Strobe + Hypno).

## Steps
1. `npm run dev`
2. Open http://localhost:3000/studio — verify the fixture loads; scrub to 1.0s; observe each effect visible.
3. Navigate to the feed (hover preview) and hover the fixture card; verify each effect visible.
4. Click into Theater — verify each effect visible at 1.0s.

## Evidence table
| Effect | Studio | Hover | Theater | Notes |
|--------|--------|-------|---------|-------|
| Hue    | □      | □     | □       |       |
| Blur   | □      | □     | □       |       |
| Glitch | □      | □     | □       |       |
| Strobe | □      | □     | □       |       |
| Hypno  | □      | □     | □       |       |

## Fail criteria
- Any effect missing on a surface.
- Color drift (hue mismatch) between Studio and Hover.
- "First effect only" shows in Theater.
```

- [ ] **Step 7c.2: Commit**

```bash
git add docs/qa/effect-parity-manual.md
git commit -m "docs(qa): manual effect-parity script with evidence table"
```

---

## Task 8: Scrub + playback regression guard

### Task 8a: Pin paused-vs-playing seek parity in the pure helper

**Files:**
- Modify: `lib/utils/theater-seek.test.ts`

- [ ] **Step 8a.1: Add a test that enumerates 20 pointer positions and confirms `computeSeekTarget` has no branching on external state**

```ts
it("helper is a pure function of (clientX, rect, demoStartUs, demoDurUs, clips) — no hidden state", () => {
  const xs = Array.from({ length: 20 }, (_, i) => (i * RECT.width) / 19);
  const a = xs.map((x) => computeSeekTarget(x, RECT, 0, demoDurUs, clips));
  const b = xs.map((x) => computeSeekTarget(x, RECT, 0, demoDurUs, clips));
  expect(a).toEqual(b);
});
```

- [ ] **Step 8a.2: Run tests + commit**

```bash
npm run test -- lib/utils/theater-seek.test.ts
git add lib/utils/theater-seek.test.ts
git commit -m "test(theater-seek): pin purity of computeSeekTarget"
```

### Task 8b: Dev-only churn counters in TheaterPlayer

**Files:**
- Modify: `components/feed/theater/TheaterPlayer.tsx` (add counter block near the ref/effect setup, exposed only under `NODE_ENV !== 'production'`)
- Create: `components/feed/theater/churn-counter.ts` (extract so it's testable)

- [ ] **Step 8b.1: Write the counter module**

```ts
// components/feed/theater/churn-counter.ts
export interface ChurnCounts {
  srcReloadCount: number;
  playheadResetCount: number;
  seekWriteCount: number;
}

export function createChurnCounter(): ChurnCounts {
  return { srcReloadCount: 0, playheadResetCount: 0, seekWriteCount: 0 };
}

declare global {
  interface Window { __synapseChurn?: ChurnCounts }
}

export function installChurnCounter(): ChurnCounts | null {
  if (typeof window === "undefined") return null;
  if (process.env.NODE_ENV === "production") return null;
  if (!window.__synapseChurn) window.__synapseChurn = createChurnCounter();
  return window.__synapseChurn;
}
```

- [ ] **Step 8b.2: Wire the counter into TheaterPlayer**

In `TheaterPlayer.tsx`:
- Import `installChurnCounter`.
- Create a `const churnRef = useRef(installChurnCounter())` at the top of the component.
- Increment `churnRef.current.srcReloadCount` inside whatever currently sets `v.src` (search the file for `.src =`).
- Increment `playheadResetCount` anywhere the tick loop resets the playhead to 0 while a drag session is active (track drag state via `isDraggingRef`).
- Increment `seekWriteCount` inside the pointer-drag seek handler.

- [ ] **Step 8b.3: Add a unit test for the counter module**

```ts
// components/feed/theater/churn-counter.test.ts
import { describe, it, expect } from "vitest";
import { createChurnCounter } from "./churn-counter";

describe("createChurnCounter", () => {
  it("starts at zero for all counters", () => {
    const c = createChurnCounter();
    expect(c).toEqual({ srcReloadCount: 0, playheadResetCount: 0, seekWriteCount: 0 });
  });
});
```

- [ ] **Step 8b.4: Run tests + commit**

```bash
npm run test
git add components/feed/theater/churn-counter.ts components/feed/theater/churn-counter.test.ts components/feed/theater/TheaterPlayer.tsx
git commit -m "test(theater): dev-only churn counters for src/playhead/seek writes"
```

### Task 8c: Playwright scrub regression spec

**Files:**
- Create: `e2e/theater-scrub.spec.ts`

- [ ] **Step 8c.1: Write the spec**

```ts
// e2e/theater-scrub.spec.ts
import { test, expect } from "@playwright/test";

test("continuous scrub does not reload v.src or reset playhead to 0", async ({ page }) => {
  await page.goto("/?fixture=parity");  // use existing audit-mode fixture URL
  await page.click('[data-testid="open-theater"]');
  await page.waitForSelector('[data-testid="theater-video"]');

  // Reset counters
  await page.evaluate(() => { window.__synapseChurn = { srcReloadCount: 0, playheadResetCount: 0, seekWriteCount: 0 }; });

  const bar = page.locator('[data-testid="theater-scrubber"]');
  const box = (await bar.boundingBox())!;

  // Drag across the bar
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(box.x + (box.width * i) / 20, box.y + box.height / 2, { steps: 3 });
  }
  await page.mouse.up();

  const churn = await page.evaluate(() => window.__synapseChurn);
  expect(churn!.srcReloadCount).toBe(0);
  expect(churn!.playheadResetCount).toBe(0);
  expect(churn!.seekWriteCount).toBeGreaterThan(0);
});
```

If `data-testid` attributes don't yet exist, add the minimum set needed. Keep them out of non-audit builds by gating on `NEXT_PUBLIC_AUDIT_MODE`.

- [ ] **Step 8c.2: Run Playwright locally**

```bash
npm run audit -- theater-scrub
```

Expected: PASS.

- [ ] **Step 8c.3: Commit**

```bash
git add e2e/theater-scrub.spec.ts
git commit -m "test(e2e): scrub regression guard — no src reload or playhead reset while dragging"
```

---

## Task 9: Build hardening — deterministic offline build

### Task 9a: Vendor Geist fonts

**Files:**
- Create: `public/fonts/geist-sans.woff2`, `public/fonts/geist-sans-bold.woff2`, `public/fonts/geist-mono.woff2`

- [ ] **Step 9a.1: Download Geist from vercel/geist-font releases**

Run from project root (one-time, locally):
```bash
mkdir -p public/fonts
# Grab release assets — pin to a known version
curl -L -o public/fonts/geist-sans.woff2 https://github.com/vercel/geist-font/raw/1.4.1/packages/next/dist/fonts/geist-sans/Geist-Variable.woff2
curl -L -o public/fonts/geist-mono.woff2 https://github.com/vercel/geist-font/raw/1.4.1/packages/next/dist/fonts/geist-mono/GeistMono-Variable.woff2
```

Verify files are non-empty:
```bash
ls -la public/fonts/
```

- [ ] **Step 9a.2: Record the exact source URLs and license in `docs/build-strategy.md`**

```markdown
# Build strategy

## Fonts
Geist Sans and Geist Mono are vendored in `public/fonts/` to make `npm run build` deterministic offline.

- Source: https://github.com/vercel/geist-font @ v1.4.1
- License: OFL-1.1 (see https://github.com/vercel/geist-font/blob/main/LICENSE.TXT)
- Rotation: update when Next.js ships a new Geist revision; verify with a visual diff against the Google Fonts version.
```

- [ ] **Step 9a.3: Commit fonts + docs**

```bash
git add public/fonts docs/build-strategy.md
git commit -m "build: vendor Geist fonts for offline-deterministic builds"
```

### Task 9b: Switch `app/layout.tsx` to `next/font/local`

**Files:**
- Modify: `app/layout.tsx:1–20`

- [ ] **Step 9b.1: Replace the import and loader calls**

```tsx
- import { Geist, Geist_Mono } from "next/font/google";
+ import localFont from "next/font/local";
...
- const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
- const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
+ const geistSans = localFont({
+   src: "../public/fonts/geist-sans.woff2",
+   variable: "--font-geist-sans",
+   display: "swap",
+ });
+ const geistMono = localFont({
+   src: "../public/fonts/geist-mono.woff2",
+   variable: "--font-geist-mono",
+   display: "swap",
+ });
```

- [ ] **Step 9b.2: Run the production build offline**

Simulate offline by temporarily blocking outbound DNS, OR just run the build and confirm no network fetch happens in the `.next/build-manifest` for fonts. Simpler: run a plain build and watch the logs.

```bash
npm run build 2>&1 | tail -50
```

Expected: success; no "Failed to fetch" messages related to fonts; `.next/` populated.

- [ ] **Step 9b.3: Commit**

```bash
git add app/layout.tsx
git commit -m "build(fonts): switch to next/font/local Geist (offline-deterministic)"
```

- [ ] **Step 9b.4: Update `docs/build-strategy.md` with build-time evidence**

Append the last 10 lines of the build output proving success.

---

## Task 10: Shared effect core — validation pass

**Files:**
- No new files; this task is a grep + test pass.

- [ ] **Step 10.1: Confirm no inline effect math outside the two canonical homes**

Run:
```bash
npx rg -n "hue-rotate\(|blur\(\d" --glob '!node_modules' --glob '!**/*.test.ts' --glob '!lib/utils/preview-helpers.ts' --glob '!lib/utils/hypno-overlay.ts' --glob '!lib/utils/svg-filters.ts'
```

Expected: very few hits, and each should be inside shared-helper consumers (ok) or test fixtures (ok). Any hit inside `components/feed/*` or `components/studio/*` that builds an effect string locally is a drift finding — file a follow-up issue, do not refactor within this sprint.

- [ ] **Step 10.2: Run the full parity suite**

```bash
npm run test
```

Expected: all green. `effect-parity.test.ts`, `effects-manifest.test.ts`, `theater-seek.test.ts`, `fx-surface-audit.test.ts`, `churn-counter.test.ts`.

- [ ] **Step 10.3: Run the full Playwright suite**

```bash
npm run audit
```

Expected: all green, including the two new specs from Task 7/8.

- [ ] **Step 10.4: Commit the final evidence doc**

Create `docs/stability-sprint-2026-04-14-evidence.md` with:
- lint counts: before / after
- test counts: before / after
- build: pass/fail offline
- manual QA evidence table (5 effects × 3 surfaces)
- list of commit hashes

```bash
git add docs/stability-sprint-2026-04-14-evidence.md
git commit -m "docs: stability sprint completion evidence"
```

---

## Done criteria (checklist for the final review)

- [ ] `npm run lint` → 0 errors
- [ ] `npm run test` → all green, including `fx-surface-audit.test.ts` and extended `effect-parity.test.ts` (5+ effects × parity)
- [ ] `npm run audit` → all green, including `theater-scrub.spec.ts`
- [ ] `npm run build` → succeeds with no network fetch (local fonts)
- [ ] `docs/qa/effect-parity-manual.md` evidence table filled in
- [ ] No user-visible regressions in Theater interactions (manual smoke)
- [ ] Commits are small and reviewable; PR body lists hash + files + tests + risk per commit

## Risk notes

- **Task 2c (timeline-ruler subscription)**: ResizeObserver + scroll listener is a behavior change (not just a lint fix). Smoke-test the ruler after the change. Fallback: keep the subscription model but read via `useSyncExternalStore` instead of state.
- **Task 4b (async-hydration set-state-in-effect)**: silencing with a targeted disable must carry a `Why:` comment — future tightening of the rule should not catch us off guard.
- **Task 8b (churn counters)**: if `TheaterPlayer.tsx` sets `v.src` via two different code paths, increment in both — grep for `.src =` and audit every hit.
- **Task 9 (fonts)**: if Geist version drift is ever a concern, add a pre-commit hook that checks the `.woff2` SHA against a pinned hash in `docs/build-strategy.md`.
- **Scope creep**: if any task reveals a deeper bug (e.g., real parity drift), file a follow-up and stay within this sprint's scope. The ask explicitly forbids feature additions.
