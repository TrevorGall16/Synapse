# Tier 2 Alpha: Project Library & Media Bin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Project Library page (`/projects`) and Media Bin component with proxy management, activating the two skipped worker-isolation E2E tests.

**Architecture:** Proxy metadata lives in a new machine-local IDB store (`proxy-registry.ts`) keyed by media ID, separate from the portable `.SYNAPSE` recipe. The Media Bin replaces `<MediaPool>` in the studio left panel with a list view that surfaces refCount, file size, and per-item OPFS proxy controls. The Project Library mirrors the Gallery's exact `handleOpen`/`handleNewProject` guard patterns.

**Tech Stack:** Next.js 15, React 19, Zustand 5, Tailwind 4, idb-keyval, Playwright 1.58, TypeScript 5.

---

## File Manifest

| Action | File | Purpose |
|---|---|---|
| Create | `lib/store/proxy-registry.ts` | IDB-backed proxy metadata store |
| Create | `lib/hooks/use-proxy-meta.ts` | React hook over proxy-registry |
| Create | `components/studio/media-bin.tsx` | Media Bin with proxy management |
| Create | `app/projects/page.tsx` | Project Library page |
| Create | `e2e/fixtures/test-proxy.mp4` | Test fixture for worker isolation tests |
| Modify | `lib/store/types.ts` | Add `sizeBytes?` to `MediaPoolItem` |
| Modify | `lib/store/projects-registry.ts` | Add `projectStatus?` to `ProjectSummary` |
| Modify | `lib/store/media-pool-db.ts` | Add `getMediaRefCounts` export |
| Modify | `components/studio/media-pool.tsx` | Set `sizeBytes: file.size` on import |
| Modify | `app/studio/page.tsx` | Swap `<MediaPool>` → `<MediaBin>`; rename tab |
| Modify | `components/GlobalHydrator.tsx` | Sync `projectStatus` to registry in doSave |
| Modify | `components/ui/sidebar.tsx` | Update Gallery nav item → `/projects` |
| Modify | `e2e/worker-isolation.spec.ts` | Update selector; remove `.skip()`; add beforeEach seeding |

---

## Task 1: Type model additions

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/projects-registry.ts`
- Modify: `lib/store/media-pool-db.ts`

- [ ] **Step 1: Add `sizeBytes?` to `MediaPoolItem` in `lib/store/types.ts`**

Find this block (lines 124–131 in the current file):
```typescript
export interface MediaPoolItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  duration: number;
  previewUrl?: string;
  peakManifest?: number[];
}
```
Replace with:
```typescript
export interface MediaPoolItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  duration: number;
  sizeBytes?: number;       // set from file.size at import; not in .SYNAPSE recipe validation
  previewUrl?: string;
  peakManifest?: number[];
}
```

- [ ] **Step 2: Add `projectStatus?` to `ProjectSummary` in `lib/store/projects-registry.ts`**

Find this block:
```typescript
export interface ProjectSummary {
  id: string;
  name: string;
  lastEdited: number; // ms epoch
  width: number;
  height: number;
  fps: number;
  parentProjectId?: string;  // set when forked from another project
  authorUsername?: string;   // username of the creator who published this
}
```
Replace with:
```typescript
export interface ProjectSummary {
  id: string;
  name: string;
  lastEdited: number; // ms epoch
  width: number;
  height: number;
  fps: number;
  projectStatus?: "draft" | "published";  // undefined = legacy, treat as "draft"
  parentProjectId?: string;  // set when forked from another project
  authorUsername?: string;   // username of the creator who published this
}
```

- [ ] **Step 3: Add `getMediaRefCounts` to `lib/store/media-pool-db.ts`**

Add this function at the end of the file (before the final blank line):
```typescript
/** Read refCounts for a batch of media IDs in one pass. Returns 0 for missing items. */
export async function getMediaRefCounts(ids: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  await Promise.all(
    ids.map(async (id) => {
      const stored = await get<StoredMediaItem>(itemKey(id));
      result[id] = stored?.refCount ?? 0;
    })
  );
  return result;
}
```

- [ ] **Step 4: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 errors (or only pre-existing errors unrelated to these files).

- [ ] **Step 5: Commit**

```bash
git add lib/store/types.ts lib/store/projects-registry.ts lib/store/media-pool-db.ts
git commit -m "feat(types): add sizeBytes to MediaPoolItem, projectStatus to ProjectSummary, getMediaRefCounts"
```

---

## Task 2: Proxy Registry

**Files:**
- Create: `lib/store/proxy-registry.ts`

- [ ] **Step 1: Create `lib/store/proxy-registry.ts`**

```typescript
// lib/store/proxy-registry.ts
// Machine-local IDB store for OPFS proxy metadata.
// Keys: "synapse-proxy-{mediaId}"
// Intentionally separate from .SYNAPSE recipe — proxy files are device-local.

import { get, del } from "idb-keyval";
import { idbSafeSet } from "./idb-safe-write";

export interface ProxyMeta {
  hasProxy: boolean;
  proxySizeBytes: number;        // bytes of the JPEG in OPFS
  proxyUpdatedAt: number | null; // epoch ms when proxy was last generated; null = absent
}

const ABSENT_META: ProxyMeta = { hasProxy: false, proxySizeBytes: 0, proxyUpdatedAt: null };
const KEY_PREFIX = "synapse-proxy-";

function proxyKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/** Read proxy metadata for one item. Returns absent-state defaults if no record found. */
export async function getProxyMeta(id: string): Promise<ProxyMeta> {
  const stored = await get<ProxyMeta>(proxyKey(id));
  return stored ?? { ...ABSENT_META };
}

/** Atomically persist proxy metadata after generate or clear. */
export async function setProxyMeta(id: string, meta: ProxyMeta): Promise<void> {
  await idbSafeSet(proxyKey(id), meta);
}

/** Load proxy metadata for a batch of IDs in one pass. */
export async function batchGetProxyMeta(ids: string[]): Promise<Record<string, ProxyMeta>> {
  const result: Record<string, ProxyMeta> = {};
  await Promise.all(
    ids.map(async (id) => {
      result[id] = await getProxyMeta(id);
    })
  );
  return result;
}

/** Remove proxy metadata record when the media item itself is removed. */
export async function deleteProxyMeta(id: string): Promise<void> {
  await del(proxyKey(id));
}
```

- [ ] **Step 2: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -30
```
Expected: 0 new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/store/proxy-registry.ts
git commit -m "feat(proxy-registry): add IDB-backed proxy metadata store"
```

---

## Task 3: useProxyMeta hook

**Files:**
- Create: `lib/hooks/use-proxy-meta.ts`

- [ ] **Step 1: Create `lib/hooks/use-proxy-meta.ts`**

```typescript
// lib/hooks/use-proxy-meta.ts
// React hook that reads ProxyMeta for a list of media IDs.
// Loads on mount; does NOT poll — call refresh() after generate/clear.

"use client";

import { useState, useCallback, useEffect } from "react";
import { batchGetProxyMeta, type ProxyMeta } from "@/lib/store/proxy-registry";

export function useProxyMeta(ids: string[]): {
  proxyMap: Record<string, ProxyMeta>;
  refresh: () => Promise<void>;
} {
  const [proxyMap, setProxyMap] = useState<Record<string, ProxyMeta>>({});

  // Stable string key — rebuild when IDs list changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const idsKey = ids.join(",");

  const refresh = useCallback(async () => {
    if (ids.length === 0) { setProxyMap({}); return; }
    const map = await batchGetProxyMeta(ids);
    setProxyMap(map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { proxyMap, refresh };
}
```

- [ ] **Step 2: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-proxy-meta.ts
git commit -m "feat(hooks): add useProxyMeta hook over proxy-registry"
```

---

## Task 4: Media Bin component

**Files:**
- Create: `components/studio/media-bin.tsx`

- [ ] **Step 1: Create `components/studio/media-bin.tsx`**

```typescript
// components/studio/media-bin.tsx
// Replaces <MediaPool> in the studio left panel.
// List view with inline proxy management (Generate / Clear) and Remove for unused items.

"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { saveMediaToDB, getStoredMediaItem, removeMediaFromDB, getMediaRefCounts } from "@/lib/store/media-pool-db";
import { opfsDecodeProxy, opfsWriteFile, opfsDeleteFile } from "@/lib/store/opfs-manager";
import { setProxyMeta, deleteProxyMeta } from "@/lib/store/proxy-registry";
import { useProxyMeta } from "@/lib/hooks/use-proxy-meta";
import type { MediaPoolItem } from "@/lib/store/types";

// ── Utilities ─────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function mediaTypeFromMime(mime: string): "video" | "audio" | "image" {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "video";
}

// ── MediaBin ──────────────────────────────────────────────
export function MediaBin() {
  const mediaPool    = useProjectStore((s) => s.mediaPool);
  const addMediaItem = useProjectStore((s) => s.addMediaItem);
  const setMediaPool = useProjectStore((s) => s.setMediaPool);

  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver]   = useState(false);
  const [generating, setGenerating]   = useState<Set<string>>(new Set());
  const [clearing, setClearing]       = useState<Set<string>>(new Set());
  const [refCounts, setRefCounts]     = useState<Record<string, number>>({});
  const [error, setError]             = useState<string | null>(null);

  const ids = mediaPool.map((m) => m.id);
  const { proxyMap, refresh: refreshProxy } = useProxyMeta(ids);

  // Load refCounts once on mount and after mediaPool changes
  useEffect(() => {
    if (ids.length === 0) { setRefCounts({}); return; }
    getMediaRefCounts(ids).then(setRefCounts).catch(console.warn);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  }, []);

  // ── Import ────────────────────────────────────────────
  const handleFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const type = mediaTypeFromMime(file.type);
      const previewUrl = URL.createObjectURL(file);

      if (type === "image") {
        const item: MediaPoolItem = {
          id: crypto.randomUUID(), name: file.name, type,
          duration: 5_000_000, sizeBytes: file.size, previewUrl,
        };
        addMediaItem(item);
        saveMediaToDB(file, item).catch(console.warn);
        continue;
      }

      const el = document.createElement(type === "audio" ? "audio" : "video");
      el.preload = "metadata";
      el.src = previewUrl;

      const finish = (durationSec: number) => {
        const duration = Math.round(durationSec * 1_000_000);
        const item: MediaPoolItem = {
          id: crypto.randomUUID(), name: file.name, type,
          duration, sizeBytes: file.size, previewUrl,
        };
        addMediaItem(item);
        saveMediaToDB(file, item).catch(console.warn);
      };

      el.onloadedmetadata = () => {
        if (el.duration === Infinity || Number.isNaN(el.duration)) {
          el.currentTime = 1e10;
          el.ontimeupdate = () => {
            el.ontimeupdate = null;
            el.currentTime = 0;
            finish(el.duration);
          };
        } else {
          finish(el.duration);
        }
      };
      el.onerror = () => {
        const item: MediaPoolItem = {
          id: crypto.randomUUID(), name: file.name, type,
          duration: 5_000_000, sizeBytes: file.size, previewUrl,
        };
        addMediaItem(item);
        saveMediaToDB(file, item).catch(console.warn);
      };
    }
  }, [addMediaItem]);

  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = "";
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const onDragLeave = useCallback(() => setIsDragOver(false), []);

  // ── Generate Proxy ────────────────────────────────────
  const handleGenerateProxy = useCallback(async (id: string) => {
    setGenerating((prev) => new Set(prev).add(id));
    try {
      const stored = await getStoredMediaItem(id);
      if (!stored) throw new Error("Media item not found in IDB");

      // Clone before transfer — stored.data is a structured-clone from IDB
      const cloned = stored.data.slice(0);
      const jpegBuf = await opfsDecodeProxy(cloned, 320, 180);
      const proxySizeBytes = jpegBuf.byteLength; // capture BEFORE opfsWriteFile transfers it
      await opfsWriteFile(`${id}_proxy.jpg`, jpegBuf);
      await setProxyMeta(id, {
        hasProxy: true,
        proxySizeBytes,
        proxyUpdatedAt: Date.now(),
      });
      await refreshProxy();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Proxy generation failed");
    } finally {
      setGenerating((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }, [refreshProxy, showError]);

  // ── Clear Proxy ───────────────────────────────────────
  const handleClearProxy = useCallback(async (id: string) => {
    setClearing((prev) => new Set(prev).add(id));
    try {
      try {
        await opfsDeleteFile(`${id}_proxy.jpg`);
      } catch (e) {
        // File not found in OPFS — treat as already absent; still zero the metadata.
        // OPFS throws a DOMException(NotFoundError) whose message contains "not found" or
        // "could not be found". The worker passes err.message through postMessage as a plain Error.
        const isNotFound = e instanceof Error && (
          e.message.toLowerCase().includes("not found") ||
          e.message.includes("NotFoundError")
        );
        if (!isNotFound) throw e;
      }
      await setProxyMeta(id, { hasProxy: false, proxySizeBytes: 0, proxyUpdatedAt: null });
      await refreshProxy();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Clear proxy failed");
    } finally {
      setClearing((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }, [refreshProxy, showError]);

  // ── Remove media item ─────────────────────────────────
  const handleRemove = useCallback(async (id: string) => {
    await removeMediaFromDB(id);
    await deleteProxyMeta(id);
    const { mediaPool: current } = useProjectStore.getState();
    setMediaPool(current.filter((m) => m.id !== id));
    setRefCounts((prev) => { const c = { ...prev }; delete c[id]; return c; });
  }, [setMediaPool]);

  // ── Totals ────────────────────────────────────────────
  const totalBytes = mediaPool.reduce((s, m) => s + (m.sizeBytes ?? 0), 0);

  return (
    <div
      data-testid="media-bin"
      className={`flex h-full flex-col border-t border-white/20 bg-[#1a1a1a] transition-colors ${
        isDragOver ? "bg-white/5" : ""
      }`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
          Media Bin
          {mediaPool.length > 0 && (
            <span className="ml-1.5 font-normal text-white/30">
              {mediaPool.length} item{mediaPool.length !== 1 ? "s" : ""}
              {totalBytes > 0 && ` · ${formatBytes(totalBytes)}`}
            </span>
          )}
        </span>
        <button
          onClick={() => inputRef.current?.click()}
          className="rounded px-2 py-0.5 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          + Import
        </button>
        <input
          ref={inputRef}
          data-testid="media-bin-file-input"
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
      </div>

      {/* Error toast */}
      {error && (
        <div className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[10px] text-red-400">
          {error}
        </div>
      )}

      {/* Item list */}
      {mediaPool.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-white/30">
            {isDragOver ? "Drop files to import" : "Drop files or click Import to begin"}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {mediaPool.map((item) => (
            <MediaAssetRow
              key={item.id}
              item={item}
              refCount={refCounts[item.id] ?? 0}
              proxyMeta={proxyMap[item.id] ?? { hasProxy: false, proxySizeBytes: 0, proxyUpdatedAt: null }}
              isGenerating={generating.has(item.id)}
              isClearing={clearing.has(item.id)}
              onGenerateProxy={() => handleGenerateProxy(item.id)}
              onClearProxy={() => handleClearProxy(item.id)}
              onRemove={() => handleRemove(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── MediaAssetRow ──────────────────────────────────────────
interface RowProps {
  item: MediaPoolItem;
  refCount: number;
  proxyMeta: { hasProxy: boolean; proxySizeBytes: number; proxyUpdatedAt: number | null };
  isGenerating: boolean;
  isClearing: boolean;
  onGenerateProxy: () => void;
  onClearProxy: () => void;
  onRemove: () => void;
}

function MediaAssetRow({
  item, refCount, proxyMeta, isGenerating, isClearing, onGenerateProxy, onClearProxy, onRemove,
}: RowProps) {
  const isVideo = item.type === "video";
  const isUnused = refCount === 0;

  return (
    <div
      data-testid={`media-asset-row-${item.id}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("mediaId", item.id)}
      className="flex cursor-grab items-center gap-2 border-b border-white/5 px-2 py-1.5 hover:bg-white/5 active:cursor-grabbing"
    >
      {/* Thumbnail */}
      <div className="relative shrink-0">
        <AssetThumb item={item} hasProxy={proxyMeta.hasProxy} />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-white/80">{item.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[9px]">
          {item.sizeBytes != null && (
            <span className="text-white/35">{formatBytes(item.sizeBytes)}</span>
          )}
          <span className={`rounded px-1 py-0.5 ${
            isUnused
              ? "bg-white/5 text-white/25"
              : "bg-purple-500/15 text-purple-400"
          }`}>
            {isUnused ? "unused" : `×${refCount}`}
          </span>
          {proxyMeta.hasProxy && (
            <span className="text-cyan-500/70">
              proxy {formatBytes(proxyMeta.proxySizeBytes)}
            </span>
          )}
        </div>
      </div>

      {/* Actions — always in DOM for stable Playwright queries */}
      <div className="flex shrink-0 items-center gap-1">
        {isVideo && !proxyMeta.hasProxy && (
          <button
            data-testid={`generate-proxy-btn-${item.id}`}
            onClick={onGenerateProxy}
            disabled={isGenerating}
            className="rounded px-1.5 py-0.5 text-[9px] font-medium text-blue-400 transition-colors hover:bg-blue-500/15 disabled:opacity-40"
          >
            {isGenerating ? "…" : "Gen Proxy"}
          </button>
        )}
        {isVideo && proxyMeta.hasProxy && (
          <button
            data-testid={`clear-proxy-btn-${item.id}`}
            onClick={onClearProxy}
            disabled={isClearing}
            className="rounded px-1.5 py-0.5 text-[9px] font-medium text-white/35 transition-colors hover:bg-white/10 hover:text-white/60 disabled:opacity-40"
          >
            {isClearing ? "…" : "Clear"}
          </button>
        )}
        {isUnused && (
          <button
            data-testid={`remove-media-btn-${item.id}`}
            onClick={onRemove}
            className="rounded px-1.5 py-0.5 text-[9px] font-medium text-red-400/60 transition-colors hover:bg-red-500/15 hover:text-red-400"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ── AssetThumb ─────────────────────────────────────────────
function AssetThumb({ item, hasProxy }: { item: MediaPoolItem; hasProxy: boolean }) {
  const base = "h-7 w-11 rounded bg-black object-cover";

  if (item.type === "video" && item.previewUrl) {
    return (
      <div className="relative">
        <video src={item.previewUrl} className={base} muted playsInline preload="metadata" />
        {hasProxy && (
          <span className="absolute right-0 top-0 rounded-bl rounded-tr bg-blue-600/80 px-0.5 text-[7px] font-bold text-white">
            P
          </span>
        )}
      </div>
    );
  }
  if (item.type === "image" && item.previewUrl) {
    return <img src={item.previewUrl} alt={item.name} className={base} />;
  }
  return (
    <div className={`${base} flex items-center justify-center`}>
      <span className="text-sm text-white/20">&#9835;</span>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -40
```
Expected: 0 new errors. If `setMediaPool` is not in `ProjectState`, check the store — it is exported as `setMediaPool: (items: MediaPoolItem[]) => void`.

- [ ] **Step 3: Commit**

```bash
git add components/studio/media-bin.tsx
git commit -m "feat(media-bin): add Media Bin component with inline proxy management"
```

---

## Task 5: Wire Media Bin into studio + sizeBytes on import

**Files:**
- Modify: `app/studio/page.tsx` (line 5, 171, 136)
- Modify: `components/studio/media-pool.tsx` (add `sizeBytes: file.size` in three places)

- [ ] **Step 1: Swap `<MediaPool>` import and usage in `app/studio/page.tsx`**

Change line 5 — replace the MediaPool import:
```typescript
import { MediaPool } from "@/components/studio/media-pool";
```
with:
```typescript
import { MediaBin } from "@/components/studio/media-bin";
```

Change the tab label at line 136 — replace:
```typescript
                  Media Pool
```
with:
```typescript
                  Media Bin
```

Change line 171 — replace:
```typescript
                {leftTab === "pool" && <MediaPool />}
```
with:
```typescript
                {leftTab === "pool" && <MediaBin />}
```

- [ ] **Step 2: Add `sizeBytes: file.size` in `components/studio/media-pool.tsx`**

`media-pool.tsx` is kept intact (referenced by older code), but we patch it so any imports via its path also record size. Find the three `MediaPoolItem` literals in `handleFiles` and add `sizeBytes: file.size` to each:

**Image branch** (find and replace):
```typescript
        const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration: 5_000_000, previewUrl };
```
→
```typescript
        const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration: 5_000_000, sizeBytes: file.size, previewUrl };
```

**finish() callback** (find and replace):
```typescript
      const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration, previewUrl };
```
→
```typescript
      const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration, sizeBytes: file.size, previewUrl };
```

**onerror fallback** (find and replace):
```typescript
        const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration: 5_000_000, previewUrl };
```
→
```typescript
        const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration: 5_000_000, sizeBytes: file.size, previewUrl };
```

- [ ] **Step 3: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add app/studio/page.tsx components/studio/media-pool.tsx
git commit -m "feat(studio): swap MediaPool → MediaBin; add sizeBytes to media import"
```

---

## Task 6: GlobalHydrator — sync projectStatus to registry

**Files:**
- Modify: `components/GlobalHydrator.tsx`

The `doSave` function already saves `projectStatus` to IDB. This task adds a matching registry update so the Project Library page can read `projectStatus` from the lightweight `useProjectsRegistry` without loading full IDB records.

- [ ] **Step 1: Add `useProjectsRegistry` import to `components/GlobalHydrator.tsx`**

Find the imports block. After:
```typescript
import type { SerializedProject } from "@/lib/store/types";
```
Add:
```typescript
import { useProjectsRegistry } from "@/lib/store/projects-registry";
```

- [ ] **Step 2: Add registry update inside `doSave`**

In `doSave`, find the `setDirty(false)` call near the end of the `try` block:
```typescript
        setDirty(false);
```
Add the registry sync **before** `setDirty(false)`:
```typescript
        // Sync projectStatus to the lightweight registry so /projects page
        // can filter without loading full IDB records.
        if (s.projectId) {
          const status = (s as unknown as { projectStatus?: "draft" | "published" }).projectStatus ?? "draft";
          useProjectsRegistry.getState().updateProject(s.projectId, { projectStatus: status });
        }
        setDirty(false);
```

- [ ] **Step 3: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add components/GlobalHydrator.tsx
git commit -m "feat(hydrator): sync projectStatus to projects registry on save"
```

---

## Task 7: Project Library page

**Files:**
- Create: `app/projects/page.tsx`

This page mirrors `app/gallery/page.tsx` exactly for navigation patterns (`handleOpen`, `handleNewProject`) and adds Draft/Published status badges with filter chips.

- [ ] **Step 1: Create `app/projects/page.tsx`**

```typescript
// app/projects/page.tsx
// Project Library — primary project management entry point.
// Mirrors app/gallery/page.tsx for navigation guard patterns.

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, FolderOpen, Layers, Trash2, Pencil, Check, X } from "lucide-react";
import { useProjectsRegistry, type ProjectSummary } from "@/lib/store/projects-registry";
import { useProjectStore } from "@/lib/store/project-store";
import { loadProjectFromIDB, deleteProjectFromIDB } from "@/lib/store/project-idb";
import { validateSerializedProject } from "@/lib/schema";
import type { SerializedProject } from "@/lib/store/types";
import { releaseSnapshotMedia } from "@/lib/store/media-pool-db";
import { runGcSweep } from "@/lib/store/gc-service";
import { ensureFlushedBeforeNav } from "@/lib/store/project-store";

function formatDate(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000)          return "just now";
  if (diff < 3_600_000)       return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)      return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000)     return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function projectAccent(id: string): string {
  const ACCENTS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#fb923c"];
  let h = 0;
  for (let i = 0; i < Math.min(id.length, 8); i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

type FilterTab = "all" | "drafts" | "published";

// ── Status Badge ──────────────────────────────────────────
function StatusBadge({ status }: { status?: "draft" | "published" }) {
  if (status === "published") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded border border-green-500/30 bg-green-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-green-400">
        ✓ Published
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
      ● Draft
    </span>
  );
}

// ── Project Card ──────────────────────────────────────────
interface CardProps {
  project: ProjectSummary;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  onRename: (name: string) => void;
}

function ProjectCard({ project, onOpen, onDelete, onRename }: CardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting]       = useState(false);
  const [renaming, setRenaming]           = useState(false);
  const [nameVal, setNameVal]             = useState(project.name);
  const accent = projectAccent(project.id);

  const submitRename = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== project.name) onRename(trimmed);
    setRenaming(false);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    await onDelete();
    setIsDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <article
      data-testid={`project-card-${project.id}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e1e] transition-all hover:border-white/20"
    >
      {/* Thumbnail */}
      <button
        onClick={onOpen}
        className="relative w-full overflow-hidden bg-[#0d0d0d]"
        style={{ aspectRatio: `${project.width}/${Math.round(project.width * (9 / 16))}` }}
        aria-label={`Open ${project.name}`}
      >
        <div className="absolute inset-0 flex items-end gap-[2px] px-3 pb-8 opacity-[0.12]" aria-hidden>
          {Array.from({ length: 28 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[2px]"
              style={{
                background: accent,
                height: `${20 + Math.sin(i * 0.8 + (project.id.charCodeAt(0) || 0)) * 32 + (i % 5) * 7}%`,
              }}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/75" />
        <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[8px] tabular-nums text-white/40 backdrop-blur-sm">
          {project.width}×{project.height}
        </span>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-white"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      </button>

      {/* Info panel */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") { setNameVal(project.name); setRenaming(false); }
              }}
              className="flex-1 rounded border border-purple-500/40 bg-white/6 px-2 py-1 text-xs font-semibold text-white outline-none"
            />
            <button onClick={submitRename} className="rounded p-1 text-green-400 hover:bg-green-500/15"><Check size={11} /></button>
            <button onClick={() => { setNameVal(project.name); setRenaming(false); }} className="rounded p-1 text-white/30 hover:bg-white/8"><X size={11} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <h3 className="flex-1 truncate text-[12px] font-semibold text-white">{project.name}</h3>
            <button
              onClick={() => { setNameVal(project.name); setRenaming(true); }}
              className="shrink-0 rounded p-1 text-white/20 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/8 hover:text-white/60"
              title="Rename"
            >
              <Pencil size={10} />
            </button>
          </div>
        )}

        {/* Status + last edited */}
        <div className="flex items-center gap-2">
          <StatusBadge status={project.projectStatus} />
          <span className="text-[9px] text-white/30">{formatDate(project.lastEdited)}</span>
        </div>

        {/* Actions */}
        <div className="mt-auto flex gap-1.5 pt-1">
          <button
            data-testid={`project-open-btn-${project.id}`}
            onClick={onOpen}
            className="flex-1 rounded-lg bg-white/8 py-1.5 text-[10px] font-semibold text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            Open
          </button>

          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded-lg bg-red-500/25 px-2.5 py-1.5 text-[10px] font-bold text-red-400 transition-colors hover:bg-red-500/35 disabled:opacity-50"
              >
                {isDeleting ? "…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] text-white/35 hover:text-white/65"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg border border-white/8 px-2.5 py-1.5 text-[10px] text-white/25 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Page ──────────────────────────────────────────────────
export default function ProjectsPage() {
  const router   = useRouter();
  const { projects, removeProject, updateProject } = useProjectsRegistry();
  const openNewTab = useProjectStore((s) => s.openNewTab);
  const [filter, setFilter] = useState<FilterTab>("all");

  const handleNewProject = useCallback(async () => {
    await ensureFlushedBeforeNav();
    openNewTab();
    router.push("/studio");
  }, [openNewTab, router]);

  // Mirrors app/gallery/page.tsx handleOpen exactly
  const handleOpen = useCallback(async (project: ProjectSummary) => {
    await ensureFlushedBeforeNav();
    const store = useProjectStore.getState();

    if (project.id === store.projectId) { router.push("/studio"); return; }

    if (store.savedProjects[project.id]) {
      store.switchTab(project.id);
      router.push("/studio");
      return;
    }

    loadProjectFromIDB(project.id)
      .then((raw) => {
        if (raw) {
          const rec = validateSerializedProject(raw, `projects open ${project.id}`) as unknown as SerializedProject | null;
          if (rec) {
            useProjectStore.getState().openProjectInTab({
              projectId: rec.projectId,
              tracks: rec.tracks,
              duration: rec.duration,
              projectSettings: rec.projectSettings,
              mediaPool: rec.mediaPool,
              name: rec.name,
              parentProjectId: rec.parentProjectId,
              remixedFromHandle: rec.remixedFromHandle,
              rootParentId: rec.rootParentId,
              rootParentHandle: rec.rootParentHandle,
            });
          }
        }
        router.push("/studio");
      })
      .catch(() => router.push("/studio"));
  }, [router]);

  const handleDelete = useCallback(async (project: ProjectSummary) => {
    if (!project.id) return;
    useProjectStore.getState().removeProject(project.id);
    const rec = await loadProjectFromIDB(project.id).catch(() => null);
    if (rec?.mediaPool?.length) await releaseSnapshotMedia(rec.mediaPool).catch(console.warn);
    await deleteProjectFromIDB(project.id).catch(console.warn);
    removeProject(project.id);
    setTimeout(() => runGcSweep().catch(console.warn), 1500);
  }, [removeProject]);

  const handleRename = useCallback((project: ProjectSummary, newName: string) => {
    updateProject(project.id, { name: newName, lastEdited: Date.now() });
    if (useProjectStore.getState().projectId === project.id) {
      useProjectStore.getState().setName(newName);
    }
  }, [updateProject]);

  const sorted = [...projects].sort((a, b) => b.lastEdited - a.lastEdited);

  const filtered = sorted.filter((p) => {
    if (filter === "drafts")    return (p.projectStatus ?? "draft") === "draft";
    if (filter === "published") return p.projectStatus === "published";
    return true;
  });

  return (
    <div data-testid="projects-page" className="flex h-full flex-col overflow-y-auto bg-[#141414]">
      {/* Header */}
      <div className="z-10 shrink-0 flex items-center justify-between border-b border-white/10 bg-[#141414]/95 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-white/35" />
          <h1 className="text-sm font-bold text-white">Projects</h1>
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/35">
            {projects.length} Project{projects.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={handleNewProject}
          className="flex items-center gap-1.5 rounded-lg bg-purple-500/20 px-3 py-1.5 text-[11px] font-bold text-purple-300 transition-colors hover:bg-purple-500/30"
        >
          <Plus size={12} />New Project
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex shrink-0 gap-1 border-b border-white/8 px-5 py-2">
        {(["all", "drafts", "published"] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            data-testid={`project-filter-${tab}`}
            onClick={() => setFilter(tab)}
            className={`rounded-full px-3 py-1 text-[10px] font-semibold capitalize transition-colors ${
              filter === tab
                ? "bg-white/12 text-white"
                : "text-white/40 hover:bg-white/6 hover:text-white/70"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 px-5 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-dashed border-white/8 py-28">
            <FolderOpen size={36} className="text-white/15" />
            <div className="text-center">
              <p className="text-sm font-semibold text-white/35">
                {projects.length === 0 ? "No projects yet" : "No projects match this filter"}
              </p>
              {projects.length === 0 && (
                <p className="mt-1 text-xs text-white/20">Start editing in Studio — your projects will appear here.</p>
              )}
            </div>
            {projects.length === 0 && (
              <button
                onClick={handleNewProject}
                className="flex items-center gap-2 rounded-lg bg-purple-500/20 px-4 py-2 text-xs font-bold text-purple-300 transition-colors hover:bg-purple-500/30"
              >
                <Plus size={13} />Create First Project
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => handleOpen(project)}
                onDelete={() => handleDelete(project)}
                onRename={(name) => handleRename(project, name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Suppress unused import warning
type _SerializedProjectCompat = SerializedProject;
```

- [ ] **Step 2: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add app/projects/page.tsx
git commit -m "feat(projects): add Project Library page with Draft/Published filter"
```

---

## Task 8: Sidebar — Gallery → Projects

**Files:**
- Modify: `components/ui/sidebar.tsx`

- [ ] **Step 1: Update the Gallery nav item in `components/ui/sidebar.tsx`**

Find and replace this line in `NAV_ITEMS`:
```typescript
  { href: "/gallery", label: "Gallery", icon: "⬛" },
```
with:
```typescript
  { href: "/projects", label: "Projects", icon: "⬛" },
```

Also update the `handleNav("/gallery")` logo click at line 29:
```typescript
        onClick={() => handleNav("/gallery")}
```
→
```typescript
        onClick={() => handleNav("/projects")}
```

- [ ] **Step 2: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add components/ui/sidebar.tsx
git commit -m "feat(nav): redirect Gallery nav to /projects"
```

---

## Task 9: Worker isolation test activation

**Files:**
- Create: `e2e/fixtures/test-proxy.mp4` (any valid H.264 MP4, e.g. 1 second 320×180)
- Modify: `e2e/worker-isolation.spec.ts`

- [ ] **Step 1: Create the test video fixture**

Run this command to generate a 1-second H.264 test fixture using ffmpeg. If ffmpeg is not installed, place any valid `.mp4` file at `e2e/fixtures/test-proxy.mp4` manually.

```bash
ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x180:rate=1 -vcodec libx264 -pix_fmt yuv420p -t 1 D:/Projects/Synapse/e2e/fixtures/test-proxy.mp4
```

Verify the file was created:
```bash
ls -la D:/Projects/Synapse/e2e/fixtures/test-proxy.mp4
```
Expected: file exists and size > 0 bytes.

- [ ] **Step 2: Rewrite `e2e/worker-isolation.spec.ts`**

Replace the entire file content with:
```typescript
// e2e/worker-isolation.spec.ts
// Proof that OPFS operations run in the worker — [WORKER_EVENT] sequence gates.
// Requires at least one video item in the Media Bin (seeded via beforeEach).

import path from "path";
import { test, expect } from "./fixtures/audit-page";

const FIXTURE_VIDEO = path.resolve(__dirname, "fixtures/test-proxy.mp4");

test.describe("Worker Isolation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/studio");
    await page.waitForSelector('[data-testid="dirty-state-indicator"]', {
      state: "attached",
      timeout: 15_000,
    });

    // Create project if splash is showing
    const createBtn = page.locator('[data-testid="studio-create-project"]');
    if (await createBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await createBtn.click();
    }

    // Dismiss any blocking modal (e.g. ProjectSettingsModal auto-opened by IDB hydration)
    const closeBtn = page.locator('button[aria-label="Close"]').first();
    if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // Switch to the Media Bin tab
    await page.waitForSelector('[data-testid="media-bin"]', { state: "attached", timeout: 10_000 });

    // Import test fixture via the hidden file input in MediaBin
    await page.setInputFiles('[data-testid="media-bin-file-input"]', FIXTURE_VIDEO);

    // Wait for the generate proxy button to appear for the imported video
    await page.waitForSelector('[data-testid^="generate-proxy-btn-"]', {
      state: "visible",
      timeout: 10_000,
    });

    // Brief wait for saveMediaToDB (fire-and-forget IDB write) to complete before
    // any test clicks "Gen Proxy", which reads from IDB via getStoredMediaItem.
    await page.waitForTimeout(500);
  });

  test("OPFS write operations emit ordered worker events", async ({ page, auditPage }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    const generateProxyBtn = page.locator('[data-testid^="generate-proxy-btn-"]').first();
    await generateProxyBtn.click();

    const writeStart = await auditPage.waitForWorkerEvent("write_start", { timeoutMs: 15_000 });
    await auditPage.assertWorkerSequence(writeStart.id, "write_start", "write_done");
  });

  test("OPFS decode operations emit ordered worker events with monotonic timestamps", async ({
    page,
    auditPage,
  }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    const generateProxyBtn = page.locator('[data-testid^="generate-proxy-btn-"]').first();
    await generateProxyBtn.click();

    const decodeStart = await auditPage.waitForWorkerEvent("decode_start", {
      timeoutMs: 15_000,
    });
    await auditPage.assertWorkerSequence(decodeStart.id, "decode_start", "decode_done");
  });

  test("all worker events have monotonically increasing timestamps", async ({
    page,
    auditPage,
  }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Trigger worker activity
    const generateProxyBtn = page.locator('[data-testid^="generate-proxy-btn-"]').first();
    await generateProxyBtn.click();
    await page.waitForTimeout(3_000);

    const events = await page.evaluate(
      ({ startTs }: { startTs: number }) =>
        (window.__synapseAudit?.workerEvents ?? [])
          .filter((e) => e.ts >= startTs)
          .sort((a, b) => a.ts - b.ts),
      { startTs: await page.evaluate(() => window.__auditStartTs ?? 0) },
    );

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.ts).toBeGreaterThan(0);
    }
    for (let i = 1; i < events.length; i++) {
      expect(events[i].ts).toBeGreaterThanOrEqual(events[i - 1].ts);
    }
  });
});
```

- [ ] **Step 3: Verify fixture path constant is correct**

```bash
ls D:/Projects/Synapse/e2e/fixtures/
```
Expected: `audit-page.ts` and `test-proxy.mp4` are present.

- [ ] **Step 4: Type-check**

```bash
cd D:/Projects/Synapse && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/test-proxy.mp4 e2e/worker-isolation.spec.ts
git commit -m "test(worker-isolation): activate skipped tests; seed fixture video via beforeEach"
```

---

## Task 10: Run the full audit suite

- [ ] **Step 1: Start the dev server (if not already running)**

```bash
cd D:/Projects/Synapse && npm run dev &
```

Wait ~10 seconds for it to be ready, then:

- [ ] **Step 2: Run the audit**

```bash
cd D:/Projects/Synapse && npm run audit 2>&1
```

Expected output summary:
```
  8 passed (0 failed, 0 skipped)
```

The two previously-skipped worker isolation tests should now pass. If any test fails, read the failure message and trace back to the relevant task.

- [ ] **Step 3: Run unit tests**

```bash
cd D:/Projects/Synapse && npm run test-auth-policy 2>&1
```
Expected: `6 passed`.
