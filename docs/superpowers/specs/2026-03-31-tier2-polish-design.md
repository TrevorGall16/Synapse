# Tier 2 UI Polish — Design Spec
**Date:** 2026-03-31  
**Status:** Approved  
**Scope:** Zoom coordinate accuracy, timeline panning, Restore Original macro, safety gates

---

## 1. Coordinate Utility (`lib/utils/coords.ts`)

### Problem
All coordinate conversions between screen space and timeline time are inlined across six call sites in three files (`clip-event.tsx`, `timeline.tsx`, `zoom-slider.tsx`). Mixed coordinate spaces (raw `clientX` vs. scroll-adjusted timeline pixels) are the root cause of drag/playhead desync under zoom.

### API — Four Pure Stateless Exports

```typescript
/**
 * Convert pointer clientX to timeline-local pixels.
 * Accounts for container origin and horizontal scroll offset.
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
 * Convert microseconds to timeline-local pixels (for rendering).
 */
export function timeMicrosToTimelinePx(
  micros: number,
  pixelsPerSecond: number
): number {
  return (micros / 1_000_000) * pixelsPerSecond;
}

/**
 * Compound convenience: clientX → microseconds in one call.
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

### Migration Map

| File | Lines | Replacement |
|------|-------|-------------|
| `clip-event.tsx` | drag-start anchor, drag-move position, split-at-cursor | `screenXToTimeMicros` |
| `timeline.tsx` | selection start/end, wheel-zoom anchor | `screenXToTimeMicros` |
| `zoom-slider.tsx` | playhead anchor during zoom commit | `timeMicrosToTimelinePx` |

### Unit Tests (`lib/utils/coords.test.ts`)

| # | Scenario | Assert |
|---|----------|--------|
| 1 | Zero scroll, zoom 1.0 (`pps=100`), `clientX=300`, `rect.left=0` | `timeMicros = 3_000_000` |
| 2 | 500px scroll offset, same params | `timeMicros = 8_000_000` |
| 3 | Zoom 0.1 (`pps=10`), zero scroll, `clientX=100` | `timeMicros = 10_000_000` |
| 4 | Zoom 3.0 (`pps=300`), zero scroll, `clientX=300` | `timeMicros = 1_000_000` |
| 5 | Round-trip: `timeMicrosToTimelinePx(t, pps)` → `timelinePxToTimeMicros(px, pps)` | result ≤ 1µs drift from `t` |

---

## 2. Timeline Horizontal Panning

### Track Area Width
Computed as an inline style on the track area container:

```
width = max(containerWidth, (duration / 1_000_000) * pixelsPerSecond + 200)
```

Recalculates only when `duration` or `pixelsPerSecond` change. The `+200` px right-pad keeps the last clip accessible. This value flows from the Zustand store (`duration`, `pixelsPerSecond`) via a stable `useMemo` with those two as deps.

### Rerender Prevention
- `overflow-x: auto` is already set on the scroll container — no change.
- `will-change: transform` added to the inner track lane container CSS.
- During CSS `scaleX` zoom-slider gesture: `pointer-events: none` applied to the inner track area (already done) prevents simultaneous clip drag.
- `setScrollLeft` is already drained through GlobalTicker — no new rerender sources.

### Mini-Navigator
A `<input type="range" />` rendered sticky at the bottom of the timeline panel.

**DOM refs (not React state):**
```typescript
const rangeRef = useRef<HTMLInputElement>(null);
const containerRef = useRef<HTMLDivElement>(null); // scroll container
```

**Read path (GlobalTicker callback — registered once on mount):**
```typescript
registerTickCallback('scrollSync', () => {
  if (!rangeRef.current || !containerRef.current) return;
  const maxScroll = containerRef.current.scrollWidth - containerRef.current.clientWidth;
  if (maxScroll <= 0) return;
  rangeRef.current.value = String((containerRef.current.scrollLeft / maxScroll) * 100);
  // Update thumb width to reflect viewport fraction
  const frac = containerRef.current.clientWidth / containerRef.current.scrollWidth;
  rangeRef.current.style.setProperty('--thumb-width', `${Math.max(frac * 100, 4)}%`);
});
```

**Write path (`onInput` on the range — pure DOM):**
```typescript
onInput={(e) => {
  const pct = parseFloat((e.target as HTMLInputElement).value) / 100;
  const maxScroll = containerRef.current!.scrollWidth - containerRef.current!.clientWidth;
  containerRef.current!.scrollLeft = pct * maxScroll;
}}
```

**Zero new React state.** The range input is a controlled DOM element, not a controlled React component.

---

## 3. Restore Original Macro

### Sync-Preserving Anchor (Corrected)

The anchor ensures the source frame visible at `earliestFragment.startTime` is preserved exactly in the restored clip.

**Derivation:**
- `earliestFragment.startTime` corresponds to source frame at `earliestFragment.mediaOffset`.
- Therefore, source frame 0 (media start) sits at `rawStart = earliestFragment.startTime - earliestFragment.mediaOffset` on the timeline.

**Algorithm:**

```
rawStart = earliestFragment.startTime - earliestFragment.mediaOffset

IF rawStart >= 0:
  startTime   = rawStart
  mediaOffset = 0
  duration    = media.duration

IF rawStart < 0:  // media start would be before timeline origin
  startTime   = 0
  mediaOffset = -rawStart           // skip the pre-origin portion of the media
  duration    = media.duration - mediaOffset
```

The clamped case preserves the visible frame at `earliestFragment.startTime` — the relationship `startTime + mediaOffset_delta = earliestFragment.startTime` still holds because we added exactly `-rawStart` to both `startTime` (clamped) and `mediaOffset`.

### Helper: `performRestoreOriginal`

**Signature:**
```typescript
export function performRestoreOriginal(
  tracks: Track[],
  selectedClipIds: string[],
  mediaPool: MediaPoolItem[]
): Track[] | { error: string }
```

**Full algorithm:**

1. **Validate selection** — all selected clips must share one `sourceId` and one `trackId`. Return `{ error: "Selected clips must share the same source and track." }` otherwise.

2. **Find earliest fragment** — the clip with the minimum `startTime` among selected clips. This is the sync anchor.

3. **Compute bounds:**
   - `earliestStart = min(clip.startTime)` (same as anchor.startTime)
   - `latestEnd = max(clip.startTime + clip.duration)`

4. **Find scope** — on the same track, collect all clips where:
   - `clip.sourceId === sourceId`
   - clip overlaps `[earliestStart, latestEnd)`: `clip.startTime < latestEnd && (clip.startTime + clip.duration) > earliestStart`

5. **Look up media** — find `MediaPoolItem` where `item.id === sourceId`. Return `{ error: "Source media not found in pool." }` if missing.

6. **Compute anchor (sync-preserving):**
   ```
   rawStart = earliestFragment.startTime - earliestFragment.mediaOffset
   if rawStart >= 0 → startTime = rawStart, mediaOffset = 0
   if rawStart < 0  → startTime = 0, mediaOffset = -rawStart
   duration = media.duration - mediaOffset
   ```

7. **Delete scope fragments** — remove all step-4 clips from the track.

8. **Insert restored clip** — new `ClipEvent` with fields from step 6 plus:
   - `id = newUUID()`
   - `sourceId = original sourceId`
   - `mediaId = media.id`
   - `trackId = original trackId`
   - `level = 1.0`, `fx = []`, `fadeInDuration = 0`, `fadeOutDuration = 0`
   - `manualFadeIn = false`, `manualFadeOut = false`
   - `groupId = undefined` (restored clip stands alone; re-link only if caller explicitly passes a group)

9. **refCount: no change.** Split and restore are timeline-fragment operations. The global asset `refCount` tracks how many distinct *projects* or *media pool entries* reference the asset — not how many timeline fragments exist. Do not decrement or increment.

10. **Recompute crossfades** via existing `computeCrossfades`.

11. **Return** new `Track[]`.

### Store Action: `restoreOriginalClips`

```typescript
// project-store.ts
restoreOriginalClips(clipIds: string[]): void
```

- Calls `performRestoreOriginal(tracks, clipIds, mediaPool)`.
- On `{ error }`: calls `toast.error(msg)`, no mutation, no history entry.
- On `Track[]`: calls `snapshotHistory("Restore Original")`, sets `tracks`, sets `isDirty = true`.

### Context Menu (`clip-context-menu.tsx`)

- "Restore Original" item rendered only when:
  - `selectedClips.length >= 1`
  - All selected clips share one `sourceId` and one `trackId`
- Opens `<AlertDialog>`:
  - **Title:** "Restore Original Clip"
  - **Description:** *"Revert **{n} fragment(s)** of '{media.name}' between **{formatTime(earliestStart)}** – **{formatTime(latestEnd)}** to one uncut clip? All cuts and edits within this range will be removed."*
  - Buttons: **Cancel** / **Restore**
- On Restore: calls `store.restoreOriginalClips(selectedClipIds)`.

### Keyboard Shortcut (`components/studio/timeline.tsx`)

- `Ctrl+Shift+R` (Windows/Linux) / `Cmd+Shift+R` (Mac).
- **Validity guard** runs first — checks same `sourceId` + same `trackId` on `selectedClipIds`. If invalid: **silent no-op** (no toast, no dialog).
- If valid: calls `restoreOriginalClips(selectedClipIds)` directly — no confirmation dialog (undo via `Ctrl+Z` is available).

---

## 4. Unit Tests for Restore Invariants

**Location:** `lib/store/project-helpers.test.ts`

### New Test Cases

| # | Name | Setup | Assert |
|---|------|--------|--------|
| 1 | **Frame sync preservation** | Clip at `startTime=5s`, `mediaOffset=2s`. Split. Restore. | Restored `startTime = 3s` (`5 - 2`), `mediaOffset = 0`, `duration = media.duration` |
| 2 | **Negative start clamped** | Clip at `startTime=1s`, `mediaOffset=3s`. `rawStart = -2s`. | Restored `startTime = 0`, `mediaOffset = 2s`, `duration = media.duration - 2s` |
| 3 | **Unrelated clip untouched** | Two clips on same track: one with target `sourceId`, one with different `sourceId` at `t=4s`. Restore target. | Other clip's `startTime` unchanged at `4s` |
| 4 | **refCount invariance** | Clip split into 3 fragments. `refCount` recorded before restore. Restore. | `mediaPool[sourceId].refCount` unchanged after restore |
| 5 | **Split-then-restore round-trip** | Split clip at 2 points. Restore all 3 fragments. | Restored `duration === original.duration`, `startTime === original.startTime - original.mediaOffset` |

---

## 5. Safety & Performance Gates

| Gate | Mechanism |
|------|-----------|
| **Long-task ≤50ms** | Coord utility: pure math, sub-millisecond. Restore: O(n) over one track's clips. No new synchronous work on drag/scrub hot path. |
| **Save barrier** | `isDirty = true` set in `restoreOriginalClips`. Existing `flushProjectToIDB()` + nav guard unchanged. No new navigation paths introduced. |
| **No nav in `finally`** | No new navigation introduced anywhere in this feature. |
| **Audit** | `npm run audit` run and pass required as done condition. |
| **E2E** | One new scenario in `e2e/razor-correctness.spec.ts`: multi-split then Restore Original → clip count returns to 1, duration matches media. |

---

## Done Conditions

- [ ] All 5 coord unit tests pass
- [ ] All 5 restore unit tests pass (`project-helpers.test.ts`)
- [ ] 1 new E2E scenario passes (`razor-correctness.spec.ts`)
- [ ] `npm run audit` clean
- [ ] No regressions in existing Tier 1/Tier 2 audit flows
- [ ] Before/after UX note: drag/scrub desync confirmed resolved at zoom levels 0.1, 1.0, 3.0
