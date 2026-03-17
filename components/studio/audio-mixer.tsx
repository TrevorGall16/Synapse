"use client";

import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";

function formatDb(volume: number): string {
  if (volume <= 0) return "-\u221E";
  const dB = Math.round(20 * Math.log10(volume / 100) * 10) / 10;
  return `${dB > 0 ? "+" : ""}${dB.toFixed(1)} dB`;
}

export function AudioMixer() {
  const tracks = useProjectStore((s) => s.tracks);
  const toggleMute = useProjectStore((s) => s.toggleMute);
  const toggleSolo = useProjectStore((s) => s.toggleSolo);
  const setOpacityOrVolume = useProjectStore((s) => s.setOpacityOrVolume);
  const setTrackAudioParam = useProjectStore((s) => s.setTrackAudioParam);
  const masterVolume = usePlaybackStore((s) => s.masterVolume);
  const setMasterVolume = usePlaybackStore((s) => s.setMasterVolume);

  // Show audio tracks + video tracks (they carry embedded audio)
  const mixableTracks = tracks.filter((t) => t.type === "audio" || t.type === "video");

  return (
    <div className="flex h-full items-stretch gap-0 border-t border-white/20 bg-[#1a1a1a]">
      {/* Channel strips */}
      {mixableTracks.map((track) => (
        <ChannelStrip
          key={track.id}
          name={track.name}
          volume={track.opacityOrVolume}
          pan={track.audioPan ?? 0}
          isMuted={track.isMuted ?? false}
          isSolo={track.isSolo ?? false}
          trackType={track.type}
          onVolumeChange={(v) => setOpacityOrVolume(track.id, v)}
          onPanChange={(v) => setTrackAudioParam(track.id, { audioPan: v })}
          onToggleMute={() => toggleMute(track.id)}
          onToggleSolo={() => toggleSolo(track.id)}
        />
      ))}

      {/* Master fader */}
      <div className="flex flex-col items-center justify-between border-l border-white/10 px-3 py-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-white/60">Master</span>
        <div className="flex flex-1 items-center py-1" onPointerDown={(e) => e.stopPropagation()}>
          <input
            type="range"
            min={0}
            max={100}
            value={masterVolume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
            className="h-16 w-1 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
          />
        </div>
        <span className="text-[9px] tabular-nums text-white/40">{masterVolume}</span>
        <span className="text-[8px] tabular-nums text-white/30">{formatDb(masterVolume)}</span>
      </div>

      {/* Empty state */}
      {mixableTracks.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-xs text-white/20">No audio tracks</span>
        </div>
      )}
    </div>
  );
}

function ChannelStrip({
  name,
  volume,
  pan,
  isMuted,
  isSolo,
  trackType,
  onVolumeChange,
  onPanChange,
  onToggleMute,
  onToggleSolo,
}: {
  name: string;
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  trackType: string;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
}) {
  const typeColor = trackType === "video" ? "text-blue-400/50" : "text-green-400/50";
  const panLabel = pan === 0 ? "C" : pan < 0 ? `L${Math.abs(pan)}` : `R${pan}`;

  return (
    <div className="flex w-16 flex-col items-center justify-between border-r border-white/10 px-1 py-2">
      <span className="w-full truncate text-center text-[9px] font-medium text-white/50">
        {name}
      </span>
      <span className={`text-[7px] uppercase ${typeColor}`}>{trackType}</span>

      {/* Pan knob (horizontal slider) */}
      <div className="w-full px-0.5" onPointerDown={(e) => e.stopPropagation()}>
        <input
          type="range"
          min={-100}
          max={100}
          value={pan}
          onChange={(e) => onPanChange(Number(e.target.value))}
          className="h-0.5 w-full cursor-pointer"
          title={`Pan: ${panLabel}`}
        />
        <div className="text-center text-[7px] tabular-nums text-white/30">{panLabel}</div>
      </div>

      {/* Vertical fader */}
      <div className="flex flex-1 items-center py-1" onPointerDown={(e) => e.stopPropagation()}>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="h-16 w-1 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
        />
      </div>

      <span className="text-[9px] tabular-nums text-white/40">{volume}</span>
      <span className="text-[8px] tabular-nums text-white/30">{formatDb(volume)}</span>

      {/* M / S buttons */}
      <div className="mt-1 flex gap-0.5">
        <button
          onClick={onToggleMute}
          onPointerDown={(e) => e.stopPropagation()}
          className={`rounded px-1 py-0.5 text-[8px] font-bold transition-colors ${
            isMuted ? "bg-red-500/80 text-white" : "bg-white/10 text-white/40 hover:bg-white/15"
          }`}
        >
          M
        </button>
        <button
          onClick={onToggleSolo}
          onPointerDown={(e) => e.stopPropagation()}
          className={`rounded px-1 py-0.5 text-[8px] font-bold transition-colors ${
            isSolo ? "bg-yellow-500/80 text-black" : "bg-white/10 text-white/40 hover:bg-white/15"
          }`}
        >
          S
        </button>
      </div>
    </div>
  );
}
