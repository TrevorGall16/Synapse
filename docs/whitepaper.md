# Synapse Interactive Hub — Technical Whitepaper
**Revision:** `4089c6d` · **Date:** 2026-03-29 · **Audience:** External Senior Auditor

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Runtime Stack](#2-runtime-stack)
3. [Core Architecture](#3-core-architecture)
4. [Persistence Layer](#4-persistence-layer)
5. [Data Integrity & Ingress Validation](#5-data-integrity--ingress-validation)
6. [Specialized Logic](#6-specialized-logic)
7. [Security & Authorization Model](#7-security--authorization-model)
8. [Hardening Rules (The Synapse Constitution)](#8-hardening-rules-the-synapse-constitution)
9. [Roadmap & Identified Gaps](#9-roadmap--identified-gaps)

---

## 1. Project Identity

**Synapse Interactive Hub** is a **local-first, browser-native non-linear editor (NLE) and discovery platform** for short-form video creators.

The central design thesis: *a creator should be able to produce, remix, and publish a high-intensity audio-synced video edit without a single file leaving their machine.* There is no upload pipeline, no server-side transcoding, and no cloud dependency in the current phase. All heavy media — raw `.mp4`, `.webm`, `.mov` files — lives entirely on the user's device. The only data that may eventually leave the device is a capped, structured JSON recipe (`.SYNAPSE` format, ≤ 5 MB), which encodes the edit's event graph without embedding media bytes.

The platform has two primary surfaces:

| Surface | Responsibility |
|---|---|
| **The Studio** | High-intensity, audio-synced NLE. Vegas Pro-style timeline with WebGPU rendering, GlobalTicker master clock, and a Zustand-backed event queue. |
| **The Theater** | High-performance DOM-based discovery feed. Standard `<video>` elements, IntersectionObserver-driven playback, no WebGPU dependency. |

---

## 2. Runtime Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 16.1.6 |
| UI Runtime | React | 19.2.3 |
| State Management | Zustand | 5.0.11 |
| Schema / Validation | Zod | 4.3.6 |
| Styling | Tailwind CSS | 4.x |
| Language | TypeScript | 5.x |
| Local DB | `idb-keyval` (IndexedDB wrapper) | — |
| Icon Library | `lucide-react` | — |
| Test Runner | Vitest + `@vitest/coverage-v8` | — |
| Platform | Browser-native (Chrome/Edge primary; no Node.js server at runtime) | — |

---

## 3. Core Architecture

### 3.1 Folder Structure

```
app/              — Next.js App Router pages
  studio/         — NLE timeline surface
  profile/[username]/  — Creator profile + post management
  explore/        — Preset discovery + stats
  niche/[category]/   — Taxonomy-filtered feed views
  home/           — Landing / discovery feed
components/
  feed/           — VideoPreviewCard, TheaterMode, UploadModal, PostCard
  timeline/       — Track, Playhead, ClipEvent components
  ui/             — Shared primitives (Confetti, Toasts, etc.)
  explore/        — PresetShowcase, StatsGrid
lib/
  schema.ts       — Zero-Trust Ingress (Zod schemas, authoritative constants)
  store/
    feed-store.ts       — FeedPost state + IDB integration
    feed-idb.ts         — Per-record IndexedDB CRUD layer
    media-pool-db.ts    — ArrayBuffer → ObjectURL lifecycle (IDB)
    user-store.ts       — UserProfile with coercion-based hydration
    project-store.ts    — Active NLE project state
    global-ticker.ts    — Single rAF master clock
    idb-safe-write.ts   — QuotaExceededError wrapper + toast
  policy.ts       — canRemix() authorization gate
  stats.ts        — Trending/analytics derivations
workers/          — Web Workers for OPFS binary proxies (planned)
supabase/         — Migrations and DB types (initialized, not yet active)
```

### 3.2 State Management Model

Zustand 5 is the sole client state manager. Each domain has exactly one store; stores do not import each other directly — they share types via `lib/store/types.ts`.

**Key invariant for Zustand 5 compatibility:** the `subscribe(selector, callback)` overload was removed in v5. All reactive subscriptions use `useStore(selector)` inside `useEffect`. The store's imperative API (`useFeedStore.getState()`) is used only in event handlers that fire outside the React commit cycle.

---

## 4. Persistence Layer

Synapse uses a three-tier storage model. Each tier has a strict, non-overlapping responsibility.

### 4.1 Tier 1 — localStorage (Lightweight Scalars)

**Managed by:** Zustand `persist` middleware
**Store key:** `synapse-user-profile`, `synapse-feed-posts`
**Content:**
- `likedPostIds: string[]` — array of UUIDs (feed-store). Explicitly isolated via `partialize` so `userPosts` are **never** written to localStorage.
- `UserProfile` scalar fields — hydrated via `onRehydrateStorage` with Zod coercion (see §5.2).

`userPosts` is intentionally excluded from localStorage. The `partialize` config in `useFeedStore` writes only `{ likedPostIds }` to `localStorage`. All post data lives exclusively in IndexedDB.

### 4.2 Tier 2 — IndexedDB (Structured Metadata + Binary Media)

Two distinct IDB namespaces, each serving a different access pattern:

#### 4.2.1 Feed Post Store — `synapse-feed-db / posts`

**Implementation:** `lib/store/feed-idb.ts`

Each `FeedPost` is stored as an individual keyed record (key = `post.id`). This means `addPost` and `removePost` touch exactly one IDB record — no full-array rewrites.

**Blob URL stripping on write:** `savePostToIDB` sanitizes the record before writing:
```typescript
videoUrl:    post.videoUrl?.startsWith("blob:") ? undefined : post.videoUrl,
mediaPool:   pool.map(m => ({ ...m, previewUrl: m.previewUrl?.startsWith("blob:") ? "" : m.previewUrl }))
```
Blob URLs are session-only (`blob:` scheme is invalidated on page unload). Storing them would produce broken references on the next boot. They are re-hydrated from the media pool on startup.

**Boot hydration sequence** (`hydrateAllPosts` in `feed-store.ts`):
1. Load all raw post records from IDB (`loadAllPostsFromIDB`).
2. Run each record through `validateFeedPost` (Zod schema bouncer). Invalid records are dropped individually — one corrupt record cannot take down the entire feed.
3. For posts with a `projectSnapshot.mediaPool`, call `hydrateMediaPool` to reconstruct `ObjectURL` blob references.
4. Merge with any in-memory posts written during the same tick (race guard: `addPost` called concurrently with hydration).
5. Write the merged, validated array to Zustand state.

#### 4.2.2 Media Pool Store — `synapse-media-{id}` keys

**Implementation:** `lib/store/media-pool-db.ts`

Stores full file `ArrayBuffer` content alongside metadata. Each record carries a `refCount` (number of projects/posts referencing it) and a `createdAt` timestamp for GC age checks.

On load, `ArrayBuffer` bytes are reconstructed into `Blob` objects and then into `ObjectURL`s:
```typescript
const blob = new Blob([stored.data], { type: stored.mimeType });
const previewUrl = URL.createObjectURL(blob);
```
The module maintains a `sessionAliveBlobUrls: Set<string>` to skip re-creation for URLs already alive in the current page session.

**MIME inference:** Extension-to-MIME mapping covers `.mp4`, `.webm`, `.mov`, `.mkv`, `.mp3`, `.wav`, `.ogg`, `.aac`, `.flac`, `.png`, `.jpg`, `.gif`, `.webp`. Falls back to `application/octet-stream` for unknown extensions.

**Write safety — `idbSafeSet`:** All IDB writes route through `lib/store/idb-safe-write.ts`, which wraps `idb-keyval`'s `set()` with explicit `QuotaExceededError` handling. On quota breach, a registered toast function is called with a human-readable message before the write fails gracefully. This prevents silent data loss when the browser's origin storage is full.

### 4.3 Tier 3 — OPFS (Origin Private File System) — Planned

**Status:** Architecture and interfaces defined; Web Worker scaffolding in `workers/` is the next implementation phase.

**Planned use:** High-bitrate video proxy files generated by WebCodecs. Decoded frames and transcode outputs are too large and too binary for IDB (IDB is not optimized for sequential byte access). OPFS provides a synchronous-accessible file handle via `createSyncAccessHandle()` that can be passed into a Web Worker for zero-copy frame reads.

**Boundary rule:** OPFS is strictly for binary blobs. All metadata (duration, resolution, codec, track assignments) lives in IDB as structured JSON. The two tiers communicate via `MediaPoolItem.id` as the foreign key.

### 4.4 No-Cloud (Local-Only) Phase

In the current phase, **zero media bytes leave the device**. This is enforced by policy, not just convention:

- `CLAUDE.md` carries the rule: *"Never write code that attempts to upload the user's local `.mp4` or `.webm` files to Supabase."*
- File paths in the `.SYNAPSE` JSON state are stored as relative strings (e.g., `./video.mp4`) mapped to a local `FileSystemDirectoryHandle`. Absolute OS paths are never persisted.
- `supabase init` has been run and the client is configured, but the cloud sync feature gate has not been opened. All Supabase tables and RLS policies are authored but not yet called from application code.

The eventual cloud layer will sync only the JSON recipe (≤ 5 MB cap) for cross-device project continuity, never the media files themselves.

---

## 5. Data Integrity & Ingress Validation

### 5.1 Zero-Trust Ingress (lib/schema.ts)

`lib/schema.ts` is the **sole authoritative Zod layer**. All external data — IDB reads, localStorage rehydration, URL parameters — must pass through these schemas before being injected into any Zustand store. Direct type-casting from storage is prohibited.

**Schema taxonomy:**

| Pattern | Used For | Rationale |
|---|---|---|
| `.strict()` | Core edit models (`EffectInstanceSchema`, `PanCropDataSchema`, `CollectionSchema`) | Unknown fields from deserialized data indicate schema drift — hard reject to surface bugs. |
| `.strip()` | Feed/ingest models (`FeedPostSchema`, `UserProfileSchema`, `PresetDataSchema`) | Forward-compatible: fields added in future versions silently drop on older clients rather than crashing. |
| `.passthrough()` | `FxParamsLegacySchema` **only** | Sole permitted exception. Handles saved FX data with `effectType` values not present in the current discriminated union. |
| `z.lazy()` | `ClipEventSchema`, `JsonValueSchema` | Recursive types: `ClipEvent` embeds `embeddedEffectClips: ClipEvent[]`; `JsonValueSchema` covers arbitrary depth keyframe values. |

**Global rule enforced by code review:** `.parse()` is **never** used. All validation calls use `.safeParse()`. A thrown Zod error crashing the session is treated as a bug, not acceptable behavior.

**Authoritative constants** — UI input `maxLength` props must import these; hard-coding is prohibited:

```typescript
export const TITLE_MAX        = 80;
export const DESCRIPTION_MAX  = 300;
export const USERNAME_MAX      = 40;
export const DISPLAY_NAME_MAX  = 40;
export const BIO_MAX           = 160;
export const COLLECTION_NAME_MAX = 80;
export const COLLECTION_DESC_MAX = 500;
```

### 5.2 Zod Coercion — Preventing Hydration Failures

**Problem:** `UserProfile` is persisted to localStorage. A user's bio or display name may have been written when limit constants were more permissive, or via a developer console. On next load, a strict `.parse()` would throw; a `.safeParse()` fallback to `DEFAULT_PROFILE` would silently erase the user's actual data.

**Solution: `coerceUserProfile(raw: unknown): ValidatedUserProfile`**

`coerceUserProfile` is a non-throwing coercion function that:
- Truncates `displayName` to `DISPLAY_NAME_MAX` characters (preserves leading characters).
- Truncates `bio` to `BIO_MAX` characters.
- Clamps `hue` to `[0, 359]` via `Math.max(0, Math.min(359, Math.round(hue)))`.
- Floors and clamps `followers`/`following` to non-negative integers.
- Falls back to `DEFAULT_PROFILE` field values only for fields that are the wrong type entirely (e.g., `displayName: 123`).
- **Never silently resets the entire profile.** Data is preserved at the field level.

This function is called in `user-store.ts → onRehydrateStorage` before writing to Zustand state:

```typescript
// onRehydrateStorage callback (user-store.ts)
const rawProfile: unknown = stored?.profile ?? (stored?.username ? { ...flatFieldFallback } : null);
const migratedProfile = coerceUserProfile(rawProfile);
// migratedProfile is a ValidatedUserProfile — guaranteed to pass UserProfileSchema.parse()
useUserStore.setState({ hasHydrated: true, profile: migratedProfile, ... });
```

The `queueMicrotask` wrapper defers `setState` until after `create()` returns, preventing a TDZ `ReferenceError` when localStorage rehydration fires synchronously during store initialization.

**Legacy flat-field migration:** Pre-v1 localStorage stored profile fields at the top level (`stored.username`, `stored.displayName`, etc.) rather than nested under `stored.profile`. The hydration path handles both formats via a conditional spread before coercion.

### 5.3 Durability Contract — Batch Delete

The `removePosts(ids: string[])` action in `feed-store.ts` implements a **pessimistic delete** pattern:

```
1. Release OPFS blobs for affected posts (non-durable cleanup — failures swallowed).
2. await Promise.all(ids.map(id => removePostFromIDB(id)));   ← NO per-item .catch()
3. set(s => ({ userPosts: s.userPosts.filter(p => !idSet.has(p.id)) }));
```

**The critical invariant:** there is no `.catch()` inside the `Promise.all` map. If any IDB delete fails, the entire `Promise.all` rejects, the error propagates to the calling UI handler, and Zustand state is **never updated**. The UI's selection state and the store remain consistent with IDB. The single-record `removePost` uses fire-and-forget `.catch(console.warn)` because single deletes on a non-existent key are idempotent; batch deletes are not.

---

## 6. Specialized Logic

### 6.1 The Taxonomy Bridge — Hashtags and Niches Unified

**Problem:** The feed has two categorization systems that need to coexist:

1. **Hashtags (`FeedPost.tags: string[]`)** — freeform strings entered by the creator (e.g., `["#HighSensation", "#highsensation", "#glitch"]`). User-generated, case-inconsistent, not enumerated.
2. **Niche Enum (`FeedPost.category`)** — a strict TypeScript/Zod enum validated at the schema level: `"high-sensation" | "aesthetic" | "cinematic" | "glitch" | "slow-mo"`. Set programmatically at publish time.

Some posts were created before the `category` field existed (or were created without it by third-party tooling). The Niche pages must surface posts from both systems.

**Implementation (`app/niche/[category]/page.tsx`):**

Each `NicheCategory` carries a `tagAliases: string[]` array in `CATEGORY_META`:

```typescript
"high-sensation": {
  label: "High Sensation",
  accent: "#ec4899",
  tagAliases: ["#HighSensation", "#highsensation"],
},
"glitch": {
  label: "Glitch",
  accent: "#22c55e",
  tagAliases: ["#Glitch", "#glitch"],
},
```

The filter predicate uses a logical OR across both systems:

```typescript
const filtered = useMemo(() => {
  if (!valid) return [];
  const aliases = CATEGORY_META[rawCategory].tagAliases;
  return allPosts.filter(p =>
    p.category === rawCategory ||              // Enum match (new posts)
    aliases.some(tag => p.tags.includes(tag))  // Hashtag match (legacy posts)
  );
}, [allPosts, rawCategory, valid]);
```

**Result:** A post published with `#HighSensation` in its tags but no `category` field routes correctly to `/niche/high-sensation`. A post with `category: "high-sensation"` but no hashtags also routes correctly. Both systems are additive — the enum takes precedence for new posts, the hashtag bridge ensures backward compatibility.

**URL guard:** `isValidCategory(v: string)` validates the route param against `VALID_CATEGORIES` before any render logic runs. An invalid category renders a "not found" state rather than an empty list, preventing user confusion.

### 6.2 The Connection Limit Fix — Chrome's 6-Connection Ceiling

**Problem:** Chrome (and all HTTP/1.1 browsers) enforce a maximum of **6 concurrent TCP connections per origin**. The profile grid renders up to `2xl:grid-cols-7` — seven cards simultaneously visible. The previous implementation set `v.preload = "auto"` when a card entered the viewport, causing all 7 cards to begin buffering their full video files concurrently. With 7 requests competing for 6 connection slots, the 7th card's video is stalled until another request completes. This also blocks other critical resource loads (fonts, API calls, JS chunks) sharing the same origin.

**Solution: `preload="metadata"` + exit reset (implemented in `components/feed/video-preview-card.tsx`)**

The `VideoPreviewCard` uses a **shared `IntersectionObserver` pool** (`lib/utils/intersection-observer-pool.ts`) rather than creating a new observer per card. This reduces the number of active observers from N (one per card) to a small fixed set keyed by `rootMargin` configuration.

**On viewport entry:**
```typescript
v.preload = "metadata";
// + play() + start rAF loop
```
`preload="metadata"` instructs the browser to fetch only the first few kilobytes of the video file — enough to parse duration, dimensions, and the first keyframe hint. It does **not** buffer the full video. Across 7 visible cards, this means 7 small metadata requests (each < 50 KB) instead of 7 full video buffers competing for 6 connections.

**On viewport exit:**
```typescript
v.preload = "none";
// + pause() + stop rAF loop
```
Resetting to `"none"` signals the browser to abandon any in-progress buffer for off-screen cards. Without this reset, browsers may continue buffering after the card has scrolled out of view, holding a connection slot open unnecessarily.

**`fetchpriority="low"` attribute:**
```tsx
// @ts-expect-error — fetchpriority is a valid HTML attribute not yet in React types
fetchpriority="low"
```
Hints to the browser's resource scheduler that video content is lower-priority than page-critical resources. This does not change the connection limit but does influence scheduling order within the browser's fetch queue.

**Net effect:** The grid remains visually functional at 7 columns while consuming connection budget proportionally to what is actually needed for playback — not for speculative buffering of off-screen media.

### 6.3 The GlobalTicker — Single rAF Master Clock

**Problem:** A naive NLE implementation would create one `requestAnimationFrame` loop per consumer (Playhead, Scrubber, Audio Meters, Timeline). N active loops mean N GPU wake-ups per frame and N opportunities for timer drift between synchronized components.

**Solution (`lib/store/global-ticker.ts`):**

A single module-level rAF loop broadcasts a `DOMHighResTimeStamp` to all registered consumers. The loop uses lazy-start / eager-stop: it only runs while at least one callback is registered.

```typescript
// Consumer registration
const id = registerTickCallback((ts: DOMHighResTimeStamp) => {
  // update scrubber position, meter level, etc.
});
// Cleanup
unregisterTickCallback(id);
```

**Constitution rule:** No component or hook may create a logic-driven `requestAnimationFrame` call. The only permitted raw rAF usage is in `components/ui/confetti.tsx` (pure visual, no state) and within `global-ticker.ts` itself.

---

## 7. Security & Authorization Model

### 7.1 Remix Policy — `canRemix(post: FeedPost)`

The `canRemix` function in `lib/policy.ts` is the **sole authoritative gate** for determining whether a post can be loaded into the Studio for remixing. It evaluates `post.allowRemix` and remix-chain depth rules. No caller may pass a pre-computed boolean in place of the full `FeedPost` object — the policy function must receive the post and compute the answer itself. This is enforced in the `loadSnapshot` store action.

### 7.2 Batch Delete — Defense-in-Depth

The batch delete flow is protected at two independent layers:

**Render path:** The multi-select toolbar and checkbox props are gated inside `{tab === "published" && isOwnProfile && viewMode === "compact"}`. An unauthorized user viewing another creator's profile sees no selection controls.

**Action path (defense-in-depth):** `handleBatchDelete` begins with an unconditional authorization check:
```typescript
if (!isOwnProfile) {
  console.warn("[Profile] handleBatchDelete: unauthorized call on non-own profile — ignoring");
  return;
}
```
This guard executes even if the render-path check is bypassed (e.g., via DevTools `React` panel state injection). The `console.warn` provides a forensic signal in developer tooling if this path is triggered unexpectedly.

**Two-step confirmation:** The "Delete N" button sets `isBatchConfirming = true` without calling `removePosts`. The confirm strip then presents "Permanently delete N posts?" with explicit "Yes, delete" / "Cancel" options. `handleBatchDelete` also guards `if (!isBatchConfirming) return`, so `removePosts` is unreachable without explicit user confirmation regardless of call path.

---

## 8. Hardening Rules (The Synapse Constitution)

Four invariants are non-negotiable. Any PR that violates them is a hard fail.

### Rule 1 — Schema Strictness (Zero-Trust Ingress)
- No `z.unknown()` or `.passthrough()` in `lib/schema.ts` except the single `FxParamsLegacySchema` legacy_v1 adapter.
- `JsonValueSchema` (recursive, JSON-safe) replaces `z.unknown()` for complex nested values.
- Verification: `rg -n "\.passthrough\(\)" lib/schema.ts` must return exactly one match (line containing `legacy_v1`).

### Rule 2 — Authoritative Policy (Mutation Boundary)
- `loadSnapshot` in the project store is the sole gatekeeper for remix authorization.
- It must receive `post: FeedPost` and call `canRemix(post)`.
- Caller-supplied booleans (e.g., `remixAllowed: true`) are never trusted.
- Hard-fail: throw `Error` + display Toast on policy violation.

### Rule 3 — Persistence Durability (Async Barrier)
- Navigation (`router.push`) must be `await`ed via `flushProjectToIDB()`.
- No `router.push` in `finally` blocks.
- UI must show a "Saving…" overlay during the await; block navigation if the write fails.
- Listen to `visibilitychange` and `pagehide` for background flush triggers.

### Rule 4 — Ticker Unification (The Master Clock)
- No logic-driven `requestAnimationFrame` calls outside `global-ticker.ts`.
- All continuous clocks (Playback, Scrubber, Timeline, Audio Meters) use `registerTickCallback`.
- Whitelisted raw rAF: `components/ui/confetti.tsx` (pure CSS-in-JS animation, no state mutations).
- Verification: `rg -n "requestAnimationFrame\(" components` must return only `confetti.tsx` matches.

---

## 9. Roadmap & Identified Gaps

### 9.1 Dynamic Niche / Explore Page

**Current state:** `/niche/[category]` exists and correctly filters posts by enum + hashtag bridge. However, the landing page at `/niche` (the niche index) is a stub. There is no rendered grid of niche categories with post counts, trending thumbnails, or dynamic discovery surface.

**Required work:**
- Aggregate `FeedPost.category` counts at render time from the Zustand store.
- Render a card grid for each of the 5 `NicheCategory` values with live post counts and a sample thumbnail.
- Add a "Trending in [Niche]" derived sort using `lib/stats.ts` data.

### 9.2 Global Search

**Current state:** No search input exists anywhere in the application. Posts can only be discovered by browsing the feed, the profile page, or navigating to a known niche URL.

**Required work:**
- A `useSearchStore` or derived selector over `useFeedStore.userPosts` that filters by `title`, `tags`, `authorUsername`, and `description`.
- A search results page or command palette component (`Cmd+K`).
- Debounced input with relevance scoring (exact title match > partial title > tags > description).
- Future: extend to `SerializedProject` records from the project registry.

### 9.3 Supabase Cloud Sync

**Current state:** `supabase init` has been run; the client and schema migrations are authored. No application code calls Supabase. The cloud feature is behind an implicit feature gate (no API calls exist).

**Architecture when implemented:**
- Synced entity: `.SYNAPSE` JSON recipes only (≤ 5 MB cap enforced by schema). Media bytes stay local.
- Auth: Supabase Auth with magic link or OAuth (no password store).
- Conflict resolution: last-write-wins per `updatedAt` timestamp on `SerializedProject`. Merge conflicts for the same project across devices are not in scope for v1.
- RLS policy: each user may read/write only rows where `user_id = auth.uid()`.
- **Hard constraint (Zero Hosting rule):** The sync pipeline must never accept a `blob:` URL, an absolute file path, or a `data:` URI. The schema layer (`FeedPostSchema`, `SerializedProjectSchema`) must strip or reject these at ingest.

### 9.4 OPFS Worker Pipeline

**Current state:** The `workers/` directory is scaffolded. No Web Worker code is implemented.

**Required work:**
- `workers/opfs-proxy.worker.ts`: accept `FileSystemFileHandle`, decode frames via WebCodecs `VideoDecoder`, write proxy frames to OPFS via `createSyncAccessHandle()`.
- `lib/managers/opfs-manager.ts`: main-thread coordinator that posts messages to the worker and exposes a promise-based API to the project store.
- GC pass: cross-reference `getAllFeedPostIds()` with OPFS entries, delete orphaned proxy files.

### 9.5 WebGPU Rendering Pipeline

**Current state:** Architecture and shader design are specified in `docs/tech.md`. The WebGPU rendering surface is not yet wired to the Studio timeline.

**Required work:**
- `lib/engine/renderer.ts`: initialize `GPUDevice`, handle context loss with IDB-backed restore.
- Compute shaders must be broken into multi-pass loops where any single pass exceeds 2 ms, to avoid browser GPU watchdog termination.
- Audio remains master clock source (`AudioContext.currentTime`); the renderer polls the GlobalTicker for display timestamps but derives actual sync position from audio.

---

*This document reflects source state at commit `4089c6d`. For authoritative current behavior, cross-reference with `lib/schema.ts`, `lib/store/feed-store.ts`, `lib/store/user-store.ts`, and `components/feed/video-preview-card.tsx`.*
