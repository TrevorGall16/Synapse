# Tier 2 Alpha: Project Library & Media Bin
**Date:** 2026-03-29 | **Status:** Approved | **Scope:** Project Library (`/projects`), Media Bin UI, Proxy Registry

---

## 1. Scope

Two deliverables built in one implementation pass:

| Deliverable | Route / File | Purpose |
|---|---|---|
| **Project Library** | `app/projects/page.tsx` | Primary project management entry point: Draft/Published status, last-edited timestamps, filter tabs, guarded Open/New actions |
| **Media Bin** | `components/studio/media-bin.tsx` | Replaces `<MediaPool>` tab content; adds refCount, file size, proxy management (Generate / Clear) with stable E2E hooks |
| **Proxy Registry** | `lib/store/proxy-registry.ts` | IDB-backed per-item proxy metadata (`hasProxy`, `proxySizeBytes`, `proxyUpdatedAt`) |

---

## 2. Data Model Changes

### 2.1 `MediaPoolItem` — add `sizeBytes`

**File:** `lib/store/types.ts`

Add one optional field. Source file size is recorded at import time so the Media Bin can display it without re-reading the full ArrayBuffer from IDB.

```typescript
export interface MediaPoolItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  duration: number;
  sizeBytes?: number;       // ← NEW: set from file.size at import, persists with project
  previewUrl?: string;
  peakManifest?: number[];
}
```

`sizeBytes` is optional so all existing serialised projects remain valid without migration.

**Wire-up:** `components/studio/media-pool.tsx` sets `sizeBytes: file.size` when creating the `MediaPoolItem` before `addMediaItem()` / `saveMediaToDB()`.

### 2.2 `ProjectSummary` — add `projectStatus`

**File:** `lib/store/projects-registry.ts`

```typescript
export interface ProjectSummary {
  id: string;
  name: string;
  lastEdited: number;
  width: number;
  height: number;
  fps: number;
  projectStatus?: "draft" | "published";   // ← NEW: coerced to "draft" if absent
  parentProjectId?: string;
  authorUsername?: string;
}
```

**Wire-up:** `GlobalHydrator.tsx` calls `updateProject(id, { projectStatus })` alongside `name` and `lastEdited` whenever it saves a project. `app/gallery/page.tsx` should also write `projectStatus` on the summary when it already knows it from the full IDB record.

### 2.3 `ProxyMeta` — new type (proxy-registry)

Proxy metadata lives outside `MediaPoolItem` because it is **machine-local** (depends on what OPFS contains on this device) and must not pollute the portable `.SYNAPSE` recipe.

```typescript
export interface ProxyMeta {
  hasProxy: boolean;
  proxySizeBytes: number;        // bytes of the JPEG proxy file in OPFS
  proxyUpdatedAt: number | null; // epoch ms when proxy was last generated, null if absent
}
```

---

## 3. New File: `lib/store/proxy-registry.ts`

Single IDB store keyed by media item ID. All reads/writes use `idbSafeSet` for write safety.

### OPFS filename convention

```
{mediaId}_proxy.jpg
```

Deterministic, no mapping table needed — both `media-bin.tsx` and `proxy-registry.ts` derive the filename from the item ID.

### API surface

```typescript
// Key format — not exported; callers use the functions below
// idb key: "synapse-proxy-{id}"

/** Read proxy metadata for one item. Returns absent-state defaults if not found. */
export async function getProxyMeta(id: string): Promise<ProxyMeta>

/** Atomically persist proxy metadata after generate or clear. */
export async function setProxyMeta(id: string, meta: ProxyMeta): Promise<void>

/** Load proxy metadata for a batch of IDs in one pass. */
export async function batchGetProxyMeta(ids: string[]): Promise<Record<string, ProxyMeta>>

/** Remove proxy metadata record (called when the media item itself is removed). */
export async function deleteProxyMeta(id: string): Promise<void>
```

`getProxyMeta` returns `{ hasProxy: false, proxySizeBytes: 0, proxyUpdatedAt: null }` as the default when no record exists — callers never need to null-check.

---

## 4. New File: `app/projects/page.tsx` — Project Library

### 4.1 Purpose

The primary project management entry point. Replaces what `/gallery` currently provides, built as a dedicated route so `/gallery` can later become a social discovery feed.

**Sidebar:** Update `components/ui/sidebar.tsx` — change the `Gallery` nav item to `href: "/projects"` and label `"Projects"`.

### 4.2 Data loading

Uses `useProjectsRegistry()` (localStorage-backed, instant) for the list. Reads `projectStatus` from the summary (no full IDB load required).

Sort order: descending `lastEdited`.

### 4.3 Layout

```
┌─────────────────────────────────────────────────────┐
│ Projects                         [+ New Project]    │
│ ──────────────────────────────────────────────────  │
│ [All] [Drafts] [Published]                          │
├─────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐       │
│  │ thumbnail │  │ thumbnail │  │ thumbnail │       │
│  │           │  │           │  │           │       │
│  │  Name     │  │  Name     │  │  Name     │       │
│  │ 🟡 Draft  │  │ ✓ Published│  │ 🟡 Draft  │       │
│  │ 2 hrs ago │  │ 3 days ago│  │ just now  │       │
│  │[Rename][Open]│ [Rename][Open]│[Rename][Open]│   │
│  └───────────┘  └───────────┘  └───────────┘       │
└─────────────────────────────────────────────────────┘
```

**Status badge placement:** Option B (approved) — badge and last-edited timestamp share a row in the card body below the project name. Not overlaid on thumbnail.

- `Draft` badge: amber — `bg-amber-500/20 text-amber-400 border-amber-500/30`
- `Published` badge: green — `bg-green-500/20 text-green-400 border-green-500/30`

### 4.4 Filter chips

| Chip | Filter |
|---|---|
| All | all projects |
| Drafts | `projectStatus === "draft"` or status absent |
| Published | `projectStatus === "published"` |

### 4.5 Actions

| Action | Behaviour |
|---|---|
| **+ New Project** | `await ensureFlushedBeforeNav()` → `router.push("/studio")` |
| **Open** | `await ensureFlushedBeforeNav()` → load project into store → `router.push("/studio")` |
| **Rename** | Inline `<input>` → `updateProject(id, { name })` in registry |
| **Delete** | Confirmation step → `deleteProjectFromIDB(id)` → `removeProject(id)` from registry |

### 4.6 `data-testid` hooks

```
[data-testid="projects-page"]             — page root
[data-testid="project-card-{id}"]         — each card
[data-testid="project-open-btn-{id}"]     — Open button
[data-testid="project-filter-all"]        — filter chip
[data-testid="project-filter-drafts"]     — filter chip
[data-testid="project-filter-published"]  — filter chip
```

---

## 5. New File: `components/studio/media-bin.tsx` — Media Bin

### 5.1 Purpose

Replaces `<MediaPool>` as the content rendered under the "MEDIA POOL" tab in the studio left panel. Maintains import functionality; adds per-item management (size, refCount, proxy).

`components/studio/media-pool.tsx` is kept intact as the import orchestrator but its rendered JSX (`<MediaPool />`) is replaced in the studio tab by `<MediaBin />`. The two components are siblings: `MediaBin` owns display + actions, `MediaPool` owns file-import drag-and-drop (called from inside `MediaBin`'s header import button).

**Import approach:** `media-bin.tsx` subsumes the file-picker and drag-drop import logic directly — it calls `saveMediaToDB` and `addMediaItem` inline, matching the pattern already in `media-pool.tsx`. `media-pool.tsx` is not deleted (other code may reference it), but its rendered `<MediaPool />` JSX is replaced in the studio tab by `<MediaBin />`. No wrapper or delegation layer is introduced.

### 5.2 Layout — list view (Option A approved)

```
┌─────────────────────────────────────────────┐
│ MEDIA BIN              4 items · 284 MB [+ Import] │
├─────────────────────────────────────────────┤
│ [thumb] concert_main.mp4   128 MB  ×3  P 2.1MB │ [Clear Proxy] │
│ [thumb] b-roll_street.mp4   74 MB  ×1          │ [Gen Proxy]   │
│ [♪]    synth_loop_01.wav    4.2MB  ×2          │               │
│ [thumb] old_take_2.mp4      78 MB  ×0  unused  │ [Remove]      │
└─────────────────────────────────────────────┘
```

Column breakdown per row:
1. **Thumbnail** (44×28px) — `previewUrl` if available, else type icon. Video with proxy shows a small `P` badge (blue) in corner.
2. **Name** — truncated with ellipsis
3. **Size** — `sizeBytes` formatted (MB/KB); `—` if absent
4. **Usage** — refCount pill: `Used ×N` (purple if N > 0) or `Unused` (muted) — from `StoredMediaItem.refCount` via a dedicated hook
5. **Proxy size** — `proxy 2.1MB` (cyan) if `hasProxy`; hidden otherwise
6. **Action button** (right-aligned):
   - Video + no proxy → `Gen Proxy` (blue, `data-testid="generate-proxy-btn-{id}"`)
   - Video + has proxy → `Clear Proxy` (muted, `data-testid="clear-proxy-btn-{id}"`)
   - Audio/Image → no proxy button (proxy only makes sense for video)
   - refCount === 0 → `Remove` button (red, `data-testid="remove-media-btn-{id}"`)

Buttons are always rendered in the DOM (not toggled to `display:none`) so Playwright can query by testid without hover. `Remove` is shown alongside proxy buttons when refCount is 0.

### 5.3 `data-testid` hooks

```
[data-testid="media-bin"]                         — component root
[data-testid="media-asset-row-{id}"]              — each row
[data-testid="generate-proxy-btn-{id}"]           — generate proxy button
[data-testid="clear-proxy-btn-{id}"]              — clear proxy button
[data-testid="remove-media-btn-{id}"]             — remove (unused items only)
```

**Worker isolation tests** use `[data-testid^="generate-proxy-btn"]` (CSS starts-with) to locate the first available generate button. The `e2e/worker-isolation.spec.ts` selector is updated from `"generate-proxy-btn"` to `"[data-testid^=\"generate-proxy-btn\"]"`.

### 5.4 State — proxy metadata hook

```typescript
// lib/hooks/use-proxy-meta.ts
// Returns ProxyMeta map keyed by media ID, refreshes on demand.
export function useProxyMeta(ids: string[]): {
  proxyMap: Record<string, ProxyMeta>;
  refresh: () => Promise<void>;
}
```

Calls `batchGetProxyMeta(ids)` on mount and after every generate/clear action. Does NOT poll — only updates on explicit operations.

### 5.5 State — refCount display

`StoredMediaItem.refCount` lives in IDB. `media-bin.tsx` calls a lightweight helper:

```typescript
// lib/store/media-pool-db.ts (new export)
export async function getMediaRefCounts(ids: string[]): Promise<Record<string, number>>
```

This reads all media IDB records in one pass and returns only `{ [id]: refCount }`. Loaded once on mount; refreshed after Remove.

---

## 6. Generate Proxy Flow

**Trigger:** User clicks `[data-testid="generate-proxy-btn-{id}"]`

```
media-bin.tsx
  → setGenerating(id, true)           // optimistic loading state on row
  → getStoredMediaItem(id)            // reads StoredMediaItem from IDB (includes ArrayBuffer)
  → opfsDecodeProxy(data, 320, 180)   // sends to OPFS worker; emits decode_start/decode_done
  → opfsWriteFile(`${id}_proxy.jpg`, jpegBuf)  // emits write_start/write_done
  → setProxyMeta(id, {
      hasProxy: true,
      proxySizeBytes: jpegBuf.byteLength,
      proxyUpdatedAt: Date.now(),
    })                                // idbSafeSet — atomic IDB write
  → refresh()                        // re-reads proxyMap for this item
  → setGenerating(id, false)         // clear loading state
```

Error path: if `opfsDecodeProxy` or `opfsWriteFile` throws, catch and show a toast — `setProxyMeta` is NOT called, so no phantom proxy metadata is written.

---

## 7. Clear Proxy Integrity (Guardrail)

**Trigger:** User clicks `[data-testid="clear-proxy-btn-{id}"]`

**Invariants:**
- OPFS proxy file deleted — `opfsDeleteFile(`${id}_proxy.jpg`)`
- Proxy registry atomically zeroed — `setProxyMeta(id, { hasProxy: false, proxySizeBytes: 0, proxyUpdatedAt: null })`
- `StoredMediaItem.refCount` is **NOT modified**
- Source media blob in IDB is **NOT touched**
- No orphaned proxy metadata: `setProxyMeta` is called only after `opfsDeleteFile` resolves without throwing

```
media-bin.tsx
  → setClearing(id, true)
  → opfsDeleteFile(`${id}_proxy.jpg`)     // OPFS delete — may throw
  → setProxyMeta(id, {                    // only runs if delete succeeded
      hasProxy: false,
      proxySizeBytes: 0,
      proxyUpdatedAt: null,
    })
  → refresh()
  → setClearing(id, false)
```

**Error handling:** If `opfsDeleteFile` throws (file not found in OPFS, permission error, etc.), the error is caught, a toast is shown, and `setProxyMeta` is skipped. This prevents a state where OPFS says "no file" but metadata says `hasProxy: true`. If the OPFS file was already absent, `opfsDeleteFile` will throw a `NotFoundError` — catch that case specifically and treat it as a successful clear (the proxy wasn't there anyway), then zero the metadata.

---

## 8. Navigation Durability (Guardrail)

### 8.1 `/projects` page — Open action

Mirrors the existing `handleOpen` pattern in `app/gallery/page.tsx` exactly:

```typescript
// app/projects/page.tsx — handleOpen (mirrors gallery pattern)
const handleOpen = useCallback(async (project: ProjectSummary) => {
  await ensureFlushedBeforeNav();
  const store = useProjectStore.getState();
  if (project.id === store.projectId) { router.push("/studio"); return; }
  if (store.savedProjects[project.id]) { store.switchTab(project.id); router.push("/studio"); return; }
  loadProjectFromIDB(project.id).then((raw) => {
    if (raw) store.openProjectInTab(raw);
    router.push("/studio");
  });
}, [router]);
```

`ensureFlushedBeforeNav` must be awaited before any store mutation or navigation — never fire-and-forget.

### 8.2 `/projects` page — New Project

Mirrors `app/gallery/page.tsx handleNewProject` exactly:

```typescript
const handleNewProject = useCallback(async () => {
  await ensureFlushedBeforeNav();
  openNewTab();          // store.openNewTab — creates a fresh project tab
  router.push("/studio");
}, [openNewTab, router]);
```

### 8.3 In-studio project switching

Any future in-studio "Open Recent" or project-switch action must follow the same pattern. This is enforced by the rule: **no `router.push("/studio")` anywhere in the codebase without a preceding `await ensureFlushedBeforeNav()`** — checked during code review.

---

## 9. Playwright Test Activation

### 9.1 Worker isolation tests — remove `.skip()`

The two currently-skipped tests in `e2e/worker-isolation.spec.ts` use:

```typescript
const generateProxyBtn = page.locator('[data-testid="generate-proxy-btn"]').first();
```

This selector is updated to the CSS starts-with form:

```typescript
const generateProxyBtn = page.locator('[data-testid^="generate-proxy-btn-"]').first();
```

The `.skip()` guard is **removed**. The test flow becomes:

1. Navigate to `/studio`
2. If splash: click `[data-testid="studio-create-project"]` and import a test video (or the test can pre-seed IDB)
3. Verify `[data-testid^="generate-proxy-btn-"]` is visible
4. Click it
5. Assert `write_start` → `write_done` sequence via `assertWorkerSequence`
6. Assert `decode_start` → `decode_done` sequence

**Note on seeding:** Worker isolation tests require at least one video item in the media pool. The test navigates to `/studio` and imports a lightweight test fixture (a minimal valid H.264 stub) OR relies on IDB state from a prior test run. An explicit `beforeAll` import hook is preferred over relying on IDB state.

### 9.2 Stable selector contract

| Selector | Purpose |
|---|---|
| `[data-testid^="generate-proxy-btn-"]` | First video row without proxy |
| `[data-testid^="clear-proxy-btn-"]` | First video row with proxy |
| `[data-testid="media-bin"]` | Media Bin root |
| `[data-testid="dirty-state-indicator"]` | Always-mounted flush sentinel (unchanged) |
| `[data-testid="save-barrier-overlay"]` | Flush overlay (unchanged) |

---

## 10. File Manifest

### New files

| File | Purpose |
|---|---|
| `app/projects/page.tsx` | Project Library page |
| `components/studio/media-bin.tsx` | Media Bin component |
| `lib/store/proxy-registry.ts` | Proxy metadata IDB store |
| `lib/hooks/use-proxy-meta.ts` | React hook over proxy-registry |

### Modified files

| File | Change |
|---|---|
| `lib/store/types.ts` | Add `sizeBytes?: number` to `MediaPoolItem` |
| `lib/store/projects-registry.ts` | Add `projectStatus?: "draft" \| "published"` to `ProjectSummary` |
| `lib/store/media-pool-db.ts` | Add `getMediaRefCounts(ids)` export |
| `components/studio/media-pool.tsx` | Set `sizeBytes: file.size` in `addMediaItem` call |
| `components/GlobalHydrator.tsx` | Write `projectStatus` to registry on save |
| `components/ui/sidebar.tsx` | Update Gallery nav item → `/projects` label "Projects" |
| `e2e/worker-isolation.spec.ts` | Update selector to `[data-testid^="generate-proxy-btn-"]`; remove `.skip()` |

### Unchanged / not in scope

| File | Note |
|---|---|
| `workers/opfs-proxy.worker.ts` | Already has audit events; no changes needed |
| `lib/store/opfs-manager.ts` | Already has audit bridge; no changes needed |
| `lib/engine/export-pipeline.ts` | Not in scope for Tier 2 Alpha |
| `app/gallery/page.tsx` | Stays as-is; sidebar link update re-points users to `/projects` |

---

## 11. Constraints & Non-Goals

- **No `z.unknown()` / `.passthrough()`** in schema changes — `sizeBytes` addition does not touch `lib/schema.ts` because it is an optional UI field, not a validated engine input.
- **No rAF logic** introduced — proxy generation is async OPFS/IDB work, no animation loop needed.
- **No file upload to Supabase** — proxy JPEGs and source blobs remain local-only.
- **refCount not modified by Clear Proxy** — refCount belongs to the source blob lifecycle, not the proxy lifecycle.
- **`loadSnapshot` policy** — the Authoritative Policy invariant (calling `canRemix` inside `loadSnapshot`) is unchanged by this work. Project open from the library calls `loadSnapshot` with the full `FeedPost` only when opening a remix. For own-project opens, a simpler `useProjectStore.getState().loadFromIDB(record)` path is used that bypasses `canRemix`.
- **File size > 900 lines** — `media-bin.tsx` must stay under 900 lines. If proxy management logic grows, extract to `lib/hooks/use-proxy-ops.ts`.
