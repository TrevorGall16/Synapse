"use client";

import { useRef, useEffect, useState } from "react";
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

  // Audio-only mixer — video track audio is routed via paired audio tracks (groupId)
  const mixableTracks = tracks.filter((t) => t.type === "audio");

  return (
    <div className="flex h-full items-stretch gap-0 border-t border-white/20 bg-[#1a1a1a]">
      {/* Channel strips */}
      {mixableTracks.map((track, index) => (
        <ChannelStrip
          key={track.id}
          index={index + 1}
          name={track.name}
          volume={track.opacityOrVolume}
          pan={track.audioPan ?? 0}
          isMuted={track.isMuted ?? false}
          isSolo={track.isSolo ?? false}
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
  index,
  name,
  volume,
  pan,
  isMuted,
  isSolo,
  onVolumeChange,
  onPanChange,
  onToggleMute,
  onToggleSolo,
}: {
  index: number;
  name: string;
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  onToggleMute: () => void;
  onToggleSolo: () => void;
}) {
  const panLabel = pan === 0 ? "C" : pan < 0 ? `L${Math.abs(pan)}` : `R${pan}`;

  return (
    <div className="flex w-16 flex-col items-center justify-between border-r border-white/10 px-1 py-2">
      <span className="w-full truncate text-center text-[9px] font-medium text-white/50">
        {index}: {name}
      </span>
      <span className="text-[7px] uppercase text-green-400/50">audio</span>

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

      {/* Vertical fader + peak meter */}
      <div className="flex flex-1 items-center gap-0.5 py-1" onPointerDown={(e) => e.stopPropagation()}>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="h-16 w-1 cursor-pointer [writing-mode:vertical-lr] [direction:rtl]"
        />
        <PeakMeter volume={isMuted ? 0 : volume} />
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

function PeakMeter({ volume }: { volume: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    if (!isPlaying || volume <= 0) {
      bar.style.height = "0%";
      return;
    }

    const tick = () => {
      const jitter = 0.9 + Math.random() * 0.2;
      const h = Math.min(100, volume * jitter);
      bar.style.height = `${h}%`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, volume]);

  return (
    <div className="relative h-16 w-[2px] overflow-hidden rounded-sm bg-white/5">
      <div
        ref={barRef}
        className="absolute bottom-0 w-full rounded-sm"
        style={{
          background: "linear-gradient(to top, #22c55e, #eab308 70%, #ef4444 95%)",
          height: "0%",
          transition: "height 50ms",
        }}
      />
    </div>
  );
}
