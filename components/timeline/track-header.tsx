"use client";

import { useState } from "react";
import { X, GripVertical, ChevronRight } from "lucide-react";
import type { TrackType } from "@/lib/store/types";
import { useProjectStore } from "@/lib/store/project-store";

const TYPE_BG: Record<TrackType, string> = {
  video: "bg-blue-500/5",
  audio: "bg-green-500/5",
  effect: "bg-red-500/5",
  text: "bg-yellow-500/5",
};

/** 8 categorical colors shown in the inline swatch picker. */
const SWATCHES = [
  "#7c3aed", "#2563eb", "#0891b2", "#16a34a",
  "#ca8a04", "#dc2626", "#ec4899", "#64748b",
];

interface TrackHeaderProps {
  label: string;
  color: string;
  trackType: TrackType;
  trackId: string;
  height: number; // effective (already accounts for collapse)
  trackIndex: number;
  collapsed: boolean;
  isMuted?: boolean;
  isSolo?: boolean;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onReorder: (startIndex: number, endIndex: number) => void;
}

export function TrackHeader({
  label, color, trackType, trackId, height, trackIndex, collapsed,
  isMuted, isSolo, onToggleMute, onToggleSolo, onToggleCollapse, onDelete, onReorder,
}: TrackHeaderProps) {
  const [dropHighlight, setDropHighlight] = useState(false);
  const [showColors, setShowColors] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDragEnter={(e) => { e.preventDefault(); setDropHighlight(true); }}
      onDragLeave={() => setDropHighlight(false)}
      onDrop={(e) => {
        e.preventDefault(); setDropHighlight(false);
        const startIdx = Number(e.dataTransfer.getData("trackIndex"));
        if (!Number.isNaN(startIdx)) onReorder(startIdx, trackIndex);
      }}
      className={`group relative flex shrink-0 flex-col justify-center overflow-visible border-b border-white/10 px-1.5 ${TYPE_BG[trackType]} ${
        dropHighlight ? "border-t-2 border-t-white/40" : ""
      }`}
      style={{ height }}
    >
      {/* Compact single row: Chevron · Grip · Color · Name · M · S · X */}
      <div className="flex items-center gap-0.5">

        {/* Collapse toggle */}
        <button
          onClick={onToggleCollapse}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={collapsed ? "Expand track" : "Collapse track"}
          className="shrink-0 rounded p-0.5 text-white/25 transition-colors hover:bg-white/10 hover:text-white/60"
        >
          <ChevronRight
            size={10}
            className={`transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
          />
        </button>

        {/* Drag grip */}
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("trackIndex", String(trackIndex));
          }}
          className="shrink-0 cursor-grab active:cursor-grabbing"
        >
          <GripVertical size={10} className="text-white/20 group-hover:text-white/40" />
        </div>

        {/* Color swatch — click opens inline picker */}
        <button
          onClick={() => setShowColors((v) => !v)}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Pick track color"
          className={`h-3 w-3 shrink-0 rounded-sm transition-all hover:scale-110 ${showColors ? "ring-1 ring-white/60" : ""}`}
          style={{ backgroundColor: color }}
        />

        {/* Track name */}
        <span className="flex-1 truncate text-[10px] font-medium leading-tight text-white/70">
          {label}
        </span>

        {/* Mute */}
        <button
          onClick={onToggleMute}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`${isMuted ? "Unmute" : "Mute"} ${label}`}
          className={`rounded px-1 py-px text-[9px] font-bold leading-tight transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
            isMuted ? "bg-red-500/80 text-white" : "bg-white/8 text-white/40 hover:bg-white/15"
          }`}
        >
          M
        </button>

        {/* Solo */}
        <button
          onClick={onToggleSolo}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`${isSolo ? "Unsolo" : "Solo"} ${label}`}
          className={`rounded px-1 py-px text-[9px] font-bold leading-tight transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
            isSolo ? "bg-yellow-500/80 text-white" : "bg-white/8 text-white/40 hover:bg-white/15"
          }`}
        >
          S
        </button>

        {/* Delete */}
        <button
          onClick={onDelete}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Delete ${label}`}
          className="shrink-0 rounded p-0.5 text-white/0 transition-colors group-hover:text-white/30 hover:!bg-red-500/20 hover:!text-red-400 focus-visible:ring-1 focus-visible:ring-white/40"
        >
          <X size={10} />
        </button>
      </div>

      {/* Inline color swatch picker */}
      {showColors && (
        <div
          className="absolute left-1 top-full z-[100] mt-0.5 grid grid-cols-4 gap-0.5 rounded-lg border border-white/15 bg-[#1e1e1e] p-1.5 shadow-xl shadow-black/60"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {SWATCHES.map((sw) => (
            <button
              key={sw}
              onClick={() => {
                useProjectStore.getState().setTrackColor(trackId, sw);
                setShowColors(false);
              }}
              className={`h-4 w-4 rounded-sm transition-transform hover:scale-110 ${sw === color ? "ring-1 ring-white ring-offset-1 ring-offset-[#1e1e1e]" : ""}`}
              style={{ backgroundColor: sw }}
              aria-label={sw}
            />
          ))}
        </div>
      )}
    </div>
  );
}
