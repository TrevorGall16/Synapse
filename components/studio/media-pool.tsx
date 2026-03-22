"use client";

import { useRef, useState, useCallback } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { saveMediaToDB } from "@/lib/store/media-pool-db";
import type { MediaPoolItem } from "@/lib/store/types";

function mediaTypeFromMime(mime: string): "video" | "audio" | "image" {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "video";
}

function handleFiles(files: FileList | File[]) {
  const { addMediaItem } = useProjectStore.getState();

  for (const file of Array.from(files)) {
    const type = mediaTypeFromMime(file.type);
    const previewUrl = URL.createObjectURL(file);

    if (type === "image") {
      const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration: 5_000_000, previewUrl };
      addMediaItem(item);
      saveMediaToDB(file, item).catch(console.warn);
      continue;
    }

    const el = document.createElement(type === "audio" ? "audio" : "video");
    el.preload = "metadata";
    el.src = previewUrl;

    const finish = (durationSec: number) => {
      const duration = Math.round(durationSec * 1_000_000);
      const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration, previewUrl };
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
      const item: MediaPoolItem = { id: crypto.randomUUID(), name: file.name, type, duration: 5_000_000, previewUrl };
      addMediaItem(item);
      saveMediaToDB(file, item).catch(console.warn);
    };
  }
}

export function MediaPool() {
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = "";
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  return (
    <div
      className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">
          Media Pool
        </h2>
        <button
          onClick={() => inputRef.current?.click()}
          className="rounded px-2 py-0.5 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40"
        >
          + Import
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          className="hidden"
          onChange={onFilesSelected}
        />
      </div>

      {mediaPool.length === 0 ? (
        <div
          className={`flex flex-1 items-center justify-center overflow-y-auto transition-colors ${
            isDragOver ? "bg-white/5" : ""
          }`}
        >
          <p className="text-sm text-white/30">
            {isDragOver ? "Drop files to import" : "Drop files or click Import to begin"}
          </p>
        </div>
      ) : (
        <div
          className={`grid flex-1 grid-cols-3 gap-1 overflow-y-auto p-2 transition-colors ${
            isDragOver ? "bg-white/5" : ""
          }`}
        >
          {mediaPool.map((item) => (
            <MediaPoolCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function MediaPoolCard({ item }: { item: MediaPoolItem }) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("mediaId", item.id)}
      className="flex cursor-grab flex-col gap-1 rounded bg-white/5 p-1.5 transition-colors hover:bg-white/10 active:cursor-grabbing"
    >
      <MediaThumbnail item={item} />
      <span className="truncate text-[10px] text-white/60">
        {item.name}
      </span>
    </div>
  );
}

function MediaThumbnail({ item }: { item: MediaPoolItem }) {
  if (item.type === "video" && item.previewUrl) {
    return (
      <video
        src={item.previewUrl}
        className="aspect-video w-full rounded bg-black object-cover"
        muted
        playsInline
        preload="metadata"
        onMouseEnter={(e) => e.currentTarget.play()}
        onMouseLeave={(e) => {
          e.currentTarget.pause();
          e.currentTarget.currentTime = 0;
        }}
      />
    );
  }

  if (item.type === "image" && item.previewUrl) {
    return (
      <img
        src={item.previewUrl}
        alt={item.name}
        className="aspect-video w-full rounded bg-black object-cover"
      />
    );
  }

  return (
    <div className="flex aspect-video w-full items-center justify-center rounded bg-white/5">
      <span className="text-lg text-white/20">&#9835;</span>
    </div>
  );
}
