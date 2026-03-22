"use client";

import { useEffect, useRef } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { saveMediaToDB, loadMediaFromDB, removeMediaFromDB } from "@/lib/store/media-pool-db";
import type { MediaPoolItem } from "@/lib/store/types";
import { Upload, Film, Music, Image, Trash2 } from "lucide-react";

const TYPE_ICONS = { video: Film, audio: Music, image: Image } as const;

function formatDuration(micros: number): string {
  const s = micros / 1_000_000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function MediaCard({ item, onDelete }: { item: MediaPoolItem; onDelete: (id: string) => void }) {
  const Icon = TYPE_ICONS[item.type];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-[#1e1e1e] p-3 transition-colors hover:border-white/20">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded bg-black/40">
        {item.previewUrl && item.type === "video" ? (
          <video src={item.previewUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        ) : item.previewUrl && item.type === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <Icon size={24} className="text-white/20" />
        )}
        <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium uppercase text-white/60">
          {item.type}
        </span>
      </div>
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-white">{item.name}</p>
          {item.duration > 0 && <p className="text-[10px] text-white/40">{formatDuration(item.duration)}</p>}
        </div>
        <button
          onClick={() => onDelete(item.id)}
          aria-label="Remove"
          className="shrink-0 rounded p-1 text-white/20 transition-colors hover:bg-red-500/20 hover:text-red-400"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const addMediaItem = useProjectStore((s) => s.addMediaItem);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Restore persisted media from IndexedDB on mount
  useEffect(() => {
    loadMediaFromDB().then((items) => {
      const existingIds = new Set(useProjectStore.getState().mediaPool.map((m) => m.id));
      for (const item of items) {
        if (!existingIds.has(item.id)) addMediaItem(item);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      const type: MediaPoolItem["type"] = file.type.startsWith("video/")
        ? "video" : file.type.startsWith("audio/") ? "audio" : "image";

      const finalize = (duration: number) => {
        const item: MediaPoolItem = { id, name: file.name, type, duration, previewUrl };
        addMediaItem(item);
        saveMediaToDB(file, item).catch(console.error);
      };

      if (type === "video" || type === "audio") {
        const probe = document.createElement(type === "video" ? "video" : "audio");
        probe.src = previewUrl;
        probe.onloadedmetadata = () => { finalize(Math.round(probe.duration * 1_000_000)); probe.src = ""; };
        probe.onerror = () => finalize(0);
      } else {
        finalize(0);
      }
    });
  };

  const handleDelete = (id: string) => {
    // Remove from store by overwriting the mediaPool without this item
    // (addMediaItem doesn't have a remove counterpart yet — use store directly)
    const store = useProjectStore.getState();
    const next = store.mediaPool.filter((m) => m.id !== id);
    useProjectStore.setState({ mediaPool: next });
    removeMediaFromDB(id).catch(console.error);
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); handleUpload(e.dataTransfer.files); };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#141414] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Global Media Library</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {mediaPool.length} item{mediaPool.length !== 1 ? "s" : ""} · drag files into the studio timeline
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 rounded bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          <Upload size={14} />
          Upload Media
        </button>
        <input ref={fileInputRef} type="file" multiple accept="video/*,audio/*,image/*" className="hidden"
          onChange={(e) => handleUpload(e.target.files)} />
      </div>

      {mediaPool.length === 0 ? (
        <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}
          className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-white/10 py-20 transition-colors hover:border-white/20"
          onClick={() => fileInputRef.current?.click()}>
          <Upload size={40} className="text-white/20" />
          <div className="text-center">
            <p className="text-sm font-medium text-white/40">Drop files here or click to upload</p>
            <p className="mt-1 text-xs text-white/25">Video, audio, and image files · persisted across refreshes</p>
          </div>
        </div>
      ) : (
        <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {mediaPool.map((item) => (
            <MediaCard key={item.id} item={item} onDelete={handleDelete} />
          ))}
          <button onClick={() => fileInputRef.current?.click()}
            className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 text-white/30 transition-colors hover:border-white/20 hover:text-white/50">
            <Upload size={20} />
            <span className="text-[10px]">Add More</span>
          </button>
        </div>
      )}
    </div>
  );
}
