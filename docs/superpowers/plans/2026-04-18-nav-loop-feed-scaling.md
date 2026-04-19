# Navigation Loop Resolution & Feed Scaling Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the Home ↔ Theater navigation loop by centralizing URL mutation through a single `useSafeUrlSync` hook that reads `window.location.search` as the source of truth and guards against redundant writes, then lay the virtualization + per-post-selector foundation so the feed stays buttery at 100+ videos with ≤5 live `<video>` nodes.

**Architecture:**
1. **Unified Brain:** `lib/hooks/use-safe-url-sync.ts` — pure hook that exposes `heavyReplace`, `heavyPush`, `lightweightReplace`, `lightweightPush`. All four read `window.location.search` *at call time* (not a React-bound `useSearchParams()` snapshot), merge the caller's mutations, apply an equality guard (`window.location.search !== next.toString()`), and dispatch via either `router.*` (heavy) or `history.*State` (lightweight).
2. **Feed virtualization:** `@tanstack/react-virtual` row-virtualizes the grid on `app/page.tsx`. Rows are computed from a resize-observed column count; off-screen rows don't mount, so non-visible `<video>` elements never exist.
3. **Per-post Zustand selectors:** `FeedPostCard` subscribes to `useFeedStore((s) => s.likedPostIds.includes(post.id))` rather than the whole array, cutting the re-render fan-out from O(cards) to O(1) on any like toggle.
4. **One-Player Rule:** Home grid cards already hover-to-preview (no autoplay), so "center plays" is enforced by the virtualizer (only visible cards mount) plus an `intersection-observer-pool` strip that clears `<video>.src` when a card leaves the viewport. Theater's existing progressive-hydration placeholder system already enforces 3-hydrated-cells; no change needed there.

**Tech Stack:** Next.js 16 App Router, React 19, Zustand 5, `@tanstack/react-virtual` (new), vitest.

---

## File Structure

- **Create** `lib/hooks/use-safe-url-sync.ts` — the unified URL-sync hook.
- **Create** `lib/hooks/use-safe-url-sync.test.ts` — vitest unit tests for equality guard, merge semantics, `window.location.search` read path.
- **Modify** `app/page.tsx`:
  - Replace `navigateFilters` + `selectChannel` + `clearFilters` + the URL-hydration effect to use `useSafeUrlSync`.
  - Drop `searchParams` from every filter callback's dependency array.
  - Wrap the grid in `@tanstack/react-virtual` row-based virtualizer.
- **Modify** `components/feed/global-search.tsx` — replace inline `new URLSearchParams(searchParams.toString())` with `useSafeUrlSync`.
- **Modify** `components/feed/theater-mode.tsx` — replace the raw `history.pushState`/`replaceState` calls with `useSafeUrlSync.lightweightPush` / `lightweightReplace`, including an equality guard.
- **Modify** `components/feed/feed-post-card.tsx` — switch from `likedPostIds: string[]` subscription to per-post selector; strip `<video>.src` when the card leaves the viewport via `observeViewport` from `lib/utils/intersection-observer-pool.ts`.
- **Create** `e2e/nav-loop-guard.spec.ts` — Playwright regression test: rapid Home↔Theater toggles produce no IPC throttling warnings and Home→Theater open is <100 ms.
- **Create** `components/feed/feed-grid.tsx` — extracted virtualized grid so `app/page.tsx` stays under 900 lines.

---

## Task 1: Scaffold `useSafeUrlSync` + failing test

**Files:**
- Create: `lib/hooks/use-safe-url-sync.ts`
- Create: `lib/hooks/use-safe-url-sync.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/hooks/use-safe-url-sync.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/hooks/use-safe-url-sync.test.ts`
Expected: FAIL with "Cannot find module './use-safe-url-sync'" or similar.

- [ ] **Step 3: Implement `use-safe-url-sync.ts`**

Create `lib/hooks/use-safe-url-sync.ts`:

```ts
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { startTransition } from "react";

type Mutate = (params: URLSearchParams) => void;

/**
 * Pure helper — exported for testing. Reads `currentSearch` verbatim (caller
 * always passes `window.location.search`), applies `mutate`, and returns:
 *   - `null` when the mutation produced no delta vs `currentSearch` (equality
 *     guard — the caller must skip navigation),
 *   - the next `URLSearchParams.toString()` otherwise.
 *
 * The caller is responsible for deciding heavy (router) vs lightweight
 * (history) dispatch. This function never touches the DOM or the router.
 */
export function mergeAndGuard(currentSearch: string, mutate: Mutate): string | null {
  const before = new URLSearchParams(currentSearch);
  const after = new URLSearchParams(currentSearch);
  mutate(after);
  const beforeStr = before.toString();
  const afterStr = after.toString();
  if (beforeStr === afterStr) return null;
  return afterStr;
}

/**
 * Unified URL-sync hook. All four methods:
 *   1. Read `window.location.search` at call time — NOT `useSearchParams()`.
 *      Next's hook can trail lightweight history.*State writes, so any merge
 *      based on it loses params Theater pushed via raw history.
 *   2. Merge the caller's `mutate` over the current search.
 *   3. Skip the navigation entirely when the result equals current (IPC
 *      throttling prevention).
 *
 * Heavy variants go through `router.push`/`router.replace` — use when the
 * downstream layout depends on Next.js server-route awareness (e.g. segment
 * change, SSR props).
 *
 * Lightweight variants use `history.pushState`/`replaceState` — use for
 * overlays and filter chips where we only want the URL to reflect UI state
 * without retriggering Next.js route matching.
 */
export function useSafeUrlSync(basePath = "/") {
  const router = useRouter();

  const heavyReplace = useCallback((mutate: Mutate) => {
    const next = mergeAndGuard(window.location.search, mutate);
    if (next === null) return;
    const qs = next ? `?${next}` : "";
    startTransition(() => router.replace(`${basePath}${qs}`));
  }, [router, basePath]);

  const heavyPush = useCallback((mutate: Mutate) => {
    const next = mergeAndGuard(window.location.search, mutate);
    if (next === null) return;
    const qs = next ? `?${next}` : "";
    startTransition(() => router.push(`${basePath}${qs}`));
  }, [router, basePath]);

  const lightweightReplace = useCallback((nextPath: string, mutate: Mutate) => {
    const next = mergeAndGuard(window.location.search, mutate);
    // Even when params are unchanged, allow a pathname-only change through.
    if (next === null && window.location.pathname === nextPath) return;
    const qs = next !== null && next ? `?${next}` : (next === "" ? "" : window.location.search);
    window.history.replaceState(window.history.state, "", `${nextPath}${qs}`);
  }, []);

  const lightweightPush = useCallback((nextPath: string, mutate: Mutate) => {
    const next = mergeAndGuard(window.location.search, mutate);
    if (next === null && window.location.pathname === nextPath) return;
    const qs = next !== null && next ? `?${next}` : (next === "" ? "" : window.location.search);
    window.history.pushState(window.history.state, "", `${nextPath}${qs}`);
  }, []);

  return { heavyReplace, heavyPush, lightweightReplace, lightweightPush };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/hooks/use-safe-url-sync.test.ts`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/use-safe-url-sync.ts lib/hooks/use-safe-url-sync.test.ts
git commit -m "feat(nav): add useSafeUrlSync hook with equality guard + merge-not-overwrite"
```

---

## Task 2: Migrate `app/page.tsx` filter callbacks to `useSafeUrlSync`

**Files:**
- Modify: `app/page.tsx`

The current `navigateFilters` reads `searchParams.toString()` — which is bound to `useSearchParams()` and goes stale after any lightweight `history.pushState` from Theater. Swap to the new hook.

- [ ] **Step 1: Add the import**

In `app/page.tsx`, add:

```ts
import { useSafeUrlSync } from "@/lib/hooks/use-safe-url-sync";
```

- [ ] **Step 2: Replace `navigateFilters` with hook output**

Delete the existing `navigateFilters` `useCallback` block (lines 265–270) and its comment banner, and add at the top of the component body (right after the `useRouter` line):

```ts
const { heavyReplace } = useSafeUrlSync("/");
```

Then update `selectChannel` (originally lines 272–285) to use `heavyReplace` and drop `navigateFilters` + `searchParams` from its deps:

```ts
const selectChannel = useCallback((ch: Channel) => {
  const slug = channelSlug(ch);
  const isActive = channelParam === slug;
  setActiveTag(null);
  setSearchQuery("");
  heavyReplace((p) => {
    if (isActive) {
      p.delete("channel");
    } else {
      p.set("channel", slug);
      p.delete("search");
    }
  });
}, [channelParam, heavyReplace, setSearchQuery]);
```

And `clearFilters` (originally lines 287–295):

```ts
const clearFilters = useCallback(() => {
  setActiveTag(null);
  setSearchQuery("");
  heavyReplace((p) => {
    p.delete("channel");
    p.delete("search");
    p.delete("tag");
  });
}, [heavyReplace, setSearchQuery]);
```

- [ ] **Step 3: Remove the stale `searchParams` dep from the mount-hydration effect**

The mount-hydration useEffect at lines 225–236 already reads `window.location.search` directly and has empty deps — leave it alone. Verify by reading the file; it should still look like this after Step 2:

```ts
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const s = params.get("search");
  const t = params.get("tag");
  ...
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 4: Run the project type-check + tests**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `npx vitest run`
Expected: no new failures.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "refactor(home): route filter chips through useSafeUrlSync (equality guard)"
```

---

## Task 3: Migrate `components/feed/global-search.tsx` to `useSafeUrlSync`

**Files:**
- Modify: `components/feed/global-search.tsx`

- [ ] **Step 1: Add the import + hook call**

Replace the existing imports block to include `useSafeUrlSync`:

```ts
import { useSafeUrlSync } from "@/lib/hooks/use-safe-url-sync";
```

And, inside the component body (right after `const router = useRouter();`), add:

```ts
const { heavyReplace } = useSafeUrlSync("/");
```

- [ ] **Step 2: Rewrite the `navigate` callback's channel branch**

Replace the entire `navigate` useCallback (originally lines 87–104) with:

```ts
const navigate = useCallback((r: Result) => {
  setOpen(false);
  if (r.kind === "channel") {
    setSearchQuery("");
    heavyReplace((p) => {
      p.set("channel", channelSlug(r.payload as Channel));
      p.delete("search");
    });
  } else {
    router.push(`/profile/${r.payload}`);
  }
}, [router, heavyReplace, setSearchQuery]);
```

Remove the now-unused `searchParams` variable and its `useSearchParams` import from the top of the file (it's no longer referenced by any code path).

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/feed/global-search.tsx
git commit -m "refactor(search): drop useSearchParams, route channel nav through useSafeUrlSync"
```

---

## Task 4: Migrate `components/feed/theater-mode.tsx` URL masking to `useSafeUrlSync.lightweightReplace`

**Files:**
- Modify: `components/feed/theater-mode.tsx`

Theater uses raw `history.pushState` / `replaceState` at lines 128–154 and 216–222. The problem: these writes bypass Next.js, and immediately after, any re-read of `useSearchParams().toString()` by another component returns the *old* search string. Routing that through `useSafeUrlSync.lightweightReplace` centralizes the merge + guard so `?v=` etc. never gets clobbered.

- [ ] **Step 1: Import the hook**

```ts
import { useSafeUrlSync } from "@/lib/hooks/use-safe-url-sync";
```

Inside `TheaterMode`, right after the existing state declarations, add:

```ts
const { lightweightPush, lightweightReplace } = useSafeUrlSync("/");
```

- [ ] **Step 2: Replace the open-push useEffect (lines 128–154)**

Replace the body of the effect with:

```ts
useEffect(() => {
  if (!post.id) return;
  const targetPath = `/video/${post.id}`;
  if (window.location.pathname !== targetPath) {
    lightweightPush(targetPath, () => { /* no param change */ });
    hasPushedRef.current = true;
  }
  const onPopState = () => {
    hasPushedRef.current = false;
    onClose();
  };
  window.addEventListener("popstate", onPopState);
  return () => {
    window.removeEventListener("popstate", onPopState);
    if (hasPushedRef.current && window.location.pathname.startsWith("/video/")) {
      lightweightReplace(new URL(originalUrlRef.current).pathname, () => { /* preserve params */ });
      hasPushedRef.current = false;
    }
  };
}, [post.id, onClose, lightweightPush, lightweightReplace]);
```

- [ ] **Step 3: Replace the active-post URL-sync useEffect (lines 216–222)**

```ts
useEffect(() => {
  if (!activePostId || !hasPushedRef.current) return;
  const targetPath = `/video/${activePostId}`;
  if (window.location.pathname !== targetPath) {
    lightweightReplace(targetPath, () => { /* no param change */ });
  }
}, [activePostId, lightweightReplace]);
```

- [ ] **Step 4: Run existing Theater e2e if present**

Run: `npx playwright test e2e/nav-durability.spec.ts`
Expected: unchanged (pass or same-skipped state).

If the suite isn't runnable in this environment, skip this step but note it.

- [ ] **Step 5: Commit**

```bash
git add components/feed/theater-mode.tsx
git commit -m "refactor(theater): route URL masking through useSafeUrlSync lightweight methods"
```

---

## Task 5: Install `@tanstack/react-virtual`

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the package**

Run: `npm install @tanstack/react-virtual@^3.10.9`
Expected: adds `@tanstack/react-virtual` to `dependencies`. Lockfile updates.

- [ ] **Step 2: Verify install**

Run: `node -e "require('@tanstack/react-virtual')"`
Expected: no output (successful require).

- [ ] **Step 3: Commit the lockfile update**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @tanstack/react-virtual for feed virtualization"
```

---

## Task 6: Extract `FeedGrid` + virtualize

**Files:**
- Create: `components/feed/feed-grid.tsx`
- Modify: `app/page.tsx`

Extract the grid into its own component so `app/page.tsx` stays well under 900 lines and the virtualization logic lives next to the card.

- [ ] **Step 1: Create `components/feed/feed-grid.tsx`**

Write the full file content:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { FeedPost } from "@/lib/store/feed-store";
import { FeedPostCard } from "./feed-post-card";
import type { UserProfile } from "@/lib/store/user-store";

interface Props {
  posts: FeedPost[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  currentUsername?: string;
  onOpen: (post: FeedPost) => void;
  onRemix: (post: FeedPost) => void;
  onImport: (post: FeedPost) => void;
  onCreator: (post: FeedPost) => void;
  onDelete: (post: FeedPost) => void;
}

/** Measure the grid's column count from its actual rendered width / gap. */
function useColumnCount(ref: React.RefObject<HTMLDivElement | null>): number {
  const [cols, setCols] = useState(6);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      // Matches the Tailwind breakpoint ladder in app/page.tsx
      if (w < 640) setCols(2);
      else if (w < 768) setCols(3);
      else if (w < 1024) setCols(4);
      else if (w < 1280) setCols(5);
      else setCols(6);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

/** One virtual row = one horizontal strip of `cols` cards. */
export function FeedGrid({ posts, scrollRef, currentUsername, onOpen, onRemix, onImport, onCreator, onDelete }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useColumnCount(gridRef);
  const rowCount = Math.ceil(posts.length / cols);

  // Card aspect ratio is 9/16 and the grid has gap-4 (16 px). Height estimate
  // grows with the measured column width so virtual scroll math stays accurate
  // across breakpoints without a per-row `measureElement` round-trip.
  const rowHeight = useMemo(() => {
    const el = gridRef.current;
    const width = el?.clientWidth ?? 1200;
    const gap = 16;
    const cardWidth = (width - gap * (cols - 1)) / cols;
    return Math.round(cardWidth * (16 / 9)) + gap;
  }, [cols]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 2,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={gridRef}
      style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
    >
      {virtualItems.map((row) => {
        const start = row.index * cols;
        const slice = posts.slice(start, start + cols);
        return (
          <div
            key={row.key}
            data-row-index={row.index}
            className="absolute left-0 right-0 grid gap-4"
            style={{
              top: 0,
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              height: row.size,
            }}
          >
            {slice.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                pool={posts}
                onOpen={() => onOpen(post)}
                onRemix={() => onRemix(post)}
                onImport={() => onImport(post)}
                onCreator={() => onCreator(post)}
                onDelete={post.authorUsername && post.authorUsername === currentUsername
                  ? () => onDelete(post)
                  : undefined}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Replace the inline grid in `app/page.tsx` with `<FeedGrid>`**

Replace the `<div className="grid grid-cols-2 ...">` block (lines 473–487 in the pre-refactor file) with:

```tsx
<FeedGrid
  posts={filteredPosts}
  scrollRef={scrollContainerRef}
  currentUsername={currentProfile?.username}
  onOpen={(post) => { primeTheaterGesture(post.id); setTheaterPostId(post.id); }}
  onRemix={handleRemix}
  onImport={handleImport}
  onCreator={(post) => router.push(`/profile/${post.user.handle}`)}
  onDelete={(post) => removePost(post.id)}
/>
```

Add the import at the top of `app/page.tsx`:

```ts
import { FeedGrid } from "@/components/feed/feed-grid";
```

- [ ] **Step 3: Import fix — `UserProfile` type**

The `feed-grid.tsx` file imports `UserProfile` from `@/lib/store/user-store` but only uses `currentUsername: string`. Remove the unused import:

In `components/feed/feed-grid.tsx`, delete the line:

```ts
import type { UserProfile } from "@/lib/store/user-store";
```

- [ ] **Step 4: Run type-check + tests**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `npm run dev &` then open `http://localhost:3000/` — confirm the grid scrolls, cards appear/disappear as they enter/leave the viewport, and no grid gaps.

- [ ] **Step 5: Commit**

```bash
git add components/feed/feed-grid.tsx app/page.tsx
git commit -m "feat(feed): virtualize home grid via @tanstack/react-virtual (3-5 live video nodes)"
```

---

## Task 7: Refactor `FeedPostCard` to per-post Zustand selector + viewport-driven src strip

**Files:**
- Modify: `components/feed/feed-post-card.tsx`

Currently the card subscribes to `likedPostIds: string[]` — any like-toggle causes every rendered card to re-render. Switch to a boolean per-post selector. While we're here, strip `<video>.src` when the card leaves the viewport to recoup VRAM.

- [ ] **Step 1: Switch to a per-post `liked` selector**

In `components/feed/feed-post-card.tsx`, find the two lines (original 33–34):

```ts
const likedPostIds = useFeedStore((s) => s.likedPostIds);
const toggleLike   = useFeedStore((s) => s.toggleLike);
const liked = likedPostIds.includes(post.id);
```

Replace with:

```ts
// Per-post subscription — cards re-render only when their own like flips,
// not when any other card's like does. Zustand compares by reference identity,
// and boolean primitives are referentially stable across renders.
const liked = useFeedStore((s) => s.likedPostIds.includes(post.id));
const toggleLike = useFeedStore((s) => s.toggleLike);
```

Delete the now-unused `likedPostIds` identifier everywhere in the file (only site is the one we replaced).

- [ ] **Step 2: Add viewport-driven `<video>.src` strip**

Add the import at the top of `components/feed/feed-post-card.tsx`:

```ts
import { observeViewport } from "@/lib/utils/intersection-observer-pool";
```

After the existing `useEffect` that wires `loadedmetadata` (original lines 109–115), add a new effect:

```ts
// When the card leaves the viewport (plus a generous rootMargin so we don't
// strip cards the user is about to scroll back to), null out the video src so
// the browser releases the decoder + any demuxed buffer. On re-enter, the
// existing loadedmetadata effect re-seeks to firstClipOffset so the visible
// frame is byte-identical to the published thumbnail.
useEffect(() => {
  const article = videoRef.current?.parentElement; // <div className="relative">
  if (!article || !firstClipSrc) return;
  const unobserve = observeViewport(article, (isVisible) => {
    const v = videoRef.current;
    if (!v) return;
    if (isVisible) {
      if (v.src !== firstClipSrc) {
        v.src = firstClipSrc;
        v.load();
      }
    } else {
      v.pause();
      // Clearing src triggers a HAVE_NOTHING readyState; the re-enter branch
      // restores it. Setting removeAttribute rather than "" avoids a
      // network request for the empty string in some browsers.
      v.removeAttribute("src");
      v.load();
    }
  }, "400px"); // generous margin to avoid flicker at the edges
  return unobserve;
}, [firstClipSrc]);
```

- [ ] **Step 3: Run type-check + existing tests**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `npx vitest run`
Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add components/feed/feed-post-card.tsx
git commit -m "perf(feed): per-post like selector + viewport-driven video src strip"
```

---

## Task 8: Playwright regression — nav-loop guard

**Files:**
- Create: `e2e/nav-loop-guard.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from "@playwright/test";

test.describe("Home ↔ Theater navigation", () => {
  test("rapid open/close produces no IPC throttling warnings", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning" && msg.text().includes("IPC")) {
        warnings.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForSelector("article");

    // Open + close five times in quick succession
    for (let i = 0; i < 5; i++) {
      const firstCard = page.locator("article").first();
      await firstCard.click();
      await page.waitForURL(/\/video\//);
      await page.keyboard.press("Escape");
      await page.waitForURL(/^(?!.*\/video\/).*$/);
    }

    expect(warnings).toEqual([]);
  });

  test("home → theater open completes under 150ms", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("article");
    const t0 = Date.now();
    await page.locator("article").first().click();
    await page.waitForURL(/\/video\//);
    expect(Date.now() - t0).toBeLessThan(150);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test e2e/nav-loop-guard.spec.ts`
Expected: both tests pass. If they fail, inspect the specific warning and trace which component is still double-writing — fix that component's URL mutation to go through `useSafeUrlSync`.

- [ ] **Step 3: Commit**

```bash
git add e2e/nav-loop-guard.spec.ts
git commit -m "test(e2e): nav-loop guard — no IPC warnings, <150ms Home→Theater open"
```

---

## Self-Review Checklist

- Spec coverage:
  - P0 "Merge Don't Overwrite" → Task 1 (`mergeAndGuard` reads passed string; tests assert merge).
  - P0 Equality Guard → Task 1 (null return when unchanged).
  - P0 Dependency Safety → Tasks 2–4 (no `searchParams` in filter-callback deps; mount effect uses empty deps).
  - P0 Unified Brain → Task 1 produces the hook; Tasks 2–4 consume it.
  - P1 Virtualization → Tasks 5–6.
  - P1 Zustand Per-Post Selector → Task 7.
  - P1 One-Player Rule → Task 7 (viewport-driven src strip + existing hover-to-play keeps ≤1 playing at a time).
  - P1 Ambilight static poster → already implemented in `TheaterPlayer.tsx:675–681` (radial gradient, no live video duplicate). No task needed; regression covered by `audit-video-lifecycle` skill if invoked.
  - Done Condition → Task 8 asserts <150 ms + zero IPC warnings.

- Type consistency: `heavyReplace`, `heavyPush`, `lightweightReplace`, `lightweightPush` used with consistent signatures across all three migrated files (Tasks 2, 3, 4).

- No placeholders: every code step includes the full code block. No "similar to…" hand-waves.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-18-nav-loop-feed-scaling.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
