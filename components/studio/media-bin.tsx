// components/studio/media-bin.tsx
// Replaces <MediaPool> in the studio left panel.
// List view with inline proxy management (Generate / Clear) and Remove for unused items.

"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Trash2, X, Zap } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { saveMediaToDB, getStoredMediaItem, removeMediaFromDB, getMediaRefCounts } from "@/lib/store/media-pool-db";
import { opfsWriteFile, opfsDeleteFile } from "@/lib/store/opfs-manager";
import { setProxyMeta, deleteProxyMeta } from "@/lib/store/proxy-registry";
import { useProxyMeta } from "@/lib/hooks/use-proxy-meta";
import { extractProxyFrameFromBuffer } from "@/lib/utils/thumbnail-extractor";
import type { MediaPoolItem } from "@/lib/store/types";

/** localStorage flag — once true we stop showing the "Stunt Doubles" modal. */
const PROXY_INTRO_SEEN_KEY = "synapse.proxy-intro.seen";

/**
 * Hard upload size cap. Any single file above this triggers an error toast and
 * is dropped from the import — without this, importing a multi-GB camera dump
 * blows the browser tab's memory budget and crashes the editor before the user
 * even gets to the timeline.
 */
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * A proxy this small is almost certainly a failed/corrupted JPEG (header-only,
 * no image data). Treat as a generation failure rather than letting the editor
 * silently use a 8 KB stub that breaks downstream thumbnail consumers.
 */
const MIN_VALID_PROXY_BYTES = 100 * 1024; // 100 KB

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
  // Pending proxy intent — when set, the explainer modal is open and the
  // requested generation runs the moment the user dismisses it. Storing the id
  // (instead of generating immediately) means the intro is a true acknowledge
  // step, not a confusing "started before I read the modal" race.
  const [proxyIntro, setProxyIntro]   = useState<string | null>(null);

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
    // 6s lifetime: long enough for users to actually read the message before
    // it autodismisses. The 4s default was too short — testers reported the
    // toast disappearing before they realised what had been blocked.
    setTimeout(() => setError(null), 6000);
    // Surface to devtools too so QA can see hits in headless runs.
    console.warn("[MediaBin] " + msg);
  }, []);

  // ── Import ────────────────────────────────────────────
  const handleFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      // Hard-cap: reject files above MAX_UPLOAD_BYTES BEFORE creating an object
      // URL (which would already pin the file in memory). Surfacing a single
      // user-facing error is much friendlier than an OOM tab crash.
      if (file.size > MAX_UPLOAD_BYTES) {
        showError(`"${file.name}" is ${formatBytes(file.size)} — over the ${formatBytes(MAX_UPLOAD_BYTES)} per-file limit. Trim or compress before importing.`);
        continue;
      }
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
  // Pipeline: read raw bytes from IDB → reconstruct a Blob → spin up an
  // offscreen <video> → seek to 0.1s and AWAIT the `seeked` event → draw the
  // first decoded frame onto a canvas → encode JPEG → persist to OPFS.
  //
  // The previous path piped raw container bytes into a Worker `VideoDecoder`
  // configured for raw H.264 NAL units. MP4 sources (the common case) failed
  // to demux there and the worker fell through to its blank-canvas fallback,
  // producing a 1.18 KB grey JPEG that registered as a valid proxy. Doing the
  // decode on the main thread via a real <video> element side-steps demuxing
  // entirely — the browser handles it — and the seeked-event gate guarantees
  // the canvas has actual pixel data when toBlob runs.
  const runGenerateProxy = useCallback(async (id: string) => {
    setGenerating((prev) => new Set(prev).add(id));
    try {
      const stored = await getStoredMediaItem(id);
      if (!stored) throw new Error("Media item not found in IDB");

      // Clone the buffer because `stored.data` is owned by the structured-
      // clone IDB returned and may have been transferred elsewhere later.
      const cloned = stored.data.slice(0);

      const jpegBuf = await extractProxyFrameFromBuffer(
        cloned,
        stored.mimeType,
        320,
        180,
      );
      if (!jpegBuf) {
        showError("Proxy generation failed: the browser couldn't decode the first frame.");
        return;
      }
      const proxySizeBytes = jpegBuf.byteLength; // capture BEFORE opfsWriteFile transfers it

      // Reject suspiciously-small proxies. The new extractor returns null
      // rather than a blank JPEG, but we keep the floor as a defence-in-depth
      // check — protects against future changes that might re-introduce a
      // tiny placeholder path.
      if (proxySizeBytes < MIN_VALID_PROXY_BYTES) {
        await setProxyMeta(id, { hasProxy: false, proxySizeBytes: 0, proxyUpdatedAt: null });
        await refreshProxy();
        showError(`Proxy generation produced only ${formatBytes(proxySizeBytes)} — using original source instead.`);
        return;
      }

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

  // The button click handler. Shows the explainer modal once per browser, then
  // runs the actual generation. Subsequent clicks skip the modal.
  const handleGenerateProxy = useCallback((id: string) => {
    let seen = false;
    try { seen = localStorage.getItem(PROXY_INTRO_SEEN_KEY) === "true"; } catch { /* private mode */ }
    if (!seen) {
      setProxyIntro(id);
      return;
    }
    void runGenerateProxy(id);
  }, [runGenerateProxy]);

  const acknowledgeProxyIntro = useCallback(() => {
    const id = proxyIntro;
    setProxyIntro(null);
    try { localStorage.setItem(PROXY_INTRO_SEEN_KEY, "true"); } catch { /* private mode */ }
    if (id) void runGenerateProxy(id);
  }, [proxyIntro, runGenerateProxy]);

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

      {/* Error toast — kept inline so it shifts with the bin scrollbar instead
          of overlaying timeline content. Higher-contrast styling than before
          so the 500MB rejection is unmissable. */}
      {error && (
        <div
          role="alert"
          data-testid="media-bin-error"
          className="shrink-0 border-b border-red-500/40 bg-red-500/15 px-3 py-2 text-[11px] font-medium leading-snug text-red-300"
        >
          {error}
        </div>
      )}

      {/* First-run proxy explainer — appears the first time the user hits Gen
          Proxy. Acknowledging it actually starts the generation, so the user
          can't fire-and-forget without reading what proxies are. */}
      {proxyIntro && (
        <ProxyIntroModal
          onConfirm={acknowledgeProxyIntro}
          onCancel={() => setProxyIntro(null)}
        />
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
            <span className="text-white/35" title="Original source file size">
              {formatBytes(item.sizeBytes)}
            </span>
          )}
          <span className={`rounded px-1 py-0.5 ${
            isUnused
              ? "bg-white/5 text-white/25"
              : "bg-purple-500/15 text-purple-400"
          }`}>
            {isUnused ? "unused" : `×${refCount}`}
          </span>
          {proxyMeta.hasProxy && (
            <span
              className="text-cyan-500/70"
              title={
                item.sizeBytes
                  ? `Proxy ${formatBytes(proxyMeta.proxySizeBytes)} vs original ${formatBytes(item.sizeBytes)} — ${Math.round((1 - proxyMeta.proxySizeBytes / item.sizeBytes) * 100)}% smaller for editing.`
                  : `Proxy ${formatBytes(proxyMeta.proxySizeBytes)}`
              }
            >
              proxy {formatBytes(proxyMeta.proxySizeBytes)}
              {item.sizeBytes && proxyMeta.proxySizeBytes < item.sizeBytes && (
                <span className="ml-0.5 text-cyan-400/50">
                  (−{Math.round((1 - proxyMeta.proxySizeBytes / item.sizeBytes) * 100)}%)
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Actions — always in DOM for stable Playwright queries */}
      <div className="flex shrink-0 items-center gap-1">
        {isVideo && !proxyMeta.hasProxy && (
          <div className="flex items-center gap-0.5">
            <button
              data-testid={`generate-proxy-btn-${item.id}`}
              onClick={onGenerateProxy}
              disabled={isGenerating}
              className="rounded px-1.5 py-0.5 text-[9px] font-medium text-blue-400 transition-colors hover:bg-blue-500/15 disabled:opacity-40"
            >
              {isGenerating ? "…" : "Gen Proxy"}
            </button>
            <span
              role="img"
              tabIndex={0}
              aria-label="What does Gen Proxy do?"
              title="Generates a low-res version of the video to make timeline editing fast and smooth. Your final export will still use the high-quality original."
              className="cursor-help select-none rounded px-0.5 text-[10px] leading-none text-white/30 hover:text-white/60 focus-visible:text-white/60 focus-visible:outline-none"
            >
              (?)
            </span>
          </div>
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
        <button
          data-testid={`remove-media-btn-${item.id}`}
          onClick={() => {
            // Confirm deletion of in-use media so the user doesn't orphan timeline
            // clips by accident. Unused items delete immediately — no friction.
            if (refCount > 0) {
              const ok = window.confirm(
                `"${item.name}" is used by ${refCount} clip${refCount === 1 ? "" : "s"} on the timeline. Delete anyway?`,
              );
              if (!ok) return;
            }
            onRemove();
          }}
          aria-label={`Delete ${item.name}`}
          title={isUnused ? "Delete from media bin" : `Delete (in use by ${refCount} clip${refCount === 1 ? "" : "s"})`}
          className="rounded p-1 text-red-400/60 transition-colors hover:bg-red-500/15 hover:text-red-400"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

// ── ProxyIntroModal ────────────────────────────────────────
// Shown the FIRST time the user clicks "Gen Proxy" in this browser. Explains
// what proxies are — low-res stunt doubles for fast scrubbing — and reassures
// them the export still uses the original. Stored in localStorage so the
// modal never appears again after acknowledgement.
function ProxyIntroModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div
      data-testid="proxy-intro-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/70"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="relative w-full max-w-sm rounded-lg border border-white/10 bg-[#1e1e1e] p-5 shadow-2xl">
        <button
          onClick={onCancel}
          className="absolute right-3 top-3 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X size={14} />
        </button>

        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
            <Zap size={15} />
          </div>
          <h2 className="text-sm font-semibold text-white">About Proxies</h2>
        </div>

        <p className="mb-2 text-xs leading-relaxed text-white/70">
          Proxies are low-res <strong className="font-semibold text-white">&ldquo;stunt doubles&rdquo;</strong> of
          your videos. The Studio uses them on the timeline so scrubbing,
          trimming, and effects stay fast — even on long clips.
        </p>
        <p className="mb-4 text-xs leading-relaxed text-white/55">
          <strong className="font-semibold text-white/80">Don&apos;t worry:</strong> your final
          export will automatically use the high-quality original file. The
          proxy is only used for editing.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded bg-white/5 py-1.5 text-xs text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded bg-blue-500/80 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
          >
            Generate Proxy
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AssetThumb ─────────────────────────────────────────────
function AssetThumb({ item, hasProxy }: { item: MediaPoolItem; hasProxy: boolean }) {
  const base = "h-7 w-11 rounded bg-[#0a0a0a] object-cover";

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
