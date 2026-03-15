import { X } from "lucide-react";
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
  isMuted?: boolean;
  isSolo?: boolean;
  opacityOrVolume: number;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onOpacityOrVolumeChange: (value: number) => void;
  onDelete: () => void;
}

export function TrackHeader({
  label,
  color,
  trackType,
  height,
  isMuted,
  isSolo,
  opacityOrVolume,
  onToggleMute,
  onToggleSolo,
  onOpacityOrVolumeChange,
  onDelete,
}: TrackHeaderProps) {
  const sliderLabel =
    trackType === "audio" ? `${label} volume` : `${label} opacity`;

  return (
    <div
      className={`group flex shrink-0 flex-col gap-1 border-b border-white/10 px-3 py-2 ${TYPE_BG[trackType]}`}
      style={{ height }}
    >
      {/* Row 1: Color dot + label + delete */}
      <div className="flex items-center gap-2">
        <div
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="flex-1 truncate text-xs font-medium text-white/80">{label}</span>
        <button
          onClick={onDelete}
          aria-label={`Delete ${label}`}
          className="rounded p-0.5 text-white/0 transition-colors group-hover:text-white/40 hover:!bg-red-500/30 hover:!text-red-400 focus-visible:ring-1 focus-visible:ring-white/40"
        >
          <X size={12} />
        </button>
      </div>

      {/* Row 2: Mute / Solo toggles */}
      <div className="flex gap-1">
        <button
          onClick={onToggleMute}
          aria-label={`${isMuted ? "Unmute" : "Mute"} ${label}`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
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
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
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
        className="h-1 w-full cursor-pointer"
        style={{ accentColor: color }}
      />
    </div>
  );
}
