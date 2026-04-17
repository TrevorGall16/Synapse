---
name: Search Autocomplete — Channels + Creators
description: Scope GlobalSearch suggestions to the curated CHANNELS taxonomy plus known creator handles, with reliable keyboard nav and non-destructive Escape. Also silences two routine success logs.
status: approved
---

# Search Autocomplete — Channels + Creators

## Goal

Narrow the existing `GlobalSearch` dropdown from the current 3-section layout (Videos / Creators / Tags) to a focused 2-section layout: **Channels** and **Creators**. Make keyboard navigation reliable, stop Escape from wiping the query, and quiet two known success logs.

## Non-Goals

- No changes to the free-text submit path (home feed filtering via `searchQuery` stays as-is).
- No new backend, API, or schema changes.
- No refactor of `buildPostIndex` / `rankPosts` / `fuzzyMatch` — those are reused as-is for creator matching.
- No redesign of the search-bar chrome (the input, clear button, Cmd+K binding all stay).

## Data Sources

- **Channels**: `CHANNELS` from `lib/config/taxonomy.ts` — 21 curated items. Single source of truth already used by the channel pills and the `?channel=` URL param on the home feed.
- **Creators**: handles from `index.byCreator` built by `buildPostIndex(posts)`. The `posts` prop is already passed into `GlobalSearch` by the home page, so this is a zero-cost lookup. `useUserStore` is **not** a creator directory (it only holds the viewer's own profile + their `following` list) and is not used as a source here.

## Matching & Ranking

Case-insensitive. Within each section, rank order is:

1. **exact** — `needle === candidate.toLowerCase()`
2. **prefix** — `candidate.toLowerCase().startsWith(needle)`
3. **substring** — `candidate.toLowerCase().includes(needle)`

Deduplicate by canonical key (channel name for Channels, handle for Creators). Cap each section at 8 items.

A leading `#` or `@` on the query is stripped before matching, matching the existing behavior (`q.replace(/^[@#]/, "")`).

## Selection Behavior

| Section | Click / Enter action |
|---|---|
| Channel | `router.push('/?channel=' + channelSlug(name))`, close dropdown, clear the text query so the channel filter is the only active filter. |
| Creator | `router.push('/profile/' + handle)`, close dropdown. Query retained. |
| No highlighted option + Enter | Current free-text submit path is preserved (dropdown closes, home feed filters by `searchQuery`). |

## Keyboard

- **ArrowDown / ArrowUp** — move active index through the flat list (Channels then Creators), wraps at both ends.
- **Enter** — activates the highlighted option; if the dropdown is closed, first Enter opens it.
- **Escape** — close the dropdown but **keep the query** in the input. (Current behavior calls `clear()` which wipes the query — this is the bug the spec calls out.)
- **Tab** — no preventDefault; native focus traversal continues. Dropdown closes via blur handler.

On blur the dropdown closes. On focus, if the query is non-empty, it reopens. Click-outside already closes the dropdown via the existing `mousedown` listener.

## UI

- Dropdown content reduced to two labeled groups: `CHANNELS`, `CREATORS`.
- Channel rows render as `#Anal`, `#Blonde` (display format in spec). Use the existing `Hash` icon.
- Creator rows render as `@handle`. Use the existing `UserIcon`.
- Empty-state copy and styling unchanged.

## Console Noise Cleanup (P0)

Two unconditional `console.log` calls fire on every success path. Remove both:

- `lib/audio/audio-engine.ts:259` — `console.log("Syncing Track:", ...)`.
- `lib/hooks/use-media-hydration.ts:48` — `console.log("IDB Recovery Success: ...")`.

Warn / error logs nearby are left untouched.

## Files Affected

- `components/feed/global-search.tsx` — rewrite the results memo + `navigate` callback; fix Escape.
- `lib/audio/audio-engine.ts` — delete one `console.log`.
- `lib/hooks/use-media-hydration.ts` — delete one `console.log`.
- `components/feed/global-search.test.tsx` — new test file covering ranking, keyboard, and selection routing (if a harness doesn't already exist for this component, add one using the project's `vitest` setup).

## Risk & Rollback

Low. The change is contained to one component plus two log-deletions. Rollback = revert the commit.

## Out-of-Scope / Follow-ups

- Re-introducing Videos as a third section behind a toggle (not requested).
- Sourcing creators from a canonical server list (none exists yet).
- Highlighting matched substring in results (visual-only polish).
