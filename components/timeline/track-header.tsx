import type { TrackType } from "@/lib/store/types";

interface TrackHeaderProps {
  label: string;
  color: string;
  trackType: TrackType;
  isMuted: boolean;
  isSolo: boolean;
  opacityOrVolume: number;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onOpacityOrVolumeChange: (value: number) => void;
}

export function TrackHeader({
  label,
  color,
  trackType,
  isMuted,
  isSolo,
  opacityOrVolume,
  onToggleMute,
  onToggleSolo,
  onOpacityOrVolumeChange,
}: TrackHeaderProps) {
  const sliderLabel =
    trackType === "audio" ? `${label} volume` : `${label} opacity`;

  return (
    <div className="flex shrink-0 flex-col gap-1 px-3 py-2">
      {/* Row 1: Color dot + label */}
      <div className="flex items-center gap-2">
        <div
          className="h-3 w-3 rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs font-medium text-white/80">{label}</span>
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
