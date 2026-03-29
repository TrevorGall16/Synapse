# Studio Refinement Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy `list` ViewMode, enforce profile metadata limits via Zod schema, add pessimistic batch delete to the compact row, and reduce Chrome connection saturation in the video grid.

**Architecture:** All changes are confined to four files: `lib/schema.ts` (schema), `lib/store/user-store.ts` (hydration enforcement), `lib/store/feed-store.ts` (batch delete action), and `app/profile/[username]/page.tsx` (UI). Vitest is added for schema unit tests only. No new files except the test file.

**Tech Stack:** Next.js 15, React 19, Zod 4, Zustand 5, Vitest, TypeScript 5, Tailwind 4.

---

## Findings Report

### 1. ViewMode Pruning

**Status:** Safe to remove `list` in a single PR.

- `ViewMode` is a local TypeScript type at `app/profile/[username]/page.tsx:185` — no shared export, no localStorage persistence.
- Default state is `"grid"` (`useState<ViewMode>("grid")` at line 380) — no state migration needed.
- `PostListRow` (lines 203–261) is referenced only in the `viewMode === "list"` render block (lines 663–672). Deleting both removes 68 lines.
- The `List` icon from `lucide-react` (line 5 import) is used only for the list toggle button. It must be removed from the import to avoid a lint error.
- Toggle button for `list` is at lines 620–623 inside the three-button toggle group.

**Risk:** Zero. The type is local, not persisted, not shared.

---

### 2. Profile Schema & Policy Enforcement

**Current state:**
- `displayName` and `bio` limits (`maxLength={40}` and `maxLength={160}`) are hard-coded only in `EditProfileModal` (lines 160, 165). No Zod enforcement.
- `setProfile` in `user-store.ts` (line 64) spreads any `Partial<UserProfile>` directly into state — no validation.
- `onRehydrateStorage` (lines 74–103) rebuilds `migratedProfile` from raw localStorage JSON with zero schema validation. If a corrupted value exceeds the limit it silently passes in.

**Hydration silent-fail analysis:**
- Adding `.parse()` would throw on over-limit bio and hard-reset to `DEFAULT_PROFILE` ("Your Name") — **unacceptable UX**.
- Adding `.safeParse()` and falling back to `DEFAULT_PROFILE` on failure has the same problem.
- **Correct strategy:** Use `.safeParse()` to detect over-limit fields, then **coerce** (truncate strings, clamp numbers) rather than reject. This preserves the user's data while enforcing the invariant.
- The coercion helper `coerceUserProfile(raw)` runs before passing to `useUserStore.setState`.

**Schema design:**
- Use `.strip()` not `.strict()` — profile data is localStorage-persisted and forward-compatible additions must not break older clients.
- Export `DISPLAY_NAME_MAX = 40` and `BIO_MAX = 160` as authoritative constants from `lib/schema.ts`. `EditProfileModal` must import them instead of hard-coding.

**Bio typography:** Current: `text-xs text-white/65` (12px, 65% opacity). Proposed: `text-[13px] text-white/70` — 1px increase, 5% more contrast. No layout impact.

---

### 3. Batch Delete — Pattern Analysis

**Feed store persistence model:** Each `removePost(id)` call (feed-store.ts:94–101) fires `removePostFromIDB(id)` asynchronously with `.catch(console.warn)` — it does **not** await the IDB result. This is a fire-and-forget pattern suitable for single deletes but insufficient for batch operations where we need to know all deletes have landed before clearing the UI selection state.

**Pattern A — Optimistic UI + Rollback:**
- Immediately remove items from Zustand state, show "Undo" for 5s, rollback on error.
- Pro: Zero perceived latency.
- Con: If IDB write fails for item 3 of 10 after the UI already cleared, determining which items failed requires per-item tracking. Rollback means re-inserting into IDB — complex state machine.
- **Verdict:** Rollback complexity is disproportionate for a destructive operation. Violates YAGNI.

**Pattern B — Pessimistic Delete (RECOMMENDED):**
- Show "Deleting N posts…" overlay, await all IDB deletes in parallel, then update UI.
- Pro: Simple state machine. Aligns with Synapse's durability-first philosophy.
- Con: Perceived latency (~50–200ms for IDB `del` calls).
- **Implementation:** Add `removePosts(ids: string[]): Promise<void>` to `feed-store.ts` that awaits `Promise.all(ids.map(removePostFromIDB))` before updating Zustand state. The profile page awaits this method and shows an overlay during the wait.
- **Durability note:** `flushProjectToIDB()` (GlobalHydrator) is for the **project/studio** store, not the feed store. Feed posts have their own IDB layer (`feed-idb.ts`). No navigation occurs during a batch delete so the constitution's "await before router.push" rule does not apply here, but we still await the IDB writes for data integrity.

---

### 4. Media Optimization Feasibility Matrix

**Problem:** The profile grid goes up to `2xl:grid-cols-7`. Chrome has a 6 concurrent HTTP/1.1 connection limit per origin. When 7+ `<video>` elements are on screen and `preload` switches to `"auto"`, all cards simultaneously request buffering, saturating the connection pool and stalling other resource loads.

**Current behavior:**
- `video-preview-card.tsx:202` — `preload="none"` on mount.
- `video-preview-card.tsx:136` — IntersectionObserver flips to `v.preload = "auto"` on entry.
- On exit (line 148–157): pauses video, sets `playPromiseRef = null`, but **does not reset preload** — browser may continue buffering after the card leaves view.

**Incremental improvements (ranked by impact):**

| Improvement | Effort | Impact | Risk |
|---|---|---|---|
| `preload="metadata"` instead of `"auto"` on entry | 1 line | High | Zero |
| Reset `v.preload = "none"` on exit | 1 line | High | Zero |
| `fetchpriority="low"` on all video elements | 1 attr | Medium | Zero |
| Stagger connection opens (queue/delay) | Medium | Medium | Low |

**`"metadata"` vs `"auto"`:** `preload="metadata"` downloads only the first few KB (duration, dimensions, first frame hint). `preload="auto"` buffers the entire file. For a 7-column grid, using `"metadata"` means 7 small metadata requests instead of 7 full video buffers competing for 6 connections. This is the highest-leverage single-line fix.

**HLS feasibility verdict:** **NOT recommended.** The Zero Hosting constraint in `CLAUDE.md` prohibits uploading local `.mp4/.webm` files to any server. HLS requires server-side transcoding into `.m3u8` segments that a CDN serves. Since all video content is stored locally as blob URLs, there is no pipeline to segment. HLS would require fundamental architecture changes (cloud upload, FFmpeg transcoding service, CDN delivery) that contradict the local-first design.

---

## File Structure

| File | Action | Change |
|---|---|---|
| `app/profile/[username]/page.tsx` | Modify | Remove `list` from ViewMode, delete `PostListRow`, remove list toggle, update bio size, add multi-select state + UI |
| `lib/schema.ts` | Modify | Add `DISPLAY_NAME_MAX`, `BIO_MAX`, `UserProfileSchema`, `validateUserProfile()` |
| `lib/store/user-store.ts` | Modify | Import and apply `validateUserProfile` with coercion in `onRehydrateStorage` |
| `lib/store/feed-store.ts` | Modify | Add `removePosts(ids: string[]): Promise<void>` action |
| `components/feed/video-preview-card.tsx` | Modify | Switch to `preload="metadata"`, reset on exit, add `fetchpriority` |
| `lib/schema.test.ts` | Create | Vitest unit tests for `UserProfileSchema` and `validateUserProfile` |

---

## Task 1: Install Vitest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

- [ ] **Step 2: Add test script to package.json**

In `package.json`, in the `"scripts"` section, add after `"lint"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Verify Vitest runs**

```bash
npx vitest run --reporter=verbose 2>&1 | head -20
```

Expected: `No test files found` (zero failures, zero passing — no tests yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for schema unit tests"
```

---

## Task 2: Write Failing Tests for UserProfileSchema

**Files:**
- Create: `lib/schema.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// lib/schema.test.ts
import { describe, it, expect } from "vitest";
// These imports will fail until Task 3 — that is the point of TDD.
import {
  UserProfileSchema,
  validateUserProfile,
  coerceUserProfile,
  DISPLAY_NAME_MAX,
  BIO_MAX,
} from "./schema";

describe("UserProfileSchema", () => {
  it("accepts a valid profile", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "Trevor",
      bio: "Making edits",
      hue: 270,
      followers: 100,
      following: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a displayName longer than DISPLAY_NAME_MAX", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "A".repeat(DISPLAY_NAME_MAX + 1),
      bio: "hi",
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bio longer than BIO_MAX", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "Trevor",
      bio: "B".repeat(BIO_MAX + 1),
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects hue outside 0-359", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "Trevor",
      bio: "hi",
      hue: 400,
      followers: 0,
      following: 0,
    });
    expect(result.success).toBe(false);
  });

  it("strips unknown extra fields", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "Trevor",
      bio: "hi",
      hue: 270,
      followers: 0,
      following: 0,
      unknownField: "should be stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBeUndefined();
    }
  });
});

describe("validateUserProfile", () => {
  it("returns null for invalid data", () => {
    expect(validateUserProfile(null)).toBeNull();
    expect(validateUserProfile({ displayName: 123 })).toBeNull();
  });

  it("returns ValidatedUserProfile for valid data", () => {
    const result = validateUserProfile({
      username: "trev",
      displayName: "Trevor",
      bio: "Making edits",
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result).not.toBeNull();
    expect(result?.displayName).toBe("Trevor");
  });
});

describe("coerceUserProfile", () => {
  it("returns DEFAULT_PROFILE when input is null/undefined", () => {
    const result = coerceUserProfile(null);
    expect(result.username).toBe("you");
  });

  it("truncates displayName exceeding DISPLAY_NAME_MAX", () => {
    const longName = "A".repeat(DISPLAY_NAME_MAX + 10);
    const result = coerceUserProfile({
      username: "trev",
      displayName: longName,
      bio: "hi",
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result.displayName.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
  });

  it("truncates bio exceeding BIO_MAX", () => {
    const longBio = "B".repeat(BIO_MAX + 20);
    const result = coerceUserProfile({
      username: "trev",
      displayName: "Trevor",
      bio: longBio,
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result.bio.length).toBeLessThanOrEqual(BIO_MAX);
  });

  it("clamps hue to 0-359 range", () => {
    const result = coerceUserProfile({
      username: "trev",
      displayName: "Trevor",
      bio: "hi",
      hue: 400,
      followers: 0,
      following: 0,
    });
    expect(result.hue).toBeLessThanOrEqual(359);
    expect(result.hue).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail with "not found" import errors**

```bash
npx vitest run lib/schema.test.ts --reporter=verbose 2>&1 | head -30
```

Expected output includes `Error: Failed to resolve import "./schema"` or similar named export errors confirming `UserProfileSchema`, `coerceUserProfile` don't exist yet.

- [ ] **Step 3: Commit the failing tests**

```bash
git add lib/schema.test.ts
git commit -m "test(schema): add failing tests for UserProfileSchema and coerceUserProfile"
```

---

## Task 3: Add UserProfileSchema to lib/schema.ts

**Files:**
- Modify: `lib/schema.ts`

- [ ] **Step 1: Add profile constants and schema after the existing limit constants (line 25)**

In `lib/schema.ts`, add after the line `export const COLLECTION_DESC_MAX = 500;` (line 25):

```typescript
export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX          = 160;
```

- [ ] **Step 2: Add UserProfileSchema after the CollectionSchema block (after line 316)**

In `lib/schema.ts`, add after the `CollectionSchema` definition (after line 316, before the exported inferred types section):

```typescript
// ── UserProfile ───────────────────────────────────────────────────────────────
// .strip() — persisted to localStorage; unknown fields from future versions
// must not cause validation failures on older clients.

export const UserProfileSchema = z.object({
  username:    z.string().min(1).max(40),
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX),
  bio:         z.string().max(BIO_MAX),
  hue:         z.number().int().min(0).max(359),
  followers:   z.number().nonnegative().int(),
  following:   z.number().nonnegative().int(),
}).strip();

export type ValidatedUserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Coerce a raw value into a valid UserProfile.
 * Never throws — truncates over-limit strings, clamps numeric ranges.
 * Preserves the user's data rather than resetting to DEFAULT_PROFILE.
 */
export function coerceUserProfile(raw: unknown): ValidatedUserProfile {
  const DEFAULT: ValidatedUserProfile = {
    username: "you", displayName: "Your Name",
    bio: "Making edits in Synapse", hue: 270,
    followers: 0, following: 0,
  };
  if (!raw || typeof raw !== "object") return DEFAULT;
  const r = raw as Record<string, unknown>;
  return {
    username:    typeof r.username    === "string" && r.username.length > 0 ? r.username    : DEFAULT.username,
    displayName: typeof r.displayName === "string" && r.displayName.length > 0
      ? r.displayName.slice(0, DISPLAY_NAME_MAX)
      : DEFAULT.displayName,
    bio:      typeof r.bio      === "string" ? r.bio.slice(0, BIO_MAX)         : DEFAULT.bio,
    hue:      typeof r.hue      === "number" ? Math.max(0, Math.min(359, Math.round(r.hue))) : DEFAULT.hue,
    followers: typeof r.followers === "number" ? Math.max(0, Math.floor(r.followers)) : DEFAULT.followers,
    following: typeof r.following === "number" ? Math.max(0, Math.floor(r.following)) : DEFAULT.following,
  };
}

/** Validate a UserProfile from localStorage. Returns null on hard failure (wrong shape entirely). */
export function validateUserProfile(raw: unknown, context = "localStorage"): ValidatedUserProfile | null {
  const result = UserProfileSchema.safeParse(raw);
  if (!result.success) {
    console.warn(`[Schema] UserProfile validation failed (${context}):`, result.error.issues);
    return null;
  }
  return result.data;
}
```

- [ ] **Step 3: Run the failing tests — they should now pass**

```bash
npx vitest run lib/schema.test.ts --reporter=verbose
```

Expected: `✓ lib/schema.test.ts (14 tests)` — all green.

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No new type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/schema.ts lib/schema.test.ts
git commit -m "feat(schema): add UserProfileSchema, coerceUserProfile, validateUserProfile"
```

---

## Task 4: Enforce Schema in User Store Hydration

**Files:**
- Modify: `lib/store/user-store.ts`

- [ ] **Step 1: Add the import at the top of user-store.ts**

In `lib/store/user-store.ts`, add after the existing imports (after line 4 `import { persist } from "zustand/middleware";`):

```typescript
import { coerceUserProfile } from "@/lib/schema";
```

- [ ] **Step 2: Replace the raw `migratedProfile` assembly in onRehydrateStorage**

Current code in `onRehydrateStorage` (lines 77–89):
```typescript
const stored = state as Record<string, unknown> | undefined;
const migratedProfile: UserProfile =
  (stored?.profile as UserProfile | undefined) ??
  (stored?.username
    ? {
        username: stored.username as string,
        displayName: stored.displayName as string,
        bio: stored.bio as string,
        hue: stored.hue as number,
        followers: (stored.followers as number) ?? 0,
        following: (stored.following as number) ?? 0,
      }
    : DEFAULT_PROFILE);
```

Replace with:
```typescript
const stored = state as Record<string, unknown> | undefined;
// Build raw candidate: prefer nested `profile` object, fall back to old flat format.
const rawProfile: unknown =
  stored?.profile ??
  (stored?.username
    ? {
        username: stored.username,
        displayName: stored.displayName,
        bio: stored.bio,
        hue: stored.hue,
        followers: stored.followers ?? 0,
        following: stored.following ?? 0,
      }
    : null);
// coerceUserProfile never throws and never returns DEFAULT_PROFILE silently —
// it truncates over-limit fields so the user's actual data is preserved.
const migratedProfile = coerceUserProfile(rawProfile);
```

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 4: Run lint**

```bash
npx eslint lib/store/user-store.ts --max-warnings 0 2>&1 | head -20
```

Expected: No warnings or errors.

- [ ] **Step 5: Commit**

```bash
git add lib/store/user-store.ts
git commit -m "feat(user-store): enforce UserProfileSchema with coercion on localStorage rehydration"
```

---

## Task 5: ViewMode Pruning — Remove `list`

**Files:**
- Modify: `app/profile/[username]/page.tsx`

- [ ] **Step 1: Remove the `List` import and update the ViewMode type**

In `app/profile/[username]/page.tsx` line 5, change:
```typescript
import { ArrowLeft, Zap, Globe, Heart, Edit3, Users, Trash2, X, Check, WifiOff, Share2, Grid3X3, List, LayoutGrid, Clock, Layers, GitBranch } from "lucide-react";
```
to:
```typescript
import { ArrowLeft, Zap, Globe, Heart, Edit3, Users, Trash2, X, Check, WifiOff, Share2, Grid3X3, LayoutGrid, Clock, Layers, GitBranch } from "lucide-react";
```

At line 185, change:
```typescript
type ViewMode = "grid" | "list" | "compact";
```
to:
```typescript
type ViewMode = "grid" | "compact";
```

- [ ] **Step 2: Delete the PostListRow component (lines 203–261)**

Remove the entire block from `// ── List View Row ────` through the closing `}` of `PostListRow`.

The section to delete starts at `// ── List View Row ────────────────────────────────────────────────────────────` (line 203) and ends at the closing `}` of `PostListRow` (line 261).

After deletion, line 203 should be `// ── Compact Preview Row`.

- [ ] **Step 3: Remove the list toggle button from the ViewMode toggle group**

In the toggle group (around line 610–624 after prior deletions), remove the list button. The toggle group should go from three buttons to two:

```tsx
<div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-white/[0.03] p-0.5">
  <button onClick={() => setViewMode("grid")} title="Grid"
    className={`rounded-md p-1.5 transition-colors ${viewMode === "grid" ? "bg-white/10 text-white/80" : "text-white/30 hover:text-white/55"}`}>
    <Grid3X3 size={11} />
  </button>
  <button onClick={() => setViewMode("compact")} title="Compact"
    className={`rounded-md p-1.5 transition-colors ${viewMode === "compact" ? "bg-white/10 text-white/80" : "text-white/30 hover:text-white/55"}`}>
    <LayoutGrid size={11} />
  </button>
</div>
```

- [ ] **Step 4: Remove the list render block**

Find and delete the entire block:
```tsx
{isOwnProfile && unifiedPosts.length > 0 && viewMode === "list" && (
  <div className="flex flex-col gap-1.5">
    {unifiedPosts.map((item) => (
      <PostListRow key={item.id} item={item} allPosts={allUserPosts}
        onOpen={() => handleOpenPost(item)}
        onDelete={item.type === "feed" ? () => removePost(item.id) : undefined}
      />
    ))}
  </div>
)}
```

- [ ] **Step 5: Run TypeScript check and lint**

```bash
npx tsc --noEmit 2>&1 | head -20 && npx eslint app/profile/[username]/page.tsx --max-warnings 0 2>&1 | head -20
```

Expected: No errors. If `List` is referenced anywhere else, fix those.

- [ ] **Step 6: Commit**

```bash
git add "app/profile/[username]/page.tsx"
git commit -m "feat(profile): remove legacy list ViewMode and PostListRow component"
```

---

## Task 6: Bio Typography + Import Schema Constants

**Files:**
- Modify: `app/profile/[username]/page.tsx`

- [ ] **Step 1: Import schema constants in profile page**

In `app/profile/[username]/page.tsx`, add to the existing schema import:

Change:
```typescript
import { validateSerializedProject } from "@/lib/schema";
```
to:
```typescript
import { validateSerializedProject, DISPLAY_NAME_MAX, BIO_MAX } from "@/lib/schema";
```

- [ ] **Step 2: Use constants in EditProfileModal**

In `EditProfileModal` (around line 160), change the hard-coded `maxLength={40}`:
```tsx
<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
```
to:
```tsx
<input value={name} onChange={(e) => setName(e.target.value)} maxLength={DISPLAY_NAME_MAX}
```

Change the hard-coded `maxLength={160}`:
```tsx
<textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={2} maxLength={160}
```
to:
```tsx
<textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={2} maxLength={BIO_MAX}
```

- [ ] **Step 3: Upgrade bio typography**

In the profile page render (line ~571), change:
```tsx
<p className="mt-1.5 text-xs text-white/65">{profile.bio}</p>
```
to:
```tsx
<p className="mt-1.5 text-[13px] leading-snug text-white/70">{profile.bio}</p>
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add "app/profile/[username]/page.tsx"
git commit -m "feat(profile): use schema constants for bio/name limits, improve bio readability"
```

---

## Task 7: Add removePosts to Feed Store

**Files:**
- Modify: `lib/store/feed-store.ts`

- [ ] **Step 1: Add `removePosts` to the FeedState interface**

In `lib/store/feed-store.ts`, in the `interface FeedState` (lines 63–71), add after `removePost`:

```typescript
/** Batch remove — awaits all IDB deletes before updating Zustand state. */
removePosts: (ids: string[]) => Promise<void>;
```

- [ ] **Step 2: Implement removePosts in the store factory**

In the store `(set, get) => ({...})` body, add after the `removePost` implementation (after line 101):

```typescript
removePosts: async (ids) => {
  if (ids.length === 0) return;
  // Collect media pool items before removing from state.
  const posts = get().userPosts.filter((p) => ids.includes(p.id));
  // Release OPFS blobs for all removed posts.
  await Promise.all(
    posts
      .filter((p) => p.projectSnapshot?.mediaPool?.length)
      .map((p) => releaseSnapshotMedia(p.projectSnapshot!.mediaPool!).catch(console.warn))
  );
  // Await all IDB deletes — durability guarantee before updating in-memory state.
  await Promise.all(ids.map((id) => removePostFromIDB(id).catch(console.warn)));
  // Update Zustand state only after IDB writes complete.
  const idSet = new Set(ids);
  set((s) => ({ userPosts: s.userPosts.filter((p) => !idSet.has(p.id)) }));
},
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/store/feed-store.ts
git commit -m "feat(feed-store): add removePosts for awaitable batch IDB delete"
```

---

## Task 8: Batch Multi-Select UI + Pessimistic Delete

**Files:**
- Modify: `app/profile/[username]/page.tsx`

- [ ] **Step 1: Add multi-select state to ProfilePage**

In `ProfilePage`, after the existing `useState` declarations (around line 381–383), add:

```typescript
const [selectedIds, setSelectedIds]    = useState<Set<string>>(new Set());
const [isMultiSelect, setIsMultiSelect] = useState(false);
const [isBatchDeleting, setIsBatchDeleting] = useState(false);
```

- [ ] **Step 2: Add removePosts to the feed store subscriptions at top of ProfilePage**

Add `removePosts` alongside existing `removePost`:

Change:
```typescript
const removePost       = useFeedStore((s) => s.removePost);
```
to:
```typescript
const removePost   = useFeedStore((s) => s.removePost);
const removePosts  = useFeedStore((s) => s.removePosts);
```

- [ ] **Step 3: Add the batch delete handler**

In `ProfilePage`, after the `cleanupOffline` function (after line ~447), add:

```typescript
const handleBatchDelete = useCallback(async () => {
  const ids = [...selectedIds];
  if (ids.length === 0) return;
  setIsBatchDeleting(true);
  try {
    await removePosts(ids);
    setSelectedIds(new Set());
    setIsMultiSelect(false);
  } catch (err) {
    console.error("[Profile] batch delete failed:", err);
    // Posts remain in store — IDB and state are consistent (removePosts only
    // updates state after all IDB deletes succeed).
  } finally {
    setIsBatchDeleting(false);
  }
}, [selectedIds, removePosts]);

const toggleSelect = useCallback((id: string) => {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    return next;
  });
}, []);
```

- [ ] **Step 4: Add the multi-select toggle and batch delete toolbar**

In the `Tabs + View Mode Toggle` section (after the tabs row, before the `</div>` closing the flex container at the bottom of that section), add the multi-select toolbar. This renders only in `compact` mode for own profile.

Add the following immediately after the closing `</div>` of the toggle group block (after the `{tab === "published" && ...}` toggle block):

```tsx
{tab === "published" && isOwnProfile && viewMode === "compact" && (
  <div className="flex items-center gap-2 border-t border-white/6 bg-[#141414]/80 px-6 py-2">
    <button
      onClick={() => { setIsMultiSelect((v) => !v); setSelectedIds(new Set()); }}
      className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors ${
        isMultiSelect ? "bg-white/12 text-white/80" : "text-white/35 hover:bg-white/8 hover:text-white/60"
      }`}
    >
      {isMultiSelect ? "Cancel" : "Select"}
    </button>
    {isMultiSelect && selectedIds.size > 0 && (
      <button
        onClick={handleBatchDelete}
        disabled={isBatchDeleting}
        className="flex items-center gap-1 rounded-md bg-red-500/20 px-2.5 py-1 text-[10px] font-bold text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
      >
        <Trash2 size={9} />
        {isBatchDeleting ? `Deleting ${selectedIds.size}…` : `Delete ${selectedIds.size}`}
      </button>
    )}
    {isMultiSelect && selectedIds.size === 0 && (
      <span className="text-[10px] text-white/30">Tap rows to select</span>
    )}
  </div>
)}
```

- [ ] **Step 5: Update PostCompactRow to accept multi-select props**

At the top of the `PostCompactRow` function definition, add the new props:

Change:
```typescript
function PostCompactRow({ item, allPosts, onOpen, onDelete }: {
  item: { type: "feed" | "registry"; id: string; title: string; accent: string; bg: string; date: number; post: FeedPost | null };
  allPosts: FeedPost[];
  onOpen: () => void;
  onDelete?: () => void;
}) {
```
to:
```typescript
function PostCompactRow({ item, allPosts, onOpen, onDelete, isMultiSelectMode = false, isSelected = false, onSelect }: {
  item: { type: "feed" | "registry"; id: string; title: string; accent: string; bg: string; date: number; post: FeedPost | null };
  allPosts: FeedPost[];
  onOpen: () => void;
  onDelete?: () => void;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}) {
```

- [ ] **Step 6: Update PostCompactRow click behavior for multi-select mode**

In the `PostCompactRow` return, on the outer `<div>`, add an `onClick` that routes between select and open:

Change the outer wrapper opening tag from:
```tsx
<div className="group flex items-center gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-2 py-1.5 transition-colors hover:border-white/14 hover:bg-white/[0.04]">
```
to:
```tsx
<div
  onClick={isMultiSelectMode ? () => onSelect?.(item.id) : undefined}
  className={`group flex items-center gap-3 rounded-lg border px-2 py-1.5 transition-colors ${
    isSelected
      ? "border-red-500/30 bg-red-500/8"
      : "border-white/6 bg-white/[0.02] hover:border-white/14 hover:bg-white/[0.04]"
  } ${isMultiSelectMode ? "cursor-pointer" : ""}`}
>
```

Add the checkbox indicator as the first child of the outer div (before the thumbnail `<div ref={thumbRef}`):
```tsx
{isMultiSelectMode && (
  <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
    isSelected ? "border-red-400 bg-red-500/30" : "border-white/20 bg-transparent"
  }`}>
    {isSelected && <Check size={9} className="text-red-300" />}
  </div>
)}
```

- [ ] **Step 7: Pass multi-select props to PostCompactRow in the render block**

Find the `PostCompactRow` instantiation in the compact render block:

Change:
```tsx
{unifiedPosts.map((item) => (
  <PostCompactRow key={item.id} item={item} allPosts={allUserPosts}
    onOpen={() => handleOpenPost(item)}
    onDelete={item.type === "feed" ? () => removePost(item.id) : undefined}
  />
))}
```
to:
```tsx
{unifiedPosts.map((item) => (
  <PostCompactRow key={item.id} item={item} allPosts={allUserPosts}
    onOpen={() => handleOpenPost(item)}
    onDelete={item.type === "feed" ? () => removePost(item.id) : undefined}
    isMultiSelectMode={isMultiSelect}
    isSelected={selectedIds.has(item.id)}
    onSelect={toggleSelect}
  />
))}
```

- [ ] **Step 8: TypeScript check and lint**

```bash
npx tsc --noEmit 2>&1 | head -30 && npx eslint "app/profile/[username]/page.tsx" --max-warnings 0 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add "app/profile/[username]/page.tsx" lib/store/feed-store.ts
git commit -m "feat(profile): add pessimistic batch delete with multi-select in compact view"
```

---

## Task 9: Media Preload Optimization

**Files:**
- Modify: `components/feed/video-preview-card.tsx`

**Why these changes:** Chrome allows 6 concurrent HTTP/1.1 connections per origin. With 7 visible grid cards all switching to `preload="auto"` simultaneously, all 6+ connection slots are consumed by video buffering, stalling other resource loads. Switching to `preload="metadata"` downloads only the first few KB (dimensions, duration, first keyframe hint) rather than the full video. Resetting to `preload="none"` on exit signals the browser to stop any in-progress buffering for off-screen cards.

- [ ] **Step 1: Change preload switch from "auto" to "metadata" on intersection entry**

In `components/feed/video-preview-card.tsx`, in the IntersectionObserver callback (line 136), change:
```typescript
v.preload = "auto";
```
to:
```typescript
v.preload = "metadata";
```

- [ ] **Step 2: Reset preload to "none" on intersection exit**

In the same observer callback, in the `else if (!intersecting && v)` branch (after line 156, before the closing `}`), add:

After `playPromiseRef.current = null;`, add:
```typescript
// Signal browser to stop buffering off-screen cards.
// This frees connection slots for visible cards and reduces memory pressure.
v.preload = "none";
```

- [ ] **Step 3: Add fetchpriority="low" to the video element**

In the video element render (line ~199–208), add the `fetchpriority` attribute:

Change:
```tsx
<video
  ref={videoRef}
  src={url}
  preload="none"
  muted
  playsInline
  className="absolute inset-0 h-full w-full object-cover"
  onLoadedMetadata={handleLoadedMetadata}
  onError={handleError}
/>
```
to:
```tsx
<video
  ref={videoRef}
  src={url}
  preload="none"
  muted
  playsInline
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error — fetchpriority is a valid HTML attribute not yet in React types
  fetchpriority="low"
  className="absolute inset-0 h-full w-full object-cover"
  onLoadedMetadata={handleLoadedMetadata}
  onError={handleError}
/>
```

- [ ] **Step 4: Update the component's performance contract comment**

In the file header comment (lines 21–27), update the performance contract note to reflect the new preload strategy. Replace:

```
//   - `preload="none"` until in-view; the browser switches to buffering only when
//     the card enters the viewport.
```
with:
```
//   - `preload="none"` until in-view; switches to `preload="metadata"` on entry
//     (fetches duration/dimensions only, not the full video). Resets to `preload="none"`
//     on exit to free connection slots for the Chrome 6-connection limit.
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors (the `@ts-expect-error` handles the `fetchpriority` attribute).

- [ ] **Step 6: Run all tests**

```bash
npx vitest run --reporter=verbose
```

Expected: All schema tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/feed/video-preview-card.tsx
git commit -m "perf(video-preview-card): use preload=metadata, reset on exit, add fetchpriority=low"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Remove `list` ViewMode | Task 5 |
| Validate UI toggle has only grid/compact | Task 5 |
| No localStorage migration needed (no persistence) | Task 5 (finding) |
| `DISPLAY_NAME_MAX` and `BIO_MAX` constants exported | Task 3 |
| `UserProfileSchema` in `lib/schema.ts` | Task 3 |
| No `.passthrough()` on the new schema | Task 3 (`.strip()` used) |
| Hydration enforces schema without silent-failing | Task 4 |
| Constants imported in EditProfileModal | Task 6 |
| Bio font size increase | Task 6 |
| Pessimistic delete analysis documented | Findings §3 |
| Batch multi-select on PostCompactRow | Task 8 |
| `removePosts` awaits IDB before updating state | Task 7 |
| No navigation during batch delete | Task 8 (no router.push) |
| `preload="metadata"` reduces connection pressure | Task 9 |
| Reset `preload="none"` on exit | Task 9 |
| HLS verdict | Findings §4 |
| No new `.passthrough()` | All tasks (verified) |
| No new `requestAnimationFrame` | All tasks (verified) |

### Placeholder Scan

No TBD, TODO, or "similar to Task N" placeholders exist.

### Type Consistency

- `ValidatedUserProfile` — defined in Task 3, used in Task 4. Match confirmed.
- `removePosts(ids: string[])` — defined in Task 7 interface, implemented in Task 7 store, called in Task 8. Signature is consistent.
- `isMultiSelectMode`, `isSelected`, `onSelect` — defined in Task 8 Step 5, passed in Task 8 Step 7. Names match.
- `coerceUserProfile` — exported in Task 3, imported in Task 4. Match confirmed.
