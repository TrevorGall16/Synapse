import { X, GripVertical } from "lucide-react";
import type { TrackType } from "@/lib/store/types";

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

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("trackIndex", String(trackIndex));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const startIdx = Number(e.dataTransfer.getData("trackIndex"));
        if (!Number.isNaN(startIdx)) {
          onReorder(startIdx, trackIndex);
        }
      }}
      className={`group flex shrink-0 flex-col justify-center gap-0.5 overflow-hidden border-b border-white/10 px-2 py-1 ${TYPE_BG[trackType]}`}
      style={{ height }}
    >
      {/* Row 1: Grip + Color dot + label + delete */}
      <div className="flex items-center gap-1">
        <GripVertical size={10} className="shrink-0 cursor-grab text-white/20 group-hover:text-white/40 active:cursor-grabbing" />
        <div
          className="h-2 w-2 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="flex-1 truncate text-[10px] font-medium leading-tight text-white/80">{label}</span>
        <button
          onClick={onDelete}
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
        aria-label={sliderLabel}
        className="h-0.5 w-full cursor-pointer"
        style={{ accentColor: color }}
      />
    </div>
  );
}
