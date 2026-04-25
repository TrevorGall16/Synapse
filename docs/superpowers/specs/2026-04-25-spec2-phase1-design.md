# Spec 2 Phase 1 — Studio Pivot & Polish

**Date:** 2026-04-25  
**Status:** Approved for execution

## Scope

Three discrete changes. No new remix logic, no new components.

---

## Part 1 — Kill the Scrim (`components/feed/feed-post-card.tsx`)

Remove two gradient overlays from every feed card:

1. **Persistent typography scrim** — `linear-gradient(to bottom, …)` that always covers the video. Removed entirely. Text readability is preserved by existing `drop-shadow-md` on handle and title.

2. **Hover bottom-to-top gradient** — `linear-gradient(to top, rgba(0,0,0,0.82)…)` inside the `!autoplayInView` block. Removed entirely. Tags use `glass-surface-ghost` pill styling and don't need a backdrop scrim.

Result: video is 100% unobstructed in both Grid and Single Column views.

---

## Part 2 — Theater Keyboard Navigation (`components/feed/theater-mode.tsx`)

Extend the existing `keydown` handler:

- `ArrowDown` / `ArrowRight` → next post in queue (clamped)
- `ArrowUp` / `ArrowLeft` → previous post in queue (clamped)
- Guard: skip if target is `<input>` or `<textarea>`
- Uses `activePostIdRef` (synced from `activePostId` state) to avoid stale closures
- Scrolls via existing `cellRefs` map and `scrollIntoView({ behavior: "smooth" })`

---

## Part 3 — Studio Facelift — Option B: Proportional Boost

### Layout proportions (`app/(creation)/studio/page.tsx`)

| Panel | Before | After |
|---|---|---|
| Root bg | `#1a1a1a` | `#121014` |
| Top section (vertical) | `defaultSize={50}` | `defaultSize={57}` |
| Timeline (vertical) | `defaultSize={40}` | `defaultSize={35}` |
| Audio Mixer (vertical) | `defaultSize={10}` | `defaultSize={8}` |
| Left panel (horizontal) | `defaultSize={45}` | `defaultSize={30}` |
| Preview (horizontal) | `defaultSize={60}` | `defaultSize={70}` |

### Tab bar

From tiny `text-[10px] uppercase tracking-wider` buttons with border-bottom underlines, to pill-style tabs: `rounded-lg px-3 py-1.5 text-xs font-semibold`, active state uses `bg-white/10 text-white`.

### Separator handles

Thicker and accented: `h-1.5` / `w-1.5`, `hover:bg-[#ff007a]/40` (Synapse Pink). Unmistakably grabbable.

### Transport controls (`components/studio/preview-monitor.tsx`)

- Root bg: `#1a1a1a` → `#121014`
- Buttons: `rounded p-1.5` → `rounded-xl p-2.5`, icons scale from 14→16
- Play/Pause accent: `bg-white/15 hover:bg-white/25` → `bg-[#ff007a]/20 ring-1 ring-[#ff007a]/40 hover:bg-[#ff007a]/30 text-[#ff007a]`

### Breadcrumb (`components/studio/focused-breadcrumb.tsx`)

- Height: `h-9` → `h-10`
- Background: `#161616` → `#121014`

---

## Color Constraint

**No `#7c3aed` or any unapproved violet/purple hex.** All accent uses `#ff007a` (Synapse Pink), consistent with the Home Feed progress bar. Brand purple tokens (`--color-brand`) are for brand identity only.
