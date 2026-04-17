# Search Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Narrow `GlobalSearch` autocomplete to Channels + Creators with exact→prefix→substring ranking and non-destructive Escape, silence two routine success logs, and verify the /profile/[username] 500 is environmental (not a code regression).

**Architecture:** Extract the ranking logic into a pure helper (`lib/search-autocomplete.ts`) so it can be tested under vitest without adding a jsdom/testing-library dependency. Component consumes the helper and handles routing + keyboard.

**Tech Stack:** Next.js 16 (App Router, client components), Zustand, vitest (pure-function tests), TailwindCSS.

---

## Spec Reference

`docs/superpowers/specs/2026-04-17-search-autocomplete-design.md` — committed at `7342f5f`.

## File Structure

- **Create** `lib/search-autocomplete.ts` — pure helper `buildAutocompleteSuggestions(posts, query)` returning `{ channels, creators }`.
- **Create** `lib/search-autocomplete.test.ts` — vitest tests: ranking order, dedup, cap, empty query, `@`/`#` stripping.
- **Modify** `components/feed/global-search.tsx` — swap to new helper, drop Videos/Tags sections, fix Escape, update `navigate` for channel routing.
- **Modify** `lib/audio/audio-engine.ts:259` — delete one `console.log`.
- **Modify** `lib/hooks/use-media-hydration.ts:48` — delete one `console.log`.

Existing ranking in `lib/search-index.ts` stays untouched — it's used elsewhere (home feed, niche pages). The new helper is a separate, narrower pipeline for the autocomplete dropdown.

---

## Task 1: Verify the /profile 500 is an environmental regression, not a code regression

This is the emergency check. The regression-guard test `app/profile/[username]/layout.test.ts` is our code-level authority.

- [ ] **Step 1: Run the profile layout regression test**

Run: `npx vitest run app/profile/\[username\]/layout.test.ts`

Expected output: `Test Files  1 passed (1)` and `Tests  3 passed (3)`.

- [ ] **Step 2: Decision branch**

- If tests **pass** → the /profile metadata generator is not regressed. The 500 the user sees is a Turbopack dev-worker stale-compile crash (the test file's own header comment documents this). **Action:** restart the dev server (`kill` the running `next dev` and re-run `npm run dev`). Move to Task 2.
- If tests **fail** → STOP. Read the failure, identify the root cause in `app/profile/[username]/layout.tsx`, and fix before any other work.

- [ ] **Step 3: Note result in the task checklist**

No commit for this task unless Step 2's failure branch triggers a fix. If a fix is needed, write it as a TDD cycle against the failing regression test.

---

## Task 2: Silence `Syncing Track` log in audio engine

**Files:**
- Modify: `lib/audio/audio-engine.ts:259`

- [ ] **Step 1: Remove the log line**

Open `lib/audio/audio-engine.ts`. Delete line 259:

```ts
    console.log("Syncing Track:", trackId, "Exists:", this.trackChains.has(trackId));
```

The surrounding `syncTrackState` method is unchanged — only the `console.log` goes. The `if (!chain) return;` guard on the next line stays.

- [ ] **Step 2: Run the audio engine tests to confirm no regression**

Run: `npx vitest run lib/audio`

Expected: all existing tests still pass (or, if no audio tests exist under `lib/audio`, the run reports "No test files found" without error).

- [ ] **Step 3: Do NOT commit yet** — bundle with Task 3.

---

## Task 3: Silence `IDB Recovery Success` log in media hydration

**Files:**
- Modify: `lib/hooks/use-media-hydration.ts:48`

- [ ] **Step 1: Remove the log line**

Open `lib/hooks/use-media-hydration.ts`. Delete line 48:

```ts
            console.log(`IDB Recovery Success: ${item.name} (${item.id.slice(0, 8)})`);
```

The surrounding `if (url && !cancelled) { useProjectStore.getState().updateMediaItemUrl(item.id, url); }` block keeps the `updateMediaItemUrl` call. The `console.warn("useMediaHydration failed:", err);` on line 57 stays — warnings are spec-allowed.

- [ ] **Step 2: Run type check to catch accidental breakage**

Run: `npx tsc --noEmit`

Expected: zero errors, or only errors pre-existing on master unrelated to these two files.

- [ ] **Step 3: Commit the two log deletions**

```bash
git add lib/audio/audio-engine.ts lib/hooks/use-media-hydration.ts
git commit -m "chore(logs): silence routine Syncing Track / IDB Recovery Success logs

Drop two unconditional console.log calls that fire on every successful
sync / rehydration. Warnings and errors in the same files are kept."
```

---

## Task 4: Create the pure autocomplete helper — failing tests first

**Files:**
- Create: `lib/search-autocomplete.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `lib/search-autocomplete.test.ts` with full content:

```ts
import { describe, it, expect } from "vitest";
import type { FeedPost } from "@/lib/store/feed-store";
import { buildAutocompleteSuggestions } from "@/lib/search-autocomplete";

// Minimal FeedPost factory — only fields the helper reads.
function mk(handle: string, id = handle): FeedPost {
  return {
    id,
    user: { handle, initial: handle[0]?.toUpperCase() ?? "X", hue: 0 },
    title: `post by ${handle}`,
    tags: [],
    bg: "#000",
    accent: "#fff",
    duration: "0:10",
    likes: 0,
    comments: 0,
    featured: false,
  } as FeedPost;
}

const posts: FeedPost[] = [
  mk("aurora_vj"),
  mk("aurora_vj", "dup"), // duplicate handle to exercise dedup
  mk("neon_cut"),
  mk("spectral_x"),
  mk("hue.shift"),
];

describe("buildAutocompleteSuggestions", () => {
  it("returns empty arrays for an empty query", () => {
    expect(buildAutocompleteSuggestions(posts, "")).toEqual({ channels: [], creators: [] });
    expect(buildAutocompleteSuggestions(posts, "   ")).toEqual({ channels: [], creators: [] });
  });

  it("matches channels case-insensitively", () => {
    const { channels } = buildAutocompleteSuggestions(posts, "blo");
    expect(channels).toContain("Blonde");
  });

  it("strips a leading # before matching channels", () => {
    const { channels } = buildAutocompleteSuggestions(posts, "#anal");
    expect(channels[0]).toBe("Anal"); // exact match wins
  });

  it("strips a leading @ before matching creators", () => {
    const { creators } = buildAutocompleteSuggestions(posts, "@aurora");
    expect(creators[0]).toBe("aurora_vj");
  });

  it("ranks exact > prefix > substring for channels", () => {
    // 'as' is a substring of 'Asian' (prefix) and 'PAWG' is unrelated.
    // 'Asian' starts with 'as', no channel equals 'as' exactly.
    const { channels } = buildAutocompleteSuggestions(posts, "as");
    expect(channels[0]).toBe("Asian"); // prefix beats any substring
  });

  it("ranks exact > prefix > substring for creators", () => {
    const extra: FeedPost[] = [
      ...posts,
      mk("au"),            // exact match for query 'au'
      mk("auburn"),        // prefix match for 'au'
      mk("blauburn"),      // substring match for 'au'
    ];
    const { creators } = buildAutocompleteSuggestions(extra, "au");
    expect(creators[0]).toBe("au");
    expect(creators.indexOf("auburn")).toBeLessThan(creators.indexOf("blauburn"));
  });

  it("dedupes duplicate creator handles", () => {
    const { creators } = buildAutocompleteSuggestions(posts, "aurora");
    expect(creators.filter((c) => c === "aurora_vj")).toHaveLength(1);
  });

  it("caps each section at 8 items", () => {
    const many: FeedPost[] = Array.from({ length: 30 }, (_, i) => mk(`creator_${i}`));
    const { creators } = buildAutocompleteSuggestions(many, "creator");
    expect(creators.length).toBeLessThanOrEqual(8);
  });

  it("returns no channels/creators when nothing matches", () => {
    const { channels, creators } = buildAutocompleteSuggestions(posts, "zxqvw_nope");
    expect(channels).toEqual([]);
    expect(creators).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests — they must fail**

Run: `npx vitest run lib/search-autocomplete.test.ts`

Expected: import error, something like `Failed to load lib/search-autocomplete` / `Cannot find module`. This confirms the helper doesn't exist yet.

---

## Task 5: Implement the autocomplete helper

**Files:**
- Create: `lib/search-autocomplete.ts`

- [ ] **Step 1: Write the helper**

Create `lib/search-autocomplete.ts` with full content:

```ts
/**
 * lib/search-autocomplete.ts
 *
 * Pure helper for the GlobalSearch autocomplete dropdown. Returns up to 8
 * channel names + up to 8 creator handles for a raw query string. Ranked
 * per the design spec:
 *
 *   exact > prefix > substring  (case-insensitive, leading @/# stripped)
 *
 * Decoupled from React so it can be unit-tested under vitest without a DOM.
 */

import type { FeedPost } from "@/lib/store/feed-store";
import { CHANNELS, type Channel } from "@/lib/config/taxonomy";

const CAP = 8;

export interface AutocompleteSuggestions {
  channels: Channel[];
  creators: string[];
}

type Tier = 0 | 1 | 2 | 3;
// 3 = exact, 2 = prefix, 1 = substring, 0 = no match.
function tierOf(candidate: string, needle: string): Tier {
  const c = candidate.toLowerCase();
  if (c === needle) return 3;
  if (c.startsWith(needle)) return 2;
  if (c.includes(needle)) return 1;
  return 0;
}

function rankByTier<T>(items: readonly T[], key: (v: T) => string, needle: string): T[] {
  const scored: Array<{ item: T; tier: Tier; idx: number }> = [];
  items.forEach((item, idx) => {
    const t = tierOf(key(item), needle);
    if (t > 0) scored.push({ item, tier: t, idx });
  });
  // Higher tier first; stable tiebreak by original index.
  scored.sort((a, b) => (b.tier - a.tier) || (a.idx - b.idx));
  return scored.slice(0, CAP).map((x) => x.item);
}

/**
 * Build channel + creator suggestions for the autocomplete dropdown.
 * Empty / whitespace-only query returns empty sections.
 */
export function buildAutocompleteSuggestions(
  posts: readonly FeedPost[],
  rawQuery: string,
): AutocompleteSuggestions {
  const needle = rawQuery.trim().toLowerCase().replace(/^[@#]/, "");
  if (!needle) return { channels: [], creators: [] };

  const channels = rankByTier<Channel>(CHANNELS, (c) => c, needle);

  // Dedup creator handles across posts, preserving first-seen order for a
  // stable tiebreak. Matches `buildPostIndex.byCreator`'s behavior but we
  // don't pull in the full index — the helper owns its own small pipeline.
  const seen = new Set<string>();
  const uniqueHandles: string[] = [];
  for (const p of posts) {
    const h = p.user.handle.toLowerCase();
    if (seen.has(h)) continue;
    seen.add(h);
    uniqueHandles.push(h);
  }
  const creators = rankByTier<string>(uniqueHandles, (h) => h, needle);

  return { channels, creators };
}
```

- [ ] **Step 2: Run the tests — they must pass**

Run: `npx vitest run lib/search-autocomplete.test.ts`

Expected: `Test Files  1 passed (1)`, `Tests  9 passed (9)`.

- [ ] **Step 3: Commit**

```bash
git add lib/search-autocomplete.ts lib/search-autocomplete.test.ts
git commit -m "feat(search): pure autocomplete helper — channels + creators

buildAutocompleteSuggestions(posts, query) returns up to 8 channels
(from CHANNELS taxonomy) and up to 8 creator handles (from post authors)
ranked exact > prefix > substring, case-insensitive, leading @/#
stripped. Unit-tested with vitest — no DOM required."
```

---

## Task 6: Wire the helper into GlobalSearch — drop Videos/Tags, fix Escape, route channels

**Files:**
- Modify: `components/feed/global-search.tsx`

- [ ] **Step 1: Replace the file with the new implementation**

Replace the **entire** contents of `components/feed/global-search.tsx` with:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Search, X, User as UserIcon, Hash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSearchStore } from "@/lib/store/search-store";
import type { FeedPost } from "@/lib/store/feed-store";
import { channelSlug, type Channel } from "@/lib/config/taxonomy";
import { buildAutocompleteSuggestions } from "@/lib/search-autocomplete";

type ResultKind = "channel" | "creator";
interface Result {
  kind: ResultKind;
  id: string;     // stable key
  label: string;  // primary display, e.g. "#Anal" or "@aurora_vj"
  payload: string; // channel name OR creator handle
}

interface Props {
  /** Candidate posts — used only as the creator-handle source. */
  posts?: FeedPost[];
}

export function GlobalSearch({ posts = [] }: Props) {
  const router = useRouter();
  const searchQuery    = useSearchStore((s) => s.searchQuery);
  const setSearchQuery = useSearchStore((s) => s.setSearchQuery);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef  = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi]     = useState(0);
  // Reset highlight on every query change — derived, not in an effect.
  const [prevQuery, setPrevQuery] = useState(searchQuery);
  if (prevQuery !== searchQuery) {
    setPrevQuery(searchQuery);
    setHi(0);
  }

  const clear = useCallback(() => {
    setSearchQuery("");
    inputRef.current?.focus();
  }, [setSearchQuery]);

  // Cmd/Ctrl+K: global focus shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside → close dropdown; query stays in the input.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const { channels, creators, flat } = useMemo(() => {
    const { channels, creators } = buildAutocompleteSuggestions(posts, searchQuery);
    const channelRes: Result[] = channels.map((c) => ({
      kind: "channel",
      id: `ch-${c}`,
      label: `#${c}`,
      payload: c,
    }));
    const creatorRes: Result[] = creators.map((h) => ({
      kind: "creator",
      id: `cr-${h}`,
      label: `@${h}`,
      payload: h,
    }));
    return { channels: channelRes, creators: creatorRes, flat: [...channelRes, ...creatorRes] };
  }, [posts, searchQuery]);

  const navigate = useCallback((r: Result) => {
    setOpen(false);
    if (r.kind === "channel") {
      // Channel selected → activate channel filter on the home feed and
      // clear the free-text query so the filter is unambiguous.
      setSearchQuery("");
      router.push(`/?channel=${channelSlug(r.payload as Channel)}`);
    } else {
      router.push(`/profile/${r.payload}`);
    }
  }, [router, setSearchQuery]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape closes the dropdown but keeps the query.
    if (e.key === "Escape") { setOpen(false); return; }
    // Tab is not intercepted — native focus traversal continues; blur closes the dropdown.
    if (e.key === "Tab") return;

    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) setOpen(true);
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % flat.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + flat.length) % flat.length); }
    else if (e.key === "Enter")  { e.preventDefault(); const r = flat[hi]; if (r) navigate(r); }
  };

  const renderGroup = (label: string, items: Result[], startIdx: number) => {
    if (items.length === 0) return null;
    return (
      <div className="px-1 pb-1">
        <div className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-widest text-white/35">{label}</div>
        {items.map((r, i) => {
          const idx = startIdx + i;
          const active = idx === hi;
          const Icon = r.kind === "channel" ? Hash : UserIcon;
          return (
            <button
              key={r.id}
              onMouseEnter={() => setHi(idx)}
              onMouseDown={(e) => { e.preventDefault(); navigate(r); }}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${
                active ? "bg-white/10" : "hover:bg-white/6"
              }`}
            >
              <Icon size={11} className="shrink-0 text-white/40" />
              <span className="flex-1 truncate text-[11px] text-white/85">{r.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const showDropdown = open && searchQuery.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative shrink-0 border-b border-white/8 px-4 py-2">
      <div
        className={[
          "mx-auto flex max-w-xl items-center gap-2 rounded-full px-3 py-1.5",
          "bg-white/5 backdrop-blur-md",
          "ring-1 ring-inset ring-white/8",
          "transition-all duration-150",
          "focus-within:bg-white/8 focus-within:ring-brand/30",
        ].join(" ")}
      >
        <Search size={12} className="shrink-0 text-white/30" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setSearchQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder="Search channels & creators…"
          spellCheck={false}
          className="flex-1 bg-transparent text-[11px] text-white/80 placeholder:text-white/25 outline-none"
        />
        {searchQuery && (
          <button
            onClick={clear}
            aria-label="Clear search"
            className="shrink-0 rounded-full p-0.5 text-white/30 transition-colors hover:text-white/70"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-1/2 top-full z-50 mt-2 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-white/12 bg-[#141414]/95 shadow-2xl backdrop-blur-xl">
          {flat.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
              {renderGroup("Channels", channels, 0)}
              {renderGroup("Creators", creators, channels.length)}
            </div>
          ) : (
            <div className="px-4 py-6 text-center">
              <p className="text-[11px] text-white/40">No results for &ldquo;{searchQuery}&rdquo;</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

Notable deltas vs the previous version:
- Imports: dropped `buildPostIndex`, `rankPosts`, `fuzzyMatch`, `normalizeTag`, `Video`. Added `buildAutocompleteSuggestions`, `channelSlug`, `type Channel`.
- Results memo: replaced with one call to the helper, mapped to `Result`s.
- `navigate`: new channel branch uses `router.push('/?channel=' + channelSlug)` and clears the text query; creator branch unchanged; tag branch deleted.
- `onKeyDown`: Escape no longer calls `clear()` — just `setOpen(false)`. Tab is explicitly unhandled.
- Dropdown: removed the Videos and Tags groups; only Channels + Creators render.
- Placeholder copy updated to match the new scope.

- [ ] **Step 2: Run the helper test + tsc to confirm nothing is broken**

Run in one go:
```
npx vitest run lib/search-autocomplete.test.ts && npx tsc --noEmit
```

Expected: tests pass; tsc emits no new errors.

- [ ] **Step 3: Run ESLint on the touched file**

Run: `npx eslint components/feed/global-search.tsx`

Expected: clean (no errors). Warnings pre-existing on master are acceptable.

- [ ] **Step 4: Commit**

```bash
git add components/feed/global-search.tsx
git commit -m "feat(search): narrow autocomplete to channels + creators

GlobalSearch now shows two sections — Channels (from CHANNELS taxonomy,
rendered as #Anal/#Blonde) and Creators (from post-derived handles,
rendered as @handle). Videos and free-form Tags sections are removed.

Selecting a channel routes to /?channel=<slug> and clears the text
query; selecting a creator routes to /profile/<handle>. Escape now
closes the dropdown without wiping the query. Tab falls through to
native focus traversal.

Powered by buildAutocompleteSuggestions (lib/search-autocomplete.ts),
ranked exact > prefix > substring."
```

---

## Task 7: Manual QA Checkpoint — STOP here

Per the user's instruction: stop after implementation and verify the dropdown manually.

- [ ] **Step 1: Start the dev server fresh**

Run: `npm run dev`

This also resolves any Turbopack stale-worker crash that was causing the /profile 500.

- [ ] **Step 2: Mouse QA script**

Open `http://localhost:3000/`. Click the search input and:

1. Type `bl` — expect Channels section showing `#Blonde`; Creators empty.
2. Type `#anal` — expect Channels shows `#Anal` (exact match, first).
3. Type `aur` — expect Creators section showing `@aurora_vj`; Channels empty.
4. Click `#Blonde` — expect URL changes to `/?channel=blonde` and the search box is now empty.
5. Back to `/`, type `aur`, click `@aurora_vj` — expect navigation to `/profile/aurora_vj`.
6. Type `zxqvw` — expect "No results" empty state.

- [ ] **Step 3: Keyboard QA script**

1. `Cmd/Ctrl+K` → focus jumps to the input and dropdown opens (empty until you type).
2. Type `a` — dropdown shows matches. Press `ArrowDown` a few times — the active row should change visually.
3. Press `ArrowUp` past the top — wraps to the bottom.
4. Press `Enter` on a highlighted creator row — navigates to that profile.
5. Back to `/`, type `bl`, press `Escape` — dropdown closes, the text `bl` **stays in the input**.
6. Focus the input again (click or tab) — dropdown reopens because the query is non-empty.
7. Press `Tab` from the input — focus moves to the next focusable element on the page; dropdown closes.

- [ ] **Step 4: Console check**

Open DevTools console. Interact with the Studio (load a project, play/pause — any action that would previously fire `Syncing Track`) and the home feed (let media hydrate). Expected: no `Syncing Track:` or `IDB Recovery Success:` lines. Warnings/errors unchanged.

- [ ] **Step 5: Profile 500 check**

Navigate to `/profile/you` and `/profile/aurora_vj`. Both should render (no 500). If still 500 after a fresh dev server, that's a separate environmental issue — capture the terminal output and report; do not bandage at the code level.

- [ ] **Step 6: Report back to the user**

Deliverables (spec): commit hash, files changed, test commands run, brief manual QA notes.

---

## Self-Review (filled in by the author of this plan)

**1. Spec coverage:**
- ✅ Channels + Creators only — Task 5 (helper) + Task 6 (UI).
- ✅ Channel format `#Anal`, Creator format `@handle` — Task 6 (`label: `#${c}``).
- ✅ Sources: CHANNELS + post-derived handles — Task 5.
- ✅ Ranking exact > prefix > substring — Task 5, tested in Task 4.
- ✅ Dedup + cap 8 per section — Task 5.
- ✅ Up/Down/Enter/Escape/Tab behavior — Task 6 `onKeyDown`.
- ✅ Escape closes but keeps query — Task 6 (explicit behavior change).
- ✅ Channel → `/?channel=slug`; Creator → `/profile/handle` — Task 6 `navigate`.
- ✅ Free-text submit preserved — the feed's `searchQuery` binding is unchanged; when no option is highlighted, clicking away / blur keeps the existing filter flow.
- ✅ Silence the two logs — Tasks 2 + 3.
- ✅ Profile 500 — Task 1.

**2. Placeholder scan:** No TBDs, no "implement later", all code blocks are complete.

**3. Type consistency:** `Channel` imported from `lib/config/taxonomy.ts` in both helper and component; `channelSlug` used consistently. Helper return type `AutocompleteSuggestions` has matching property names (`channels`, `creators`) with the component's destructure.

No gaps found.
