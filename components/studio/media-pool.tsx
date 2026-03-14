"use client";

import { useRef } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import type { TrackType, MediaPoolItem } from "@/lib/store/types";

function trackTypeFromMime(mime: string): TrackType {
  if (mime.startsWith("audio/")) return "audio";
  return "video";
}

export function MediaPool() {
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const { addMediaItem } = useProjectStore.getState();

    for (const file of Array.from(files)) {
      const type = trackTypeFromMime(file.type);
      const previewUrl = URL.createObjectURL(file);

      const item: MediaPoolItem = {
        id: crypto.randomUUID(),
        name: file.name,
        type,
        relativePath: file.name,
        durationMicros: 5_000_000,
        previewUrl,
      };

      addMediaItem(item);
    }

    e.target.value = "";
  };

  return (
    <div className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
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
        <div className="flex flex-1 items-center justify-center overflow-y-auto">
          <p className="text-sm text-white/30">
            Drop files or click Import to begin
          </p>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-3 gap-1 overflow-y-auto p-2">
          {mediaPool.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("mediaId", item.id)}
              className="flex cursor-grab flex-col gap-1 rounded bg-white/5 p-1.5 transition-colors hover:bg-white/10 active:cursor-grabbing"
            >
              {item.previewUrl && item.type === "video" ? (
                <video
                  src={item.previewUrl}
                  className="aspect-video w-full rounded bg-black object-cover"
                  muted
                  preload="metadata"
                />
              ) : item.previewUrl && item.type !== "audio" ? (
                <img
                  src={item.previewUrl}
                  alt={item.name}
                  className="aspect-video w-full rounded bg-black object-cover"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded bg-white/5">
                  <span className="text-lg text-white/20">♪</span>
                </div>
              )}
              <span className="truncate text-[10px] text-white/60">
                {item.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
