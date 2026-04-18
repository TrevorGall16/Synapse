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
