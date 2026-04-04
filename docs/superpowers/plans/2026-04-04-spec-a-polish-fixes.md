# Spec A: Polish Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Restore Original feature entirely, fix grouped clip drag visual desync, fix feed scrubber seek, and wire feed Share/Comment buttons — all without regressing the E2E suite.

**Architecture:** Four independent surgical edits. Restore removal spans toolbar, context menu, store, helpers, dialog, and E2E. Group drag adds a DOM ref cache in `clip-event.tsx` for lockstep grouped element movement. Feed scrubber fixes coordinate math in TheaterPlayer's `handleSeek`. Feed buttons add clipboard copy and toast to TheaterUI + feed-post-card.

**Tech Stack:** React 19, Zustand v5, Tailwind 4, Playwright (E2E), lucide-react

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `components/timeline/timeline-toolbar.tsx` | Modify | Remove Restore button, imports, state, handler |
| `components/timeline/clip-context-menu.tsx` | Modify | Remove Restore menu item, confirmation dialog, imports |
| `components/timeline/restore-confirm-dialog.tsx` | Delete | No longer needed |
| `lib/store/project-helpers.ts` | Modify | Remove `validateRestore`, `canRestoreOriginal`, `performRestoreOriginal`, `RestoreInvalidReason`, `RestoreValidation` |
| `lib/store/project-store.ts` | Modify | Remove `restoreOriginalClips` action and its import |
| `e2e/razor-correctness.spec.ts` | Modify | Delete the restore E2E test (lines 183-262) |
| `components/timeline/clip-event.tsx` | Modify | Add `data-clip-id`/`data-group-id` attrs, cache grouped refs on drag start, apply transforms to group |
| `components/feed/theater/TheaterPlayer.tsx` | Modify | Fix `handleSeek` coordinate math |
| `components/feed/theater/TheaterUI.tsx` | Modify | Wire Share (clipboard) and Comment (toast) buttons |
| `components/feed/feed-post-card.tsx` | Modify | Wire Share (clipboard) and Comment (toast) buttons |

---

### Task 1: Remove Restore Original Feature

**Files:**
- Delete: `components/timeline/restore-confirm-dialog.tsx`
- Modify: `components/timeline/timeline-toolbar.tsx`
- Modify: `components/timeline/clip-context-menu.tsx`
- Modify: `lib/store/project-helpers.ts`
- Modify: `lib/store/project-store.ts`
- Modify: `e2e/razor-correctness.spec.ts`

- [ ] **Step 1: Delete the restore confirm dialog file**

Delete `components/timeline/restore-confirm-dialog.tsx` entirely.

- [ ] **Step 2: Clean up timeline-toolbar.tsx**

In `components/timeline/timeline-toolbar.tsx`, make these changes:

**Remove from imports (line 4):** Remove `RotateCcw` from the lucide-react import.

**Remove import (line 9):** Delete `import { canRestoreOriginal } from "@/lib/store/project-helpers";`

**Remove import (line 13):** Delete `import { RestoreConfirmDialog } from "@/components/timeline/restore-confirm-dialog";`

**Remove state (line 32):** Delete `const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);`

**Remove computed value (line 68):** Delete `const isRestoreValid = canRestoreOriginal(selectedClipIds, tracks);`

**Remove handler (lines 70-73):** Delete the entire `onRestoreOriginal` function.

**Remove Btn call (line 119):** Delete `<Btn icon={<RotateCcw size={16} />} label="Restore Original" disabled={!isRestoreValid} onClick={onRestoreOriginal} />`

**Remove dialog render (line 182):** Delete `{showRestoreConfirm && <RestoreConfirmDialog onClose={() => setShowRestoreConfirm(false)} />}`

**Remove unused import:** `ClipEvent` type import (line 8) is only used in onAddText/onAddFx — keep it. But `canRestoreOriginal` and `RestoreConfirmDialog` imports must go.

After cleanup, the toolbar should have: Split, Ungroup, Regroup, Delete, Heal, then separator, Add Text, Add FX.

- [ ] **Step 3: Clean up clip-context-menu.tsx**

In `components/timeline/clip-context-menu.tsx`:

**Remove import (line 7):** Delete `import { canRestoreOriginal } from "@/lib/store/project-helpers";`

**Remove import (line 4):** Remove `RotateCcw` from the lucide-react destructuring.

**Remove state (line 75):** Delete `const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);`

**Remove lines 78-96:** Delete the entire block that computes `selectedClips`, `canRestore`, `restoreMediaName`, `formatTimeSec`, `restoreEarliest`, `restoreLatest`, and the `onRestoreConfirmed` handler.

**Remove from JSX (lines 114-123):** Delete the `{canRestore && (...)}` block that renders the Restore Original menu item.

**Remove from JSX (lines 127-154):** Delete the entire `{showRestoreConfirm && (...)}` confirmation dialog block.

**Remove unused reactive subscriptions:** `mediaPoolReactive` (line 40) is now unused — delete it. `selectedClipIdsReactive` and `allTracksReactive` may still be used by the remaining menu items — keep if so.

Check: `selectedClipIdsReactive` is not used anywhere else after removing restore code. But it WAS used on line 78. After removal, check if anything else uses it. The `selectedClips` computation is gone, so `selectedClipIdsReactive` can also go unless another line references it. Looking at the remaining code: no other line uses `selectedClipIdsReactive` — remove it (line 38).

`allTracksReactive` (line 39) is used by `isMuted` (line 73) — keep it.

`mediaPoolReactive` (line 40) — remove it, only used by restore code.

- [ ] **Step 4: Clean up project-helpers.ts**

In `lib/store/project-helpers.ts`:

**Delete lines 6-72:** Remove the entire `RestoreInvalidReason` type, `RestoreValidation` interface, `validateRestore` function, and `canRestoreOriginal` function.

**Delete lines 458-562 (the `performRestoreOriginal` function):** Remove the entire function.

Keep `computeCrossfades` — it's used by other functions.

- [ ] **Step 5: Clean up project-store.ts**

In `lib/store/project-store.ts`:

**Remove from import (line 15):** Remove `performRestoreOriginal` from the destructured import of `project-helpers`.

**Remove from interface (line 100):** Delete `restoreOriginalClips: (clipIds: string[]) => void;`

**Remove implementation (lines 422-430):** Delete the `restoreOriginalClips` action implementation.

- [ ] **Step 6: Delete the restore E2E test**

In `e2e/razor-correctness.spec.ts`, delete the entire third test (lines 183-262):

```ts
  test("restore original after multi-split: clip count returns to 1, duration matches media", async ({
```

through the closing `});` of that test. Keep the two remaining split tests.

Also remove the `__auditSetSelectedClipIds` hook reference if it's only used by the deleted test. Check: it's declared in `AppBootstrap.tsx` — leave it there as it could be used by future tests. Only remove the test itself.

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No new errors (pre-existing errors in upload-modal and project-store are OK).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove Restore Original feature entirely

Removes toolbar button, context menu item, confirmation dialog,
store action, helper functions, and E2E test. Heal tool replaces
this functionality."
```

---

### Task 2: Fix Group Drag Visual Desync

**Files:**
- Modify: `components/timeline/clip-event.tsx`

The problem: When dragging a clip that belongs to a group (linked Video+Audio), only the grabbed clip moves during drag. Grouped siblings stay put until pointer release, when the store commits the move and React re-renders them.

The fix: On drag start, query all DOM elements with matching `data-group-id` once, cache the refs. On each pointer move, apply the same computed transform to all cached refs. On drag end, clear inline transforms and the cache.

- [ ] **Step 1: Add data-clip-id and data-group-id attributes to the clip DOM element**

In `components/timeline/clip-event.tsx`, on the root div (around line 455-465), add data attributes:

Find the root div and add after the `onDrop` prop:

```tsx
      data-clip-id={clip.id}
      data-group-id={clip.groupId ?? undefined}
```

- [ ] **Step 2: Add a ref to cache grouped element references**

After the existing `dragAnchorX` ref (around line 61), add:

```ts
  /** Cached DOM refs of grouped sibling clips — resolved once at drag start, cleared at drag end. */
  const groupedElsRef = useRef<HTMLElement[]>([]);
```

- [ ] **Step 3: Populate the cache on drag start**

In `onPointerDown`, after the line `lastClientX.current = e.clientX;` (end of the handler, around line 135), add:

```ts
      // Cache grouped sibling DOM elements for lockstep drag rendering.
      // Queried once here — zero DOM queries during the move loop.
      if (clip.groupId) {
        const all = document.querySelectorAll<HTMLElement>(`[data-group-id="${clip.groupId}"]`);
        groupedElsRef.current = Array.from(all).filter((el) => el !== clipRef.current);
      } else {
        groupedElsRef.current = [];
      }
```

- [ ] **Step 4: Apply transform to all grouped elements in the move loop**

In `onPointerMove`, right after the existing clip DOM write block (the `if (clipRef.current)` block around lines 218-220), add:

```ts
      // 1b. Grouped siblings — same transform, same frame
      for (const el of groupedElsRef.current) {
        el.style.transform = `translate3d(${previewPx}px, 0, 0)`;
      }
```

Note: `previewPx` is already computed inside the `if (clipRef.current)` block. Move the `previewPx` computation outside the if-block so it's available for both:

Replace:
```ts
      if (clipRef.current) {
        const previewPx = timeMicrosToTimelinePx(newStart, pixelsPerSecond);
        clipRef.current.style.transform = `translate3d(${previewPx}px, 0, 0)`;
      }
```

With:
```ts
      const previewPx = timeMicrosToTimelinePx(newStart, pixelsPerSecond);
      // 1. Clip position — direct DOM, no store round-trip
      if (clipRef.current) {
        clipRef.current.style.transform = `translate3d(${previewPx}px, 0, 0)`;
      }
      // 1b. Grouped siblings — same transform, same frame
      for (const el of groupedElsRef.current) {
        el.style.transform = `translate3d(${previewPx}px, 0, 0)`;
      }
```

- [ ] **Step 5: Clear inline transforms and cache on drag end**

In `onPointerUp`, after the existing `updateIndicatorDOM(null, false);` line (around line 253), add:

```ts
      // Clear inline transforms on grouped siblings so React can take over
      for (const el of groupedElsRef.current) {
        el.style.transform = "";
      }
      groupedElsRef.current = [];
```

Also clear on the main clip ref — add before the grouped clearing:

```ts
      if (clipRef.current) {
        clipRef.current.style.transform = "";
      }
```

The React re-render from the store commit (`moveClip`) will set the correct `translate3d` via the `style` prop.

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add components/timeline/clip-event.tsx
git commit -m "fix(drag): grouped clips move in lockstep during drag via cached DOM refs

On drag start, resolve all sibling clip elements by data-group-id
and cache refs. On each pointer move, apply the same computed
transform to all cached elements. On drag end, clear inline
transforms and the cache. Zero DOM queries in the move loop."
```

---

### Task 3: Fix Feed Scrubber Seek

**Files:**
- Modify: `components/feed/theater/TheaterPlayer.tsx:349-369`

The bug: The `handleSeek` callback uses `e.clientX - rect.left` for the ratio calculation, which is correct for the click position. However, for snapshot posts with clips (line 353-356), the seek correctly sets `phRef.current` but also nulls `loadedClipRef` which forces a full clip reload. For simple video posts (line 358-367), the seek works correctly. 

Actually, re-reading the code more carefully: the seek math itself (`ratio = (e.clientX - rect.left) / rect.width`) looks correct. The issue is that for snapshot posts, after seeking, `syncClip` is called but the tick loop uses `v.currentTime` to derive `phRef.current` (line 233), which may overwrite the sought position before the video element has actually seeked. The `loadedClipRef = null` forces a reload cycle that resets the video.

The fix: For snapshot posts, set `phRef.current` to the target position and let `syncClip` handle loading the correct clip. But don't null `loadedClipRef` if the new position is within the same clip — this avoids the full reload that causes the visual reset.

Replace the `handleSeek` callback (lines 349-369):

```ts
  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    if (clipsRef.current.length > 0) {
      // Snapshot post: seek within demo window
      const startUs = post.demoStartTime ?? 0;
      const demoDurUs = post.demoDuration ?? totalDurRef.current;
      const targetUs = startUs + ratio * demoDurUs;
      phRef.current = targetUs;
      setProgress(ratio * 100);

      // Only invalidate loaded clip if the target falls outside the current clip's range
      const currentClip = clipsRef.current.find((c) => c.id === loadedClipRef.current);
      if (!currentClip || targetUs < currentClip.startTime || targetUs >= currentClip.startTime + currentClip.duration) {
        loadedClipRef.current = null;
        loadedClipUrlRef.current = null;
      }

      // Seek the video element to the correct media offset within the target clip
      const targetClip = clipsRef.current.find((c) => targetUs >= c.startTime && targetUs < c.startTime + c.duration);
      if (targetClip && videoRef.current) {
        const mediaTime = (targetUs - targetClip.startTime + (targetClip.mediaOffset ?? 0)) / 1_000_000;
        videoRef.current.currentTime = mediaTime;
      }

      syncClip(targetUs);
    } else {
      // Simple video post
      const v = videoRef.current;
      if (v?.duration) {
        if (post.projectSnapshot) {
          const demoStartS = (post.demoStartTime ?? 0) / 1_000_000;
          const demoDurS = (post.demoDuration ?? 0) / 1_000_000 || v.duration;
          v.currentTime = demoStartS + ratio * demoDurS;
        } else {
          v.currentTime = ratio * v.duration;
        }
        setProgress(ratio * 100);
      }
    }
  }, [syncClip, post.demoStartTime, post.demoDuration]);
```

Key changes:
1. For snapshot posts: compute `targetUs` relative to the demo window (not raw totalDur), seek the video element directly to the correct media time.
2. Only invalidate `loadedClipRef` if the target is outside the current clip's range.
3. Move `setProgress` after computation for both paths.
4. Add `post.demoStartTime` and `post.demoDuration` to the dependency array.

- [ ] **Step 1: Read the current handleSeek and replace it**

Replace the `handleSeek` callback in `components/feed/theater/TheaterPlayer.tsx` with the fixed version above.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add components/feed/theater/TheaterPlayer.tsx
git commit -m "fix(feed): scrubber seeks to correct position instead of resetting

Compute target position relative to demo window for snapshot posts.
Only invalidate loaded clip when seeking outside current clip range.
Directly set video currentTime to the correct media offset."
```

---

### Task 4: Wire Feed Share & Comment Buttons

**Files:**
- Modify: `components/feed/theater/TheaterUI.tsx`
- Modify: `components/feed/feed-post-card.tsx`

Both files have Share and Comment buttons that are currently non-functional. Wire them:

- **Share:** Copy current URL to clipboard, show a brief "Link copied" toast.
- **Comment:** Show a brief "Coming Soon" toast.

#### Sub-step 4a: TheaterUI.tsx

- [ ] **Step 1: Add toast state and handlers to TheaterUI**

In `components/feed/theater/TheaterUI.tsx`, the component is a pure rendering layer that receives callbacks. We need to add minimal local state for the toast. Add `useState` to the React import (line 13):

```ts
import React, { useState } from "react";
```

Inside the `TheaterUI` function body, after the props destructuring (after line 85), add:

```ts
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).then(
      () => showToast("Link copied to clipboard"),
      () => showToast("Failed to copy link"),
    );
  };

  const handleComment = () => {
    showToast("Comments coming soon");
  };
```

- [ ] **Step 2: Wire the Comment button**

Find the Comment button (around line 252):
```tsx
        <button className="flex flex-col items-center gap-1">
```

Replace with:
```tsx
        <button onClick={handleComment} className="flex flex-col items-center gap-1">
```

- [ ] **Step 3: Wire the Share button**

Find the Share button (around line 259):
```tsx
        <button className="flex flex-col items-center gap-1">
```

Replace with:
```tsx
        <button onClick={handleShare} className="flex flex-col items-center gap-1">
```

- [ ] **Step 4: Add toast display**

Right before the closing `</>` of the component (just before the final `</>` around line 311), add:

```tsx
      {/* Action toast */}
      {toast && (
        <div className="pointer-events-none absolute left-1/2 bottom-14 z-[60] -translate-x-1/2 rounded-full bg-black/80 px-4 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
          {toast}
        </div>
      )}
```

#### Sub-step 4b: feed-post-card.tsx

- [ ] **Step 5: Add toast state and handlers to FeedPostCard**

In `components/feed/feed-post-card.tsx`, add `useCallback` to the existing import from React if not present (check line 3 — it already has `useRef, useState, useMemo, useEffect`). Add state after the existing state declarations (after line 34):

```ts
  const [toast, setToast] = useState<string | null>(null);
```

After the `useEffect` blocks (after line 90), add handlers:

```ts
  const handleShare = () => {
    setToast("Link copied to clipboard");
    navigator.clipboard.writeText(window.location.href).catch(() => {});
    setTimeout(() => setToast(null), 2000);
  };

  const handleComment = () => {
    setToast("Comments coming soon");
    setTimeout(() => setToast(null), 2000);
  };
```

- [ ] **Step 6: Wire the Comment button in the hover overlay**

Find the Comment button in the hover overlay (around line 204):
```tsx
              <button onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 text-[10px] text-white/60 hover:text-white/90">
                <MessageCircle size={11} /><span>{fmtK(post.comments)}</span>
              </button>
```

Replace with:
```tsx
              <button onClick={(e) => { e.stopPropagation(); handleComment(); }} className="flex items-center gap-0.5 text-[10px] text-white/60 hover:text-white/90">
                <MessageCircle size={11} /><span>{fmtK(post.comments)}</span>
              </button>
```

- [ ] **Step 7: Wire the Share button in the hover overlay**

Find the Share button (around line 207):
```tsx
              <button onClick={(e) => e.stopPropagation()} className="text-white/60 hover:text-white/90"><Share2 size={11} /></button>
```

Replace with:
```tsx
              <button onClick={(e) => { e.stopPropagation(); handleShare(); }} className="text-white/60 hover:text-white/90"><Share2 size={11} /></button>
```

- [ ] **Step 8: Add toast display to feed-post-card**

Inside the `<article>` element, right before the closing `</div>` of the aspect-ratio container (just before `</div>` around line 231), add:

```tsx
        {toast && (
          <div className="pointer-events-none absolute left-1/2 bottom-4 z-30 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-[9px] font-semibold text-white/90 backdrop-blur-sm">
            {toast}
          </div>
        )}
```

- [ ] **Step 9: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 10: Commit**

```bash
git add components/feed/theater/TheaterUI.tsx components/feed/feed-post-card.tsx
git commit -m "feat(feed): wire Share (clipboard copy) and Comment (coming soon) buttons

Share copies current URL to clipboard with confirmation toast.
Comment shows 'Coming Soon' toast. Applied to both TheaterUI
(full-screen feed) and FeedPostCard (grid view)."
```

---

### Task 5: Full E2E + Type Verification

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 2: Run full E2E suite**

Run: `npx playwright test --reporter=line`
Expected: 14 tests pass (was 15 — the restore test was removed). Zero regressions.

- [ ] **Step 3: Run unit tests**

Run: `npx vitest run lib/utils/coords.test.ts`
Expected: All pass.

- [ ] **Step 4: Final commit if needed**

Only if the above runs surface issues requiring fixes.
