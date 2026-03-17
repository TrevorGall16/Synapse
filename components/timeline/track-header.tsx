import { useState } from "react";
import { X, GripVertical, Palette } from "lucide-react";
import type { TrackType } from "@/lib/store/types";
import { TrackColorPopover } from "./track-color-popover";

const TYPE_BG: Record<TrackType, string> = {
  video: "bg-blue-500/5",
  audio: "bg-green-500/5",
  effect: "bg-red-500/5",
  text: "bg-yellow-500/5",
};

interface TrackHeaderProps {
  label: string;
  color: string;
  trackType: TrackType;
  trackId: string;
  height: number;
  trackIndex: number;
  isMuted?: boolean;
  isSolo?: boolean;
  opacityOrVolume: number;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onOpacityOrVolumeChange: (value: number) => void;
  onDelete: () => void;
  onReorder: (startIndex: number, endIndex: number) => void;
}

export function TrackHeader({
  label,
  color,
  trackType,
  trackId,
  height,
  trackIndex,
  isMuted,
  isSolo,
  opacityOrVolume,
  onToggleMute,
  onToggleSolo,
  onOpacityOrVolumeChange,
  onDelete,
  onReorder,
}: TrackHeaderProps) {
  const sliderLabel =
    trackType === "audio" ? `${label} volume` : `${label} opacity`;
  const [dropHighlight, setDropHighlight] = useState(false);
  const [showColorCorrection, setShowColorCorrection] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDropHighlight(true);
      }}
      onDragLeave={() => setDropHighlight(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropHighlight(false);
        const startIdx = Number(e.dataTransfer.getData("trackIndex"));
        if (!Number.isNaN(startIdx)) {
          onReorder(startIdx, trackIndex);
        }
      }}
      className={`group flex shrink-0 flex-col justify-center gap-0.5 overflow-hidden border-b border-white/10 px-2 py-1 ${TYPE_BG[trackType]} ${
        dropHighlight ? "border-t-2 border-t-white/40" : ""
      }`}
      style={{ height }}
    >
      {/* Row 1: Grip + Color dot + label + delete */}
      <div className="flex items-center gap-1">
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("trackIndex", String(trackIndex));
          }}
          className="shrink-0"
        >
          <GripVertical size={10} className="cursor-grab text-white/20 group-hover:text-white/40 active:cursor-grabbing" />
        </div>
        <div
          className="h-2 w-2 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="flex-1 truncate text-[10px] font-medium leading-tight text-white/80">{label}</span>
        {trackType === "video" && (
          <button
            onClick={() => setShowColorCorrection((v) => !v)}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Color correction"
            className={`shrink-0 rounded p-0.5 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
              showColorCorrection
                ? "bg-blue-500/30 text-blue-400"
                : "text-white/0 group-hover:text-white/40 hover:!bg-white/10"
            }`}
          >
            <Palette size={10} />
          </button>
        )}
        <button
          onClick={onDelete}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Delete ${label}`}
          className="shrink-0 rounded p-0.5 text-white/0 transition-colors group-hover:text-white/40 hover:!bg-red-500/30 hover:!text-red-400 focus-visible:ring-1 focus-visible:ring-white/40"
        >
          <X size={10} />
        </button>
      </div>

      {/* Row 2: Mute / Solo toggles */}
      <div className="flex gap-0.5">
        <button
          onClick={onToggleMute}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`${isMuted ? "Unmute" : "Mute"} ${label}`}
          className={`rounded px-1 py-px text-[9px] font-bold leading-tight transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
            isMuted
              ? "bg-red-500/80 text-white"
              : "bg-white/10 text-white/50 hover:bg-white/15"
          }`}
        >
          M
        </button>
        <button
          onClick={onToggleSolo}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`${isSolo ? "Unsolo" : "Solo"} ${label}`}
          className={`rounded px-1 py-px text-[9px] font-bold leading-tight transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
            isSolo
              ? "bg-yellow-500/80 text-white"
              : "bg-white/10 text-white/50 hover:bg-white/15"
          }`}
        >
          S
        </button>
      </div>

      {/* Row 3: Opacity / Volume slider */}
      <input
        type="range"
        min={0}
        max={100}
        defaultValue={opacityOrVolume}
        onChange={(e) => onOpacityOrVolumeChange(Number(e.target.value))}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={sliderLabel}
        className="h-0.5 w-full cursor-pointer"
        style={{ accentColor: color }}
      />

      {/* Color correction popover */}
      {showColorCorrection && (
        <TrackColorPopover trackId={trackId} onClose={() => setShowColorCorrection(false)} />
      )}
    </div>
  );
}
