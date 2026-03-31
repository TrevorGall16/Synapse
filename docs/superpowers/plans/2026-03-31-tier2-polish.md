# Tier 2 UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix zoom coordinate desync, add horizontal pan mini-navigator, and implement Restore Original macro — all TDD-first, TypeScript-gated, atomic commits per task.

**Architecture:** Three sequential workstreams — (1) coordinate utility extraction + migration, (2) restore macro with full TDD, (3) timeline panning polish — each capped with a TypeScript gate before commit. Phase 4 runs E2E and the final audit.

**Tech Stack:** TypeScript 5, React 19, Zustand 5, Vitest, Playwright, GlobalTicker (internal RAF-based scheduler)

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| **Create** | `lib/utils/coords.ts` | 4 pure coordinate functions |
| **Create** | `lib/utils/coords.test.ts` | 6 unit tests |
| **Create** | `components/timeline/scroll-navigator.tsx` | DOM-only range-input mini-map |
| **Modify** | `lib/store/project-helpers.ts` | Add `performRestoreOriginal` |
| **Modify** | `lib/store/project-helpers.test.ts` | Add 5 restore invariant tests |
| **Modify** | `lib/store/project-store.ts` | Add `restoreOriginalClips` action |
| **Modify** | `components/timeline/clip-event.tsx` | Replace 3 inline coord expressions |
| **Modify** | `components/timeline/zoom-slider.tsx` | Replace 2 inline coord expressions |
| **Modify** | `components/studio/timeline.tsx` | contentWidth fix, ScrollNavigator, Ctrl+Shift+R |
| **Modify** | `components/timeline/clip-context-menu.tsx` | Restore Original item + inline confirm |
| **Modify** | `e2e/razor-correctness.spec.ts` | Restore Original E2E scenario |

---

## Phase 1 — Coordinate Utility (TDD)

### Task 1: Write failing coordinate unit tests

**Files:**
- Create: `lib/utils/coords.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// lib/utils/coords.test.ts
import { describe, it, expect } from "vitest";
import {
  screenPxToTimelinePx,
  timelinePxToTimeMicros,
  timeMicrosToTimelinePx,
  screenXToTimeMicros,
} from "./coords";

function mockRect(left: number): DOMRect {
  return {
    left,
    right: left + 800,
    top: 0,
    bottom: 600,
    width: 800,
    height: 600,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("screenPxToTimelinePx", () => {
  it("subtracts rect.left and adds scrollLeft", () => {
    // clientX=350, rect.left=50, scrollLeft=200 → 350 - 50 + 200 = 500
    expect(screenPxToTimelinePx(350, mockRect(50), 200)).toBe(500);
  });
});

describe("screenXToTimeMicros", () => {
  it("zero scroll, zoom 1.0 (pps=100), clientX=300, rect.left=0 → 3_000_000µs", () => {
    expect(screenXToTimeMicros(300, mockRect(0), 0, 100)).toBe(3_000_000);
  });

  it("500px scroll offset, pps=100, clientX=300 → 8_000_000µs", () => {
    // (300 - 0 + 500) / 100 * 1_000_000 = 8_000_000
    expect(screenXToTimeMicros(300, mockRect(0), 500, 100)).toBe(8_000_000);
  });

  it("zoom 0.1 (pps=10), zero scroll, clientX=100 → 10_000_000µs", () => {
    expect(screenXToTimeMicros(100, mockRect(0), 0, 10)).toBe(10_000_000);
  });

  it("zoom 3.0 (pps=300), zero scroll, clientX=300 → 1_000_000µs", () => {
    expect(screenXToTimeMicros(300, mockRect(0), 0, 300)).toBe(1_000_000);
  });
});

describe("round-trip", () => {
  it("timeMicrosToTimelinePx → timelinePxToTimeMicros is identity within 1µs", () => {
    const t = 7_500_000;
    const pps = 150;
    const px = timeMicrosToTimelinePx(t, pps);
    const result = timelinePxToTimeMicros(px, pps);
    expect(Math.abs(result - t)).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
npx vitest run lib/utils/coords.test.ts
```
Expected: FAIL — `Cannot find module './coords'`

---

### Task 2: Implement `lib/utils/coords.ts`

**Files:**
- Create: `lib/utils/coords.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// lib/utils/coords.ts

/**
 * Convert pointer clientX to timeline-local pixels.
 * Accounts for container origin (rect.left) and horizontal scroll offset.
 */
export function screenPxToTimelinePx(
  clientX: number,
  rect: DOMRect,
  scrollLeft: number
): number {
  return clientX - rect.left + scrollLeft;
}

/**
 * Convert timeline-local pixels to microseconds.
 */
export function timelinePxToTimeMicros(
  px: number,
  pixelsPerSecond: number
): number {
  return (px / pixelsPerSecond) * 1_000_000;
}

/**
 * Convert microseconds to timeline-local pixels (for rendering clip positions).
 */
export function timeMicrosToTimelinePx(
  micros: number,
  pixelsPerSecond: number
): number {
  return (micros / 1_000_000) * pixelsPerSecond;
}

/**
 * Compound convenience: clientX → microseconds in one call.
 * Use this for click/drag/scrub handlers on the timeline container.
 */
export function screenXToTimeMicros(
  clientX: number,
  rect: DOMRect,
  scrollLeft: number,
  pixelsPerSecond: number
): number {
  return timelinePxToTimeMicros(
    screenPxToTimelinePx(clientX, rect, scrollLeft),
    pixelsPerSecond
  );
}
```

- [ ] **Step 2: Run coord tests — confirm all 6 pass**

```bash
npx vitest run lib/utils/coords.test.ts
```
Expected: 6 passed, 0 failed.

- [ ] **Step 3: Commit**

```bash
git add lib/utils/coords.ts lib/utils/coords.test.ts
git commit -m "feat(coords): add pure coordinate utility with unit tests"
```

---

### Task 3: Migrate `clip-event.tsx` to coord utility

**Files:**
- Modify: `components/timeline/clip-event.tsx`

The file has three inline coordinate expressions to replace.

- [ ] **Step 1: Add import**

Find the existing import block at the top of the file. Add after the last import line:

```typescript
import { timeMicrosToTimelinePx, timelinePxToTimeMicros } from "@/lib/utils/coords";
```

- [ ] **Step 2: Replace xPx and wPx (~line 73–74)**

Old:
```typescript
const xPx = (clip.startTime / 1_000_000) * pixelsPerSecond;
const wPx = (clip.duration / 1_000_000) * pixelsPerSecond;
```

New:
```typescript
const xPx = timeMicrosToTimelinePx(clip.startTime, pixelsPerSecond);
const wPx = timeMicrosToTimelinePx(clip.duration, pixelsPerSecond);
```

- [ ] **Step 3: Replace clickTime in `onPointerDown` (~line 107–108)**

Old:
```typescript
const rect = e.currentTarget.getBoundingClientRect();
const clickTime = clip.startTime + Math.round(((e.clientX - rect.left) / pixelsPerSecond) * 1_000_000);
```

New:
```typescript
const rect = e.currentTarget.getBoundingClientRect();
const clickTime = clip.startTime + Math.round(timelinePxToTimeMicros(e.clientX - rect.left, pixelsPerSecond));
```

Note: `scrollLeft` is NOT added here because `rect` belongs to the clip element itself — this measures the offset within the clip, not an absolute timeline position.

- [ ] **Step 4: Replace virtualTime in `onPointerMove` (~line 137–138)**

Old:
```typescript
const totalDeltaX = e.clientX - dragAnchorX.current;
const virtualTime = Math.max(0, dragAnchorTime.current + Math.round((totalDeltaX / pixelsPerSecond) * 1_000_000));
```

New:
```typescript
const totalDeltaX = e.clientX - dragAnchorX.current;
const virtualTime = Math.max(0, dragAnchorTime.current + Math.round(timelinePxToTimeMicros(totalDeltaX, pixelsPerSecond)));
```

- [ ] **Step 5: TypeScript gate**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

---

### Task 4: Migrate `timeline.tsx` to coord utility

**Files:**
- Modify: `components/studio/timeline.tsx`

- [ ] **Step 1: Update React import (line 3) to include `useMemo`**

Old:
```typescript
import { useRef, useCallback, useEffect } from "react";
```

New:
```typescript
import { useRef, useCallback, useEffect, useMemo } from "react";
```

- [ ] **Step 2: Add coord import after existing imports**

```typescript
import { screenXToTimeMicros, screenPxToTimelinePx } from "@/lib/utils/coords";
```

- [ ] **Step 3: Add `containerWidth` store subscription (after `duration` on ~line 94)**

After:
```typescript
const duration = useProjectStore((s) => s.duration);
```

Add:
```typescript
const containerWidth = usePlaybackStore((s) => s.containerWidth);
```

- [ ] **Step 4: Replace `contentWidth` with a `useMemo` (~line 119)**

Old:
```typescript
const contentWidth = (duration / 1_000_000) * pixelsPerSecond;
```

New:
```typescript
const contentWidth = useMemo(
  () => Math.max(containerWidth, (duration / 1_000_000) * pixelsPerSecond + 200),
  [duration, pixelsPerSecond, containerWidth]
);
```

- [ ] **Step 5: Replace `onTrackAreaClick` coordinate math (~line 113)**

Old:
```typescript
const clickedMicros = Math.max(0, Math.round(((e.clientX - rect.left + container.scrollLeft) / pixelsPerSecond) * 1_000_000));
```

New:
```typescript
const clickedMicros = Math.max(0, Math.round(screenXToTimeMicros(e.clientX, rect, container.scrollLeft, pixelsPerSecond)));
```

- [ ] **Step 6: Replace `onWheel` zoom anchor math (~line 130)**

Find in `onWheel`:
```typescript
const mouseX = e.clientX - rect.left;
const timeAtMouse = (container.scrollLeft + mouseX) / oldPPS;
```

Replace the `timeAtMouse` line only (keep `mouseX` — it's still used on the next line for `container.scrollLeft`):
```typescript
const mouseX = e.clientX - rect.left;
const timeAtMouse = screenPxToTimelinePx(e.clientX, rect, container.scrollLeft) / oldPPS;
```

- [ ] **Step 7: TypeScript gate**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

---

### Task 5: Migrate `zoom-slider.tsx` to coord utility

**Files:**
- Modify: `components/timeline/zoom-slider.tsx`

- [ ] **Step 1: Add import**

```typescript
import { timeMicrosToTimelinePx } from "@/lib/utils/coords";
```

- [ ] **Step 2: Replace both playhead pixel calculations in `onPointerUp` (~lines 64, 71)**

Old:
```typescript
const playheadPx = (playheadPosition / 1_000_000) * oldPPS;
const playheadScreenX = playheadPx - container.scrollLeft;

setZoom(finalZoom);

const clampedZoom = Math.max(0.001, Math.min(3, finalZoom));
const newPPS = 100 * clampedZoom;
const newPlayheadPx = (playheadPosition / 1_000_000) * newPPS;
container.scrollLeft = newPlayheadPx - playheadScreenX;
```

New:
```typescript
const playheadPx = timeMicrosToTimelinePx(playheadPosition, oldPPS);
const playheadScreenX = playheadPx - container.scrollLeft;

setZoom(finalZoom);

const clampedZoom = Math.max(0.001, Math.min(3, finalZoom));
const newPPS = 100 * clampedZoom;
const newPlayheadPx = timeMicrosToTimelinePx(playheadPosition, newPPS);
container.scrollLeft = newPlayheadPx - playheadScreenX;
```

- [ ] **Step 3: TypeScript gate + full Phase 1 test run**

```bash
npx tsc --noEmit
npx vitest run lib/utils/coords.test.ts
```
Expected: 0 TypeScript errors, 6 tests pass.

- [ ] **Step 4: Commit Phase 1**

```bash
git add components/timeline/clip-event.tsx components/timeline/zoom-slider.tsx components/studio/timeline.tsx
git commit -m "refactor(coords): migrate all inline coordinate math to coords utility"
```

---

## Phase 2 — Restore Original Macro (TDD)

### Task 6: Write failing restore unit tests

**Files:**
- Modify: `lib/store/project-helpers.test.ts`

- [ ] **Step 1: Add imports at the top of the existing test file**

The file already imports `{ performSplitClip, performBulkSplit }`. Add `performRestoreOriginal` to that import and add the `MediaPoolItem` type import:

```typescript
import { performSplitClip, performBulkSplit, performRestoreOriginal } from "./project-helpers";
import type { Track, ClipEvent, MediaPoolItem } from "./types";
```

(The file already imports `Track` and `ClipEvent` — consolidate into one `import type` statement.)

- [ ] **Step 2: Add the `makeMedia` fixture after `makeTrack`**

```typescript
function makeMedia(overrides: Partial<MediaPoolItem> = {}): MediaPoolItem {
  return {
    id: "asset-A",
    name: "test-video.mp4",
    type: "video",
    duration: 10_000_000, // 10s in microseconds
    ...overrides,
  };
}
```

- [ ] **Step 3: Append the 5 restore test cases after the last `describe` block**

```typescript
// ══════════════════════════════════════════════════════════════════════
// performRestoreOriginal
// ══════════════════════════════════════════════════════════════════════

describe("performRestoreOriginal", () => {
  // Test 1: Frame sync preservation
  it("sync anchor: restored startTime = earliestFragment.startTime - earliestFragment.mediaOffset", () => {
    // clip at startTime=5s, mediaOffset=2s → rawStart = 3s
    const clip = makeClip({
      startTime: 5_000_000,
      mediaOffset: 2_000_000,
      duration: 4_000_000,
      sourceId: "asset-A",
    });
    const tracks = [makeTrack([clip])];
    const media = makeMedia({ id: "asset-A", duration: 10_000_000 });

    const result = performRestoreOriginal(tracks, [clip.id], [media]);
    expect("error" in result).toBe(false);
    const restored = (result as Track[])[0].clips[0];

    expect(restored.startTime).toBe(3_000_000);   // 5_000_000 - 2_000_000
    expect(restored.mediaOffset).toBe(0);
    expect(restored.duration).toBe(10_000_000);    // full media.duration
  });

  // Test 2: Negative start clamped
  it("clamps negative rawStart: startTime=0, mediaOffset compensates, duration adjusted", () => {
    // rawStart = 1s - 3s = -2s → clamp to 0, mediaOffset = 2s, duration = 8s - 2s = 6s
    const clip = makeClip({
      startTime: 1_000_000,
      mediaOffset: 3_000_000,
      duration: 5_000_000,
      sourceId: "asset-B",
    });
    const tracks = [makeTrack([clip])];
    const media = makeMedia({ id: "asset-B", duration: 8_000_000 });

    const result = performRestoreOriginal(tracks, [clip.id], [media]);
    expect("error" in result).toBe(false);
    const restored = (result as Track[])[0].clips[0];

    expect(restored.startTime).toBe(0);
    expect(restored.mediaOffset).toBe(2_000_000);
    expect(restored.duration).toBe(6_000_000);     // 8_000_000 - 2_000_000
  });

  // Test 3: Unrelated clip on same track is untouched
  it("leaves clips with a different sourceId on the same track unchanged", () => {
    const target = makeClip({
      id: "clip-target",
      startTime: 0,
      duration: 10_000_000,
      sourceId: "asset-A",
    });
    const other = makeClip({
      id: "clip-other",
      startTime: 15_000_000,
      duration: 3_000_000,
      sourceId: "asset-Z",
    });
    const tracks = [makeTrack([target, other])];
    const media = makeMedia({ id: "asset-A", duration: 10_000_000 });

    const result = performRestoreOriginal(tracks, [target.id], [media]);
    expect("error" in result).toBe(false);
    const clips = (result as Track[])[0].clips;

    const otherClip = clips.find((c) => c.id === "clip-other");
    expect(otherClip).toBeDefined();
    expect(otherClip!.startTime).toBe(15_000_000);
    expect(otherClip!.duration).toBe(3_000_000);
    expect(otherClip!.sourceId).toBe("asset-Z");
  });

  // Test 4: refCount invariance — mediaPool is not mutated
  it("does not mutate the mediaPool (refCount invariance)", () => {
    const clip = makeClip({ sourceId: "asset-A" });
    const tracks = [makeTrack([clip])];
    const media = makeMedia({ id: "asset-A" });
    const snapshot = JSON.stringify(media);

    performRestoreOriginal(tracks, [clip.id], [media]);

    expect(JSON.stringify(media)).toBe(snapshot);
  });

  // Test 5: Split-then-restore round-trip
  it("multi-split then restore: returns 1 clip with correct sync anchor", () => {
    // Original: startTime=0, mediaOffset=0, duration=10s
    const original = makeClip({
      startTime: 0,
      mediaOffset: 0,
      duration: 10_000_000,
      sourceId: "asset-A",
    });
    const tracks = [makeTrack([original])];
    const media = makeMedia({ id: "asset-A", duration: 10_000_000 });

    // Split at 3s
    const after1 = performBulkSplit(tracks, [original.id], 3_000_000);
    // Split second fragment at 7s
    const secondId = after1[0].clips[1].id;
    const after2 = performBulkSplit(after1, [secondId], 7_000_000);
    expect(after2[0].clips).toHaveLength(3);

    // Restore all 3 fragments
    const allIds = after2[0].clips.map((c) => c.id);
    const result = performRestoreOriginal(after2, allIds, [media]);
    expect("error" in result).toBe(false);
    const clips = (result as Track[])[0].clips;

    expect(clips).toHaveLength(1);
    // rawStart = 0 - 0 = 0
    expect(clips[0].startTime).toBe(0);
    expect(clips[0].mediaOffset).toBe(0);
    expect(clips[0].duration).toBe(10_000_000);
  });
});
```

- [ ] **Step 4: Run to confirm FAIL**

```bash
npx vitest run lib/store/project-helpers.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: existing tests pass, 5 new tests FAIL — `performRestoreOriginal is not exported`

---

### Task 7: Implement `performRestoreOriginal` in project-helpers.ts

**Files:**
- Modify: `lib/store/project-helpers.ts`

- [ ] **Step 1: Add `MediaPoolItem` to the type import (line 1)**

Old:
```typescript
import type { Track, TrackType, ClipEvent } from "./types";
```

New:
```typescript
import type { Track, TrackType, ClipEvent, MediaPoolItem } from "./types";
```

- [ ] **Step 2: Append the function after `computeCrossfades` at the bottom of the file**

```typescript
/**
 * Restore selected fragments sharing a single sourceId to one uncut clip.
 *
 * ## Deterministic Placement Rule
 * 1. All selected clips must share one `sourceId` and one `trackId`.
 * 2. Scope: every clip on the same track with matching `sourceId` whose range
 *    overlaps `[earliestStart, latestEnd)` — catches unselected gap fragments.
 * 3. Sync-preserving anchor:
 *      rawStart = earliestFragment.startTime - earliestFragment.mediaOffset
 *    - rawStart >= 0 → startTime = rawStart, mediaOffset = 0, duration = media.duration
 *    - rawStart <  0 → startTime = 0, mediaOffset = -rawStart, duration = media.duration - mediaOffset
 * 4. refCount: no change — split/restore are timeline-fragment operations only.
 *
 * @returns Updated `Track[]` on success, or `{ error: string }` on validation failure.
 */
export function performRestoreOriginal(
  tracks: Track[],
  selectedClipIds: string[],
  mediaPool: MediaPoolItem[]
): Track[] | { error: string } {
  if (selectedClipIds.length === 0) return { error: "No clips selected." };

  // Collect selected clips across all tracks
  const selected: ClipEvent[] = [];
  for (const t of tracks) {
    for (const c of t.clips) {
      if (selectedClipIds.includes(c.id)) selected.push(c);
    }
  }
  if (selected.length === 0) return { error: "Selected clips not found." };

  // Validate: all share one sourceId and one trackId
  const sourceId = selected[0].sourceId;
  const trackId = selected[0].trackId;
  if (!selected.every((c) => c.sourceId === sourceId))
    return { error: "Selected clips must share the same source." };
  if (!selected.every((c) => c.trackId === trackId))
    return { error: "Selected clips must be on the same track." };

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

  // Look up media in pool
  const media = mediaPool.find((m) => m.id === sourceId);
  if (!media) return { error: "Source media not found in pool." };

  // Compute sync-preserving anchor
  const rawStart = earliestFragment.startTime - earliestFragment.mediaOffset;
  let startTime: number;
  let mediaOffset: number;
  let duration: number;
  if (rawStart >= 0) {
    startTime = rawStart;
    mediaOffset = 0;
    duration = media.duration;
  } else {
    // Media start would precede timeline origin — clamp and compensate
    startTime = 0;
    mediaOffset = -rawStart;
    duration = media.duration - mediaOffset;
  }

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

- [ ] **Step 3: Run restore tests — confirm all 5 pass**

```bash
npx vitest run lib/store/project-helpers.test.ts
```
Expected: all existing tests + all 5 new restore tests pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add lib/store/project-helpers.ts lib/store/project-helpers.test.ts
git commit -m "feat(restore): implement performRestoreOriginal with sync-preserving anchor and full TDD coverage"
```

---

### Task 8: Add `restoreOriginalClips` store action

**Files:**
- Modify: `lib/store/project-store.ts`

- [ ] **Step 1: Add `performRestoreOriginal` to the project-helpers import (~line 9–15)**

Old:
```typescript
import {
  TRACK_COLORS, TRACK_HEIGHTS,
  createTrack, findClipLocation,
  findClipsByGroupId, computeMove,
  performSplitClip, performBulkSplit,
  computeCrossfades, performJoinClips, performDeleteClips,
} from "./project-helpers";
```

New:
```typescript
import {
  TRACK_COLORS, TRACK_HEIGHTS,
  createTrack, findClipLocation,
  findClipsByGroupId, computeMove,
  performSplitClip, performBulkSplit,
  computeCrossfades, performJoinClips, performDeleteClips,
  performRestoreOriginal,
} from "./project-helpers";
```

- [ ] **Step 2: Add the action signature to the `ProjectState` interface**

Find `joinClips: (clipIds: string[]) => void;` in the interface and add after it:

```typescript
  restoreOriginalClips: (clipIds: string[]) => void;
```

- [ ] **Step 3: Add the action implementation**

Find the `joinClips` action implementation inside `create<ProjectState>()(persist((set) => ({` and add the new action after it:

```typescript
  restoreOriginalClips: (clipIds) =>
    set((s) => {
      const result = performRestoreOriginal(s.tracks, clipIds, s.mediaPool);
      if ("error" in result) return s; // UI pre-validates selection before calling
      const past = [
        ...s.historyPast.slice(-(MAX_HISTORY - 1)),
        { tracks: s.tracks, duration: s.duration, markers: s.markers, label: "Restore Original" },
      ];
      useSaveBarrierStore.getState().setDirty(true);
      return { tracks: result, historyPast: past, historyFuture: [] };
    }),
```

- [ ] **Step 4: TypeScript gate**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/store/project-store.ts
git commit -m "feat(restore): add restoreOriginalClips store action with history + dirty flag"
```

---

### Task 9: Add Restore Original to context menu

**Files:**
- Modify: `components/timeline/clip-context-menu.tsx`

- [ ] **Step 1: Add missing imports at the top of the file**

Add `useState` to the React import (the file currently doesn't import it):
```typescript
import { useEffect, useRef, useState } from "react";
```

Add `RotateCcw` to the lucide-react import (existing line has `Scissors, Copy, Trash2, VolumeX, Volume2, Layers`):
```typescript
import { Scissors, Copy, Trash2, VolumeX, Volume2, Layers, RotateCcw } from "lucide-react";
```

- [ ] **Step 2: Add the confirm-dialog state and restore handler inside `ClipContextMenu`**

Add after the existing `const track = ...` and `const isMuted = ...` lines at the bottom of the variable declarations section:

```typescript
const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

// Restore Original — only available when full selection shares one sourceId and one trackId
const { selectedClipIds, tracks: allTracks } = useProjectStore.getState();
const selectedClips = allTracks.flatMap((t) => t.clips).filter((c) => selectedClipIds.includes(c.id));
const canRestore =
  selectedClips.length > 0 &&
  selectedClips.every((c) => c.sourceId === selectedClips[0].sourceId) &&
  selectedClips.every((c) => c.trackId === selectedClips[0].trackId);

// Compute human-readable bounds for the confirmation message
const restoreMediaName = (() => {
  if (!canRestore) return "";
  const { mediaPool } = useProjectStore.getState();
  const media = mediaPool.find((m) => m.id === selectedClips[0].sourceId);
  return media?.name ?? selectedClips[0].sourceId;
})();

const formatTimeSec = (us: number) => `${(us / 1_000_000).toFixed(2)}s`;
const restoreEarliest = canRestore ? Math.min(...selectedClips.map((c) => c.startTime)) : 0;
const restoreLatest = canRestore
  ? Math.max(...selectedClips.map((c) => c.startTime + c.duration))
  : 0;

const onRestoreConfirmed = () => {
  useProjectStore.getState().restoreOriginalClips(selectedClipIds);
  onClose();
};
```

- [ ] **Step 3: Add the menu item and inline confirmation dialog to the JSX**

In the JSX, add the "Restore Original" menu item between the `Inspect Clip` item and the last separator. Find the section that reads:

```tsx
<MenuItem icon={<Layers size={11} />} label="Inspect Clip" onClick={onInspect} />
<div className="my-1 h-px bg-white/8" />
<MenuItem icon={<Trash2 size={11} />} label="Delete" onClick={onDelete} danger />
```

Replace with:

```tsx
<MenuItem icon={<Layers size={11} />} label="Inspect Clip" onClick={onInspect} />
{canRestore && (
  <>
    <div className="my-1 h-px bg-white/8" />
    <MenuItem
      icon={<RotateCcw size={11} />}
      label="Restore Original"
      onClick={() => setShowRestoreConfirm(true)}
    />
  </>
)}
<div className="my-1 h-px bg-white/8" />
<MenuItem icon={<Trash2 size={11} />} label="Delete" onClick={onDelete} danger />

{showRestoreConfirm && (
  <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60">
    <div className="w-80 rounded-xl border border-white/15 bg-[#1e1e1e] p-5 shadow-2xl shadow-black/80">
      <p className="mb-1 text-[13px] font-semibold text-white">Restore Original Clip</p>
      <p className="mb-4 text-[11px] leading-relaxed text-white/60">
        Revert <span className="font-medium text-white/80">{selectedClips.length} fragment{selectedClips.length !== 1 ? "s" : ""}</span> of{" "}
        <span className="font-medium text-white/80">&apos;{restoreMediaName}&apos;</span> between{" "}
        <span className="tabular-nums text-white/80">{formatTimeSec(restoreEarliest)}</span> –{" "}
        <span className="tabular-nums text-white/80">{formatTimeSec(restoreLatest)}</span> to one uncut clip?
        All cuts in this range will be removed.
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowRestoreConfirm(false)}
          className="rounded-md px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
        >
          Cancel
        </button>
        <button
          onClick={onRestoreConfirmed}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-500"
        >
          Restore
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: TypeScript gate**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

---

### Task 10: Add Ctrl+Shift+R keyboard shortcut

**Files:**
- Modify: `components/studio/timeline.tsx`

- [ ] **Step 1: Add the keyboard handler inside the existing `handleKeyDown` in `useEffect`**

Find the existing keyboard handler block. Add after the `Delete/Backspace` handler (after the `if (e.key === "Delete" || e.key === "Backspace") { ... }` block):

```typescript
// Ctrl+Shift+R / Cmd+Shift+R — Restore Original (silent no-op if selection is invalid)
if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "R") {
  e.preventDefault();
  if (selectedClipIds.length === 0) return;
  const { tracks: allTracks, mediaPool } = useProjectStore.getState();
  const selClips = allTracks.flatMap((t) => t.clips).filter((c) => selectedClipIds.includes(c.id));
  const isValid =
    selClips.length > 0 &&
    selClips.every((c) => c.sourceId === selClips[0].sourceId) &&
    selClips.every((c) => c.trackId === selClips[0].trackId) &&
    mediaPool.some((m) => m.id === selClips[0].sourceId);
  if (!isValid) return; // silent no-op — shortcut only fires when valid
  useProjectStore.getState().restoreOriginalClips(selectedClipIds);
  return;
}
```

- [ ] **Step 2: TypeScript gate + full Phase 2 test run**

```bash
npx tsc --noEmit
npx vitest run lib/store/project-helpers.test.ts
```
Expected: 0 TypeScript errors, all tests pass (including 5 new restore tests).

- [ ] **Step 3: Commit Phase 2**

```bash
git add components/timeline/clip-context-menu.tsx components/studio/timeline.tsx
git commit -m "feat(restore): add context menu + Ctrl+Shift+R shortcut for Restore Original"
```

---

## Phase 3 — Timeline Panning Polish

### Task 11: Remove scrollbar-hidden from the scroll container + add will-change

**Files:**
- Modify: `components/studio/timeline.tsx`

- [ ] **Step 1: Remove `scrollbar-hidden` from the scroll container class (~line 349)**

Find:
```tsx
<div
  ref={scrollContainerRef}
  className="scrollbar-hidden flex-1 flex flex-col overflow-x-auto overflow-y-auto min-w-0 relative"
```

Replace with:
```tsx
<div
  ref={scrollContainerRef}
  className="flex-1 flex flex-col overflow-x-auto overflow-y-auto min-w-0 relative"
```

(Removing `scrollbar-hidden` makes the native horizontal scrollbar visible, satisfying the spec requirement.)

- [ ] **Step 2: Add `will-change: transform` to the inner track area div (~line 357–362)**

Find:
```tsx
<div
  ref={trackAreaRef}
  data-testid="timeline-track-area"
  className="relative"
  style={{ contain: "layout", transformOrigin: "left center" }}
>
```

Replace with:
```tsx
<div
  ref={trackAreaRef}
  data-testid="timeline-track-area"
  className="relative"
  style={{ contain: "layout", transformOrigin: "left center", willChange: "transform" }}
>
```

- [ ] **Step 3: TypeScript gate**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

---

### Task 12: Create `scroll-navigator.tsx`

**Files:**
- Create: `components/timeline/scroll-navigator.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useEffect, useRef, type RefObject } from "react";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";

interface ScrollNavigatorProps {
  /** The horizontally-scrollable timeline container */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

/**
 * DOM-only horizontal scroll navigator.
 * Reads and writes scrollLeft via a GlobalTicker callback — zero React state,
 * zero rerenders on pan or zoom.
 */
export function ScrollNavigator({ scrollContainerRef }: ScrollNavigatorProps) {
  const rangeRef = useRef<HTMLInputElement>(null);
  const tickIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Register a GlobalTicker callback to keep the range in sync with native scroll
    tickIdRef.current = registerTickCallback(() => {
      const container = scrollContainerRef.current;
      const range = rangeRef.current;
      if (!container || !range) return;

      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll <= 0) {
        range.style.display = "none";
        return;
      }
      range.style.display = "";

      // Update range value to reflect current scroll position
      range.value = String((container.scrollLeft / maxScroll) * 100);

      // Update thumb width to visually represent the visible viewport fraction
      const frac = container.clientWidth / container.scrollWidth;
      range.style.setProperty("--thumb-width", `${Math.max(frac * 100, 4)}%`);
    });

    return () => {
      if (tickIdRef.current !== null) {
        unregisterTickCallback(tickIdRef.current);
        tickIdRef.current = null;
      }
    };
  }, [scrollContainerRef]);

  const onInput = (e: React.FormEvent<HTMLInputElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const pct = parseFloat((e.target as HTMLInputElement).value) / 100;
    const maxScroll = container.scrollWidth - container.clientWidth;
    container.scrollLeft = pct * maxScroll;
  };

  return (
    <div className="flex items-center px-2 py-1 border-t border-white/8 bg-[#151515]">
      <input
        ref={rangeRef}
        type="range"
        min={0}
        max={100}
        step={0.1}
        defaultValue={0}
        onInput={onInput}
        className="h-1 w-full cursor-pointer"
        aria-label="Timeline horizontal scroll position"
        style={{
          accentColor: "#3b82f6",
          // --thumb-width is set by the tick callback to show viewport fraction
        }}
      />
    </div>
  );
}
```

---

### Task 13: Wire `ScrollNavigator` into `timeline.tsx`

**Files:**
- Modify: `components/studio/timeline.tsx`

- [ ] **Step 1: Add the import**

```typescript
import { ScrollNavigator } from "@/components/timeline/scroll-navigator";
```

- [ ] **Step 2: Wrap the right column in a flex-col wrapper and add ScrollNavigator below the scroll container**

Find the current right-column scroll container div (the one with `ref={scrollContainerRef}`). It currently sits as a direct child of the `flex flex-1 min-h-0 overflow-hidden` body div.

Replace from `{/* Right Column: Scrollable canvas */}` down to the closing `</div>` of the scroll container with:

```tsx
{/* Right Column: Scrollable canvas + scroll navigator */}
<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
  <div
    ref={scrollContainerRef}
    className="flex-1 flex flex-col overflow-x-auto overflow-y-auto min-w-0 relative"
    onWheel={onWheel}
    onScroll={onScroll}
    onClick={onTrackAreaClick}
  >
    <div style={{ width: contentWidth }} className="flex flex-col min-h-full">
      <TimelineRuler scrollContainerRef={scrollContainerRef} />

      <div
        ref={trackAreaRef}
        data-testid="timeline-track-area"
        className="relative"
        style={{ contain: "layout", transformOrigin: "left center", willChange: "transform" }}
      >
        <TimelineGrid />
        {tracks.map((track) => {
          const effectiveHeight = track.collapsed ? COLLAPSED_HEIGHT : track.height;
          return (
            <div
              key={track.id}
              style={{ contentVisibility: "auto", containIntrinsicHeight: effectiveHeight }}
            >
              <TrackLane trackId={track.id} trackHeight={effectiveHeight} />
            </div>
          );
        })}
        {tracks.every((t) => t.clips.length === 0) && mediaPool.length === 0 && (
          <div className="flex min-h-[120px] items-center justify-center">
            <p className="select-none text-center text-[11px] font-medium text-white/25">
              This project is empty<br />
              <span className="text-[10px] font-normal text-white/15">Drag media from the pool onto a track to begin.</span>
            </p>
          </div>
        )}
        <NewTrackDropZone />
      </div>
    </div>
    {/* Overlay: Playhead, SnapIndicator, TimelineMarkers */}
    <div className="pointer-events-none absolute inset-0 z-10">
      <Playhead />
      <SnapIndicator />
      <TimelineMarkers />
    </div>
  </div>
  <ScrollNavigator scrollContainerRef={scrollContainerRef} />
</div>
```

Note: `will-change: transform` on `trackAreaRef` is included here — remove it from Task 11 Step 2 if you already applied it separately (avoid duplication).

- [ ] **Step 3: TypeScript gate**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit Phase 3**

```bash
git add components/timeline/scroll-navigator.tsx components/studio/timeline.tsx
git commit -m "feat(panning): add DOM-only scroll navigator and fix scrollbar visibility"
```

---

## Phase 4 — E2E + Audit

### Task 14: Add Restore Original E2E scenario

**Files:**
- Modify: `e2e/razor-correctness.spec.ts`

- [ ] **Step 1: Append the new test inside the `test.describe("Razor Correctness")` block**

```typescript
test("restore original after multi-split: clip count returns to 1, duration matches media", async ({
  page,
  auditPage,
}) => {
  // Seed a 10-second clip
  await page.evaluate(() => {
    const fn = (window as unknown as Record<string, unknown>)["__auditAddTestClip"];
    if (typeof fn === "function") fn();
  });
  await page.waitForTimeout(100);

  const ORIGINAL_DURATION = 10_000_000;

  // Split at 3s
  await page.evaluate((t: number) => {
    const fn = (window as unknown as Record<string, unknown>)["__auditSetPlayhead"];
    if (typeof fn === "function") fn(t);
  }, 3_000_000);
  await page.waitForTimeout(50);
  await page.waitForSelector('[data-testid="timeline-track-area"]', { timeout: 10_000 });
  await page.keyboard.press("s");
  await page.waitForTimeout(100);

  // Split at 7s
  await page.evaluate((t: number) => {
    const fn = (window as unknown as Record<string, unknown>)["__auditSetPlayhead"];
    if (typeof fn === "function") fn(t);
  }, 7_000_000);
  await page.waitForTimeout(50);
  await page.keyboard.press("s");
  await page.waitForTimeout(100);

  // Verify 3 fragments exist
  const tracksAfterSplit = await page.evaluate(() => {
    const fn = (window as unknown as Record<string, unknown>)["__auditGetTracks"];
    return typeof fn === "function" ? (fn() as { clips: { id: string; duration: number; sourceId: string }[] }[]) : [];
  });
  const clipsAfterSplit = tracksAfterSplit.flatMap((t) => t.clips);
  expect(clipsAfterSplit).toHaveLength(3);

  // Select all fragments (Ctrl+A equivalent — select all clips via audit hook)
  await page.evaluate(() => {
    const getTracks = (window as unknown as Record<string, unknown>)["__auditGetTracks"] as () => { clips: { id: string }[] }[];
    const setSelected = (window as unknown as Record<string, unknown>)["__auditSetSelectedClipIds"] as (ids: string[]) => void;
    if (!getTracks || !setSelected) return;
    const allIds = getTracks().flatMap((t) => t.clips.map((c) => c.id));
    setSelected(allIds);
  });
  await page.waitForTimeout(100);

  // Trigger Restore Original via keyboard shortcut
  await page.keyboard.press("Control+Shift+R");
  await page.waitForTimeout(200);

  // Verify: 1 clip, duration matches original media
  const tracksAfterRestore = await page.evaluate(() => {
    const fn = (window as unknown as Record<string, unknown>)["__auditGetTracks"];
    return typeof fn === "function" ? (fn() as { clips: { id: string; duration: number; sourceId: string }[] }[]) : [];
  });
  const clipsAfterRestore = tracksAfterRestore.flatMap((t) => t.clips);

  expect(clipsAfterRestore).toHaveLength(1);
  expect(clipsAfterRestore[0].duration).toBe(ORIGINAL_DURATION);
});
```

- [ ] **Step 2: Check if `__auditSetSelectedClipIds` exists**

Run a quick search to verify the AUDIT_MODE hook is available:
```bash
npx grep -r "__auditSetSelectedClipIds" app/ components/ lib/ --include="*.tsx" --include="*.ts" -l
```

If the hook does not exist, add it alongside the other audit hooks in `AppBootstrap` (or wherever `__auditAddTestClip` is defined):
```typescript
(window as unknown as Record<string, unknown>)["__auditSetSelectedClipIds"] = (ids: string[]) => {
  useProjectStore.getState().setSelectedClipIds(ids);
};
```

- [ ] **Step 3: Commit**

```bash
git add e2e/razor-correctness.spec.ts
git commit -m "test(e2e): add Restore Original E2E scenario to razor-correctness suite"
```

---

### Task 15: Final audit run + delivery summary

- [ ] **Step 1: Run full unit test suite**

```bash
npx vitest run
```
Expected: all tests pass, 0 failures.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Run audit**

```bash
npm run audit
```
Record the full output.

- [ ] **Step 4: Deliver summary**

Report:
1. Audit output (pass/fail per rule).
2. Before/after UX note on drag/scrub desync: confirm that at zoom levels 0.1, 1.0, and 3.0, clip drag and playhead scrub stay cursor-locked. Describe how the coordinate utility eliminates the desync window (all 6 call sites now use the same formula; the CSS scaleX window already prevents simultaneous drag and zoom).
3. Test counts: coords (6), restore (5 new + all prior passing), E2E restore (1 new).
4. Done conditions status from the spec.

---

## Done Conditions Checklist

- [ ] All 6 coord unit tests pass (`lib/utils/coords.test.ts`)
- [ ] All 5 restore unit tests pass (`lib/store/project-helpers.test.ts`)
- [ ] All prior `performSplitClip` / `performBulkSplit` tests still pass
- [ ] 1 new E2E scenario passes (`e2e/razor-correctness.spec.ts`)
- [ ] `npm run audit` clean
- [ ] `npx tsc --noEmit` — 0 errors
- [ ] No regressions in existing Tier 1 / Tier 2 audit flows
- [ ] Before/after UX note for desync fix included in delivery
