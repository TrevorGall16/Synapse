# Timeline UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four critical UX polish issues — toolbar hit targets, restore hotkey conflict, restore enablement validation, and drag/indicator desync — without regressing the existing E2E suite.

**Architecture:** Surgical edits to existing files. No new files created. The drag desync fix addresses three root causes: a rogue CSS transition on the clip element, a missing ref assignment, and Zustand mutations inside the pointer-move hot path. Snap utility gets a pure variant that returns data without side effects.

**Tech Stack:** React 19, Zustand v5, Tailwind 4, Playwright (E2E)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `components/timeline/timeline-toolbar.tsx` | Modify | Increase hit targets, improve Btn component styling |
| `components/timeline/clip-event.tsx` | Modify | Assign clipRef, remove transition-transform during drag |
| `components/timeline/snap-indicator.tsx` | No change | Already correct (no transitions) |
| `components/timeline/clip-context-menu.tsx` | Modify | Use validateRestore for context menu gating |
| `components/timeline/restore-confirm-dialog.tsx` | Modify | Remove stale hotkey comment |
| `lib/utils/snap.ts` | Modify | Add pure snapToNearbyPure that returns data without store mutation |
| `e2e/razor-correctness.spec.ts` | Modify | Replace Ctrl+Shift+R with toolbar button click |

---

### Task 1: Toolbar Hit Target & Styling Upgrade

**Files:**
- Modify: `components/timeline/timeline-toolbar.tsx:187-194` (Btn component)
- Modify: `components/timeline/timeline-toolbar.tsx:103` (container gap)

- [ ] **Step 1: Update the Btn component for larger hit targets and better states**

In `timeline-toolbar.tsx`, replace the `Btn` function (lines 187-194):

```tsx
function Btn({ icon, label, disabled = false, onClick }: { icon: React.ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none ${disabled ? "cursor-not-allowed text-white/20" : "text-white/50 hover:bg-white/10 hover:text-white active:bg-white/20"}`}>
      {icon}
    </button>
  );
}
```

Changes: `p-1.5` → `p-2`, `rounded` → `rounded-md`, `focus-visible:ring-1` → `focus-visible:ring-2`, add `active:bg-white/20`.

- [ ] **Step 2: Increase icon sizes from 14 to 16 in toolbar action buttons**

In the toolbar JSX (lines 114-119), update every `<Btn>` icon size:

```tsx
<Btn icon={<Scissors size={16} />} label="Split (S)" disabled={!hasSelection} onClick={onSplit} />
<Btn icon={<Unlink size={16} />} label="Ungroup (U)" disabled={!hasSelection} onClick={onUngroup} />
<Btn icon={<Link size={16} />} label="Regroup (G)" disabled={selectedClipIds.length < 2} onClick={onRegroup} />
<Btn icon={<Trash2 size={16} />} label="Delete (Del)" disabled={!hasSelection} onClick={onDelete} />
<Btn icon={<Combine size={16} />} label="Heal (H)" disabled={selectedClipIds.length < 2} onClick={onHeal} />
<Btn icon={<RotateCcw size={16} />} label="Restore Original" disabled={!isRestoreValid} onClick={onRestoreOriginal} />
```

Also update Add Text / Add FX icons:

```tsx
<Btn icon={<Type size={16} />} label="Add Text" onClick={onAddText} />
<Btn icon={<Sparkles size={16} />} label="Add FX" onClick={onAddFx} />
```

- [ ] **Step 3: Increase container gap spacing**

On line 103, change `gap-1` to `gap-1.5`:

```tsx
<div className="flex items-center gap-1.5 px-2">
```

- [ ] **Step 4: Verify toolbar renders correctly**

Run: `npx next build` (or dev server) — confirm no compile errors.
Visual check: buttons should be visibly larger with more padding.

- [ ] **Step 5: Commit**

```bash
git add components/timeline/timeline-toolbar.tsx
git commit -m "style(toolbar): increase hit targets, improve hover/focus states"
```

---

### Task 2: Remove Restore Hotkey Conflict

**Files:**
- Modify: `components/timeline/restore-confirm-dialog.tsx:12` (stale comment)
- Modify: `e2e/razor-correctness.spec.ts:243-248` (test uses Ctrl+Shift+R)

- [ ] **Step 1: Update stale comment in restore-confirm-dialog.tsx**

On line 12, replace:

```tsx
 * Used by context menu, toolbar button, and Ctrl+Shift+R hotkey.
```

with:

```tsx
 * Used by context menu and toolbar button.
```

- [ ] **Step 2: Update E2E test to use toolbar button instead of keyboard shortcut**

In `e2e/razor-correctness.spec.ts`, replace lines 242-248:

```ts
    // Trigger Restore Original via keyboard shortcut — opens confirmation dialog
    await page.keyboard.press("Control+Shift+R");

    // Confirm in the RestoreConfirmDialog
    const restoreBtn = page.locator('button:has-text("Restore")').last();
    await expect(restoreBtn).toBeVisible({ timeout: 3_000 });
    await restoreBtn.click();
```

with:

```ts
    // Trigger Restore Original via toolbar button — opens confirmation dialog
    const restoreToolbarBtn = page.locator('button[aria-label="Restore Original"]');
    await expect(restoreToolbarBtn).toBeEnabled({ timeout: 3_000 });
    await restoreToolbarBtn.click();

    // Confirm in the RestoreConfirmDialog
    const restoreConfirmBtn = page.locator('button:has-text("Restore")').last();
    await expect(restoreConfirmBtn).toBeVisible({ timeout: 3_000 });
    await restoreConfirmBtn.click();
```

- [ ] **Step 3: Run the razor-correctness E2E test**

Run: `npx playwright test e2e/razor-correctness.spec.ts --reporter=line`
Expected: All 3 tests pass. The restore test now clicks the toolbar button instead of sending Ctrl+Shift+R.

- [ ] **Step 4: Commit**

```bash
git add components/timeline/restore-confirm-dialog.tsx e2e/razor-correctness.spec.ts
git commit -m "fix(restore): remove Ctrl+Shift+R hotkey conflict, update E2E to use toolbar button"
```

---

### Task 3: Bulletproof Restore Enablement

**Files:**
- Modify: `components/timeline/clip-context-menu.tsx:78-79` (use validateRestore for gating)

The shared validator `validateRestore` in `lib/store/project-helpers.ts` already exists and resolves clips from parent tracks (not stale `clip.trackId`). The toolbar already uses it via `canRestoreOriginal`. The context menu also calls `canRestoreOriginal` at line 79 — which delegates to `validateRestore`.

The context menu's conditional rendering at line 114 (`{canRestore && ...}`) is correct. The confirmation dialog also calls `canRestoreOriginal` on render. Both paths use the single source of truth.

**However**, the context menu at line 78 resolves `selectedClips` using `selectedClipIdsReactive` against flattened track clips — and then at line 95 passes `selectedClips.map(c => c.id)` to `restoreOriginalClips`. This is fine. But `performRestoreOriginal` (project-helpers.ts:489-495) validates using `clip.trackId` (the embedded field) rather than parent track membership. This is the real mismatch.

- [ ] **Step 1: Fix performRestoreOriginal to derive trackId from parent track, not clip field**

In `lib/store/project-helpers.ts`, replace lines 486-495 of `performRestoreOriginal`:

```ts
  // Collect selected clips with their resolved parent track ID
  const resolved: { clip: ClipEvent; parentTrackId: string }[] = [];
  for (const t of tracks) {
    for (const c of t.clips) {
      if (selectedClipIds.includes(c.id)) resolved.push({ clip: c, parentTrackId: t.id });
    }
  }
  if (resolved.length === 0) return { error: "Selected clips not found." };

  // Validate: all share one sourceId and one parent track
  const sourceId = resolved[0].clip.sourceId;
  const trackId = resolved[0].parentTrackId;
  if (!resolved.every((r) => r.clip.sourceId === sourceId))
    return { error: "Selected clips must share the same source." };
  if (!resolved.every((r) => r.parentTrackId === trackId))
    return { error: "Selected clips must be on the same track." };
```

And update subsequent references: change `selected` → `resolved.map(r => r.clip)` usage and `trackId` already refers to the parent track.

Full replacement for lines 478-562 of `performRestoreOriginal`:

```ts
export function performRestoreOriginal(
  tracks: Track[],
  selectedClipIds: string[],
  mediaPool: MediaPoolItem[]
): Track[] | { error: string } {
  if (selectedClipIds.length === 0) return { error: "No clips selected." };

  // Collect selected clips with their resolved parent track ID —
  // derives trackId from physical location, not from the clip's embedded field.
  const resolved: { clip: ClipEvent; parentTrackId: string }[] = [];
  for (const t of tracks) {
    for (const c of t.clips) {
      if (selectedClipIds.includes(c.id)) resolved.push({ clip: c, parentTrackId: t.id });
    }
  }
  if (resolved.length === 0) return { error: "Selected clips not found." };

  // Validate: all share one sourceId and one parent track
  const sourceId = resolved[0].clip.sourceId;
  const trackId = resolved[0].parentTrackId;
  if (!resolved.every((r) => r.clip.sourceId === sourceId))
    return { error: "Selected clips must share the same source." };
  if (!resolved.every((r) => r.parentTrackId === trackId))
    return { error: "Selected clips must be on the same track." };

  const selected = resolved.map((r) => r.clip);

  // Sync anchor: fragment with the earliest startTime
  const earliestFragment = selected.reduce((a, b) => (a.startTime <= b.startTime ? a : b));
  const latestEnd = selected.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
  const earliestStart = earliestFragment.startTime;

  // Scope: all clips on the target track with the same sourceId overlapping [earliestStart, latestEnd)
  const targetTrack = tracks.find((t) => t.id === trackId);
  if (!targetTrack) return { error: "Target track not found." };
  const scopeIds = new Set<string>();
  for (const c of targetTrack.clips) {
    if (
      c.sourceId === sourceId &&
      c.startTime < latestEnd &&
      c.startTime + c.duration > earliestStart
    ) {
      scopeIds.add(c.id);
    }
  }

  // Look up media in pool (optional — falls back to fragment-span when absent,
  // which is correct for test clips that have no pool entry)
  const media = mediaPool.find((m) => m.id === sourceId);

  // Compute sync-preserving anchor
  const rawStart = earliestFragment.startTime - earliestFragment.mediaOffset;
  let startTime: number;
  let mediaOffset: number;
  let duration: number;
  if (rawStart >= 0) {
    startTime = rawStart;
    mediaOffset = 0;
    // Full media duration when available; fall back to combined fragment span
    duration = media ? media.duration : latestEnd - rawStart;
  } else {
    // Media start would precede timeline origin — clamp and compensate
    startTime = 0;
    mediaOffset = -rawStart;
    const fullDuration = media ? media.duration : latestEnd - rawStart;
    duration = fullDuration - mediaOffset;
  }

  if (duration <= 0) return { error: "Restored clip would have zero or negative duration after clamping." };

  // Build the restored clip at explicit defaults (no inherited fx/fades/group)
  const restoredClip: ClipEvent = {
    id: crypto.randomUUID(),
    trackId,
    sourceId,
    startTime,
    duration,
    mediaOffset,
    level: 100,
    fadeInDuration: 0,
    fadeOutDuration: 0,
    manualFadeIn: false,
    manualFadeOut: false,
    groupId: undefined,
  };

  // Remove scope fragments, insert restored clip, recompute crossfades
  return tracks.map((t) => {
    if (t.id !== trackId) return t;
    const remaining = t.clips.filter((c) => !scopeIds.has(c.id));
    return { ...t, clips: computeCrossfades([...remaining, restoredClip]) };
  });
}
```

- [ ] **Step 2: Run E2E tests to verify no regression**

Run: `npx playwright test e2e/razor-correctness.spec.ts --reporter=line`
Expected: All 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add lib/store/project-helpers.ts
git commit -m "fix(restore): derive trackId from parent track, not stale clip field"
```

---

### Task 4: Fix Drag/Indicator Desync (3 Root Causes)

**Root Cause Analysis:**

| # | Bug | File:Line | Fix |
|---|-----|-----------|-----|
| 1 | `transition-transform` CSS class on clip root div | `clip-event.tsx:453` | Remove during drag; conditionally apply only when not dragging |
| 2 | `ref={clipRef}` never assigned to DOM element | `clip-event.tsx:452` | Add `ref={clipRef}` prop to the root div |
| 3 | `snapToNearby` calls `setSnapIndicator` (Zustand mutation) on every pointermove | `snap.ts:30,39,69` | Create `snapToNearbyPure` that returns data without side effects; use it in drag loop |

**Files:**
- Modify: `lib/utils/snap.ts` — extract pure function
- Modify: `components/timeline/clip-event.tsx:452-453` — assign ref, manage transition class

#### Sub-step 4a: Extract pure snap function

- [ ] **Step 1: Create snapToNearbyPure in snap.ts**

In `lib/utils/snap.ts`, add a new export above the existing `snapToNearby`. This function has identical logic but does NOT call `setSnapIndicator`. The original `snapToNearby` becomes a thin wrapper that calls the pure version and then updates the store.

Replace the entire file content:

```ts
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";

export interface SnapResult {
  time: number;
  isHard: boolean;
}

/**
 * Pure snap calculation — returns { time, isHard } with NO store side effects.
 * Use this in drag loops where the caller manages indicator updates directly.
 */
export function snapToNearbyPure(micros: number, pps: number, excludeClipId: string): SnapResult {
  const hardThreshold  = Math.round((10 / pps) * 1_000_000);
  const markerThreshold = Math.round((12 / pps) * 1_000_000);
  const softThreshold  = Math.round((8  / pps) * 1_000_000);

  const { globalBpm, playheadPosition } = usePlaybackStore.getState();
  const { markers, tracks } = useProjectStore.getState();

  // ── Priority #0: ClipA.end → ClipB.start (Perfect Cut / Hard Snap) ──
  for (const t of tracks) {
    for (const c of t.clips) {
      if (c.id === excludeClipId) continue;
      const clipEnd = c.startTime + c.duration;
      if (Math.abs(micros - clipEnd) < hardThreshold) {
        return { time: clipEnd, isHard: true };
      }
    }
  }

  // ── Priority #1: User markers (stronger threshold) ──
  for (const marker of markers) {
    if (Math.abs(micros - marker.time) < markerThreshold) {
      return { time: marker.time, isHard: false };
    }
  }

  // ── Priority #2: BPM, playhead, clip starts/ends ──
  let snapped = micros;
  let bestDist = softThreshold;

  if (globalBpm > 0) {
    const beatMicros = Math.round(60_000_000 / globalBpm);
    const nearest = Math.round(micros / beatMicros) * beatMicros;
    const d = Math.abs(micros - nearest);
    if (d < bestDist) { bestDist = d; snapped = nearest; }
  }

  const pd = Math.abs(micros - playheadPosition);
  if (pd < bestDist) { bestDist = pd; snapped = playheadPosition; }

  for (const t of tracks) {
    for (const c of t.clips) {
      if (c.id === excludeClipId) continue;
      for (const edge of [c.startTime, c.startTime + c.duration]) {
        const d = Math.abs(micros - edge);
        if (d < bestDist) { bestDist = d; snapped = edge; }
      }
    }
  }

  return { time: Math.round(snapped), isHard: snapped !== micros };
}

/** Priority-based snap with store side-effect (updates snap indicator).
 *  Use this for non-drag contexts (edge trim, etc.) where store-driven
 *  rendering is acceptable. */
export function snapToNearby(micros: number, pps: number, excludeClipId: string): SnapResult {
  const result = snapToNearbyPure(micros, pps, excludeClipId);
  const didSnap = result.time !== micros;
  usePlaybackStore.getState().setSnapIndicator(didSnap ? result.time : null, result.isHard);
  return result;
}
```

- [ ] **Step 2: Verify existing callers still work**

`snapToNearby` (with side effects) is used by:
- `clip-event.tsx` edge trim handlers (lines 276, 280) — these are fine, they use the store-driven path.

`snapToNearby` in the main drag loop (`clip-event.tsx:201`) will be changed to `snapToNearbyPure` in the next sub-step.

No other callers exist (verify with grep).

Run: `grep -rn "snapToNearby" --include="*.tsx" --include="*.ts" components/ lib/`

- [ ] **Step 3: Commit**

```bash
git add lib/utils/snap.ts
git commit -m "refactor(snap): extract pure snapToNearbyPure without store side effects"
```

#### Sub-step 4b: Fix clip-event.tsx (ref assignment, transition, pure snap)

- [ ] **Step 4: Add ref={clipRef} to the clip root div**

In `clip-event.tsx`, on the root `<div>` (line 452), add `ref={clipRef}`:

```tsx
    <div
      ref={clipRef}
      className={`absolute top-0 flex h-full cursor-grab select-none items-center overflow-hidden transition-transform active:cursor-grabbing ${
```

- [ ] **Step 5: Remove transition-transform during drag**

The `transition-transform` class causes 150ms CSS animation that desyncs from instant indicator updates. Add a `useState` to track drag state for the className, and strip the transition during active drag.

Add to component state (after line 77):

```ts
const [isDraggingState, setIsDraggingState] = useState(false);
```

In `onPointerDown` (after line 119, where `isDragging.current = true`):

```ts
setIsDraggingState(true);
```

In `onPointerUp` (after line 244, where `isDragging.current = false`):

```ts
setIsDraggingState(false);
```

Update the root div className (line 453) — replace `transition-transform` with a conditional:

```tsx
      className={`absolute top-0 flex h-full cursor-grab select-none items-center overflow-hidden ${isDraggingState ? "" : "transition-transform"} active:cursor-grabbing ${
        isSelected ? "ring-2 ring-white" : isDropTarget ? "ring-2 ring-purple-400" : isPulsing ? "ring-2 ring-purple-300" : ""
      } ${hasLeftNeighbor ? "rounded-r" : hasRightNeighbor ? "rounded-l" : "rounded"}`}
```

- [ ] **Step 6: Switch drag loop to snapToNearbyPure**

In `clip-event.tsx`, update the import (line 12):

```ts
import { snapToNearbyPure, snapToNearby } from "@/lib/utils/snap";
```

In `onPointerMove` (line 201), replace `snapToNearby` with `snapToNearbyPure`:

```ts
        const result = snapToNearbyPure(virtualTime, pixelsPerSecond, clip.id);
```

This eliminates the Zustand mutation from the hot path. The direct DOM write via `updateIndicatorDOM` is the sole indicator update during drag.

- [ ] **Step 7: Verify the full drag path is now correct**

Audit checklist:
1. `clipRef` is assigned → direct DOM write on line 218 now executes ✓
2. No `transition-transform` during drag → instant position update ✓
3. `snapToNearbyPure` has zero store mutations → no React re-render fight ✓
4. Both clip (line 217-218) and indicator (line 221) use `newStart` from same computation ✓
5. Store commit only on pointer-up (line 237-240) ✓

- [ ] **Step 8: Commit**

```bash
git add components/timeline/clip-event.tsx
git commit -m "fix(drag): assign clipRef, disable transition during drag, use pure snap in move loop

Root causes of clip/indicator desync:
1. transition-transform on clip div caused 150ms CSS animation lag
2. ref={clipRef} was never assigned — direct DOM writes were no-ops
3. snapToNearby called setSnapIndicator (Zustand) every pointermove,
   triggering React re-renders that fought with direct DOM updates"
```

---

### Task 5: Full E2E Verification

- [ ] **Step 1: Run the complete E2E suite**

Run: `npx playwright test --reporter=line`
Expected: All tests pass. No regressions from toolbar, restore, or drag changes.

- [ ] **Step 2: Run unit tests**

Run: `npx vitest run lib/utils/coords.test.ts`
Expected: All pass.

- [ ] **Step 3: Final commit (if any lint/type fixes needed)**

Only if the above runs surface issues. Otherwise, the work is complete.
