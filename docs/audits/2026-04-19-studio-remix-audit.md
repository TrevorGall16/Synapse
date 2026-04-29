# Studio (Remix Environment) Audit — 2026-04-19

Scope audited:
- `components/timeline/timeline-ruler.tsx`
- `components/studio/timeline.tsx`
- `components/timeline/zoom-slider.tsx`
- `lib/store/playback-store.ts`
- `components/feed/feed-post-card.tsx`
- `lib/store/feed-store.ts`
- `lib/store/feed-idb.ts`
- `lib/workers/` (worker inventory)

## Executive Summary

The Studio timeline has **partially-correct coordinate math** in the ruler itself, but there are still interaction and zoom semantics gaps that produce a “broken” feel during manual QA.

### P0
1. **Ruler drag can still trigger selection artifacts/text selection UX conflicts** because timeline/ruler do not globally suppress selection for drag gestures.
2. **Timeline selection integrity depends on mixed coordinate systems** (some handlers use screen→timeline helpers, ruler uses local helpers). This increases risk of offset regressions under scroll/zoom transforms.

### P1
1. **0% zoom is not “zoom to fit.”** It maps to `zoom=0.001` and `pixelsPerSecond=0.1`, which is effectively an arbitrary extreme squish.
2. **Feed thumbnail pipeline is missing.** There is no thumbnail worker/service implementation in `lib/workers` besides audio peaks.
3. **Feed cards currently render first-frame video surfaces, not persisted poster frames.** After blob URL loss/hydration failure, cards can end up placeholder/offline.

---

## 1) Coordinate Math Audit (Ruler handlers)

### What is correct now
- `timeline-ruler.tsx` computes pointer X as:
  - `clientX - rulerRect.left + scrollContainer.scrollLeft` via `rawXFromClient(...)`.
- `microsFromClientX(...)` converts that raw X to time using `pixelsPerSecond` and clamps to project duration.

This is the correct baseline formula for scrolled timelines.

### Risk vectors / why QA still sees offset
- Ruler path uses `rawXFromClient`, while other timeline paths use shared helpers (`screenXToTimeMicros`, `screenPxToTimelinePx`) in `components/studio/timeline.tsx`.
- Zoom drag introduces transient `cssZoomScale` transform in `zoom-slider.tsx`, while some handlers explicitly pass `1` (committed-only math) and others are fully local.
- This is not a guaranteed bug in the ruler code itself, but it is a **high-risk inconsistency pattern** that can manifest as apparent offset under specific drag/scroll/zoom sequences.

**Verdict:** Ruler code is currently accounting for `scrollLeft`; issue is likely from multi-path coordinate handling + interaction state coupling rather than a missing `scrollLeft` term in ruler math.

---

## 2) Interaction Conflict (text highlighting while drag selecting)

- Timeline ruler root does **not** apply `user-select: none` / `select-none`.
- Scroll container and timeline surface also do not enforce no-select during drag operations.

Result: browser text selection can appear during rapid drags, especially when pointer capture is interrupted or initiated on text-bearing child nodes.

**Verdict:** Confirmed issue.

---

## 3) Zoom Logic Audit (0% semantics)

Current behavior:
- Slider is logarithmic from `0.001..3` zoom.
- `setZoom` computes `pixelsPerSecond = 100 * zoom`.
- At visual “0%”, system lands at `zoom≈0.001` -> `0.1 px/sec`, not fit-to-duration.

This is technically consistent with existing mapping, but semantically wrong for NLE expectations.

**Required model change for 0%:**
- At minimum slider position, compute:
  - `pixelsPerSecond = visibleTimelineWidth / totalDurationSeconds`.
- Keep normal zoom curve above the minimum, but reserve the floor for deterministic fit.

**Verdict:** Confirmed mismatch.

---

## 4) Thumbnail Service / Feed Preview Failure Audit

### Findings
- No thumbnail worker exists at `lib/workers/thumbnail.worker.ts` (or equivalent).
- `lib/workers/` only contains `audio-peak-worker.ts`.
- Feed persistence strips blob URLs before IDB write (`feed-idb.ts`) and relies on later hydration from media-pool.
- `FeedPostCard` is video-driven (first clip source + `currentTime` seek), not thumbnail-driven.
- No persisted thumbnail field exists on `FeedPost` for deterministic poster restoration.

### Why feed cards degrade to placeholders/offline after “mock wipe”
- If blob URLs are stripped and cannot be hydrated back from media-pool, the card either:
  - uses fallback video URL path, or
  - marks media offline on load error.
- Without persisted thumbnail artifacts, there is no stable image fallback representing local content.

**Verdict:** Root cause is architectural: **thumbnail generation/storage path is missing**, not merely a rendering bug in card component.

---

## Builder-AI Task Spec (refined)

Use this version as implementation brief:

```md
Task: Studio Fidelity Refactor (P0/P1) — Sony Vegas style timeline correctness

P0 — Timeline coordinate and drag correctness
1) Unify coordinate conversion:
   - Create/extend one canonical helper for pointer->timeline micros.
   - Always compute: timeMicros = ((clientX - containerRect.left + scrollLeft) / pixelsPerSecond) * 1_000_000.
   - Use same helper in ruler drag, shift-click selection, and wheel anchor logic.

2) Eliminate browser text selection during timeline interactions:
   - Add `user-select: none` (`select-none`) on ruler surface, track area, and drag-active overlays.
   - Ensure pointer capture lifecycle remains intact on pointer down/up/cancel.

3) Regression acceptance for scrolled ruler:
   - With horizontal scroll applied, dragging a 2.0s range near timeline end must yield selection duration within ±1 frame.

P1 — Zoom semantics
4) Redefine 0% as Zoom-to-Fit:
   - At minimum slider position, set pixelsPerSecond = visibleWidth / (durationMicros / 1_000_000).
   - Clamp safely for zero/near-zero duration.
   - Preserve existing non-linear zoom behavior for >0%.

5) Maintain anchor behavior:
   - On zoom changes, keep playhead (or cursor focal point) visually anchored.

P1 — Feed thumbnail pipeline
6) Add thumbnail generation service/worker:
   - Generate poster at 00:00:01 (fallback to 00:00:00 if shorter media).
   - Persist thumbnail Blob/DataURL in IndexedDB alongside feed post metadata.

7) Extend feed model and hydration:
   - Add stable `thumbnailUrl`/`thumbnailData` field on FeedPost.
   - Preserve this through save/load cycles independent of blob video URL hydration.

8) Update FeedPostCard render priority:
   - Static state: show persisted thumbnail first.
   - Hover state: swap to video preview.
   - If thumbnail missing: live-capture first frame once, cache result, then render image.

Validation / Done
- Scrolled ruler selection maps exactly to intended segment.
- 0% zoom fits full clip width for both short and long durations.
- After IndexedDB wipe/reload scenarios, feed cards show real frame thumbnails (not placeholders).
- Selection overlay start/end timestamps match published segment boundaries.
```

---

## Suggested Implementation Order
1. Coordinate helper unification + drag selection hardening (P0)
2. user-select hardening on timeline surfaces (P0)
3. Zoom-to-fit floor semantics (P1)
4. Thumbnail pipeline + feed card fallback policy (P1)
5. End-to-end QA pass for publish/remix/feed loop
