"use client";

import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import {
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
} from "lucide-react";

const FRAME_MICROS = 16_666;
const MICROS_PER_SECOND = 1_000_000;

function formatTimecode(micros: number): string {
  const totalSeconds = micros / MICROS_PER_SECOND;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function PreviewMonitor() {
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const playheadPosition = usePlaybackStore((s) => s.playheadPosition);
  const togglePlayback = usePlaybackStore((s) => s.togglePlayback);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);
  const duration = useProjectStore((s) => s.duration);

  return (
    <div className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
      <div className="shrink-0 border-b border-white/10 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">
          Preview
        </h2>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="aspect-video w-full max-w-lg rounded bg-[#111111]" />
      </div>

      {/* Transport toolbar */}
      <div className="flex shrink-0 items-center justify-center gap-1 border-t border-white/10 px-4 py-2">
        <TransportButton
          icon={<SkipBack size={14} />}
          label="Go to start"
          onClick={() => setPlayhead(0)}
        />
        <TransportButton
          icon={<ChevronLeft size={14} />}
          label="Previous frame"
          onClick={() => setPlayhead(playheadPosition - FRAME_MICROS)}
        />
        <TransportButton
          icon={isPlaying ? <Pause size={14} /> : <Play size={14} />}
          label={isPlaying ? "Pause" : "Play"}
          onClick={togglePlayback}
          accent
        />
        <TransportButton
          icon={<ChevronRight size={14} />}
          label="Next frame"
          onClick={() => setPlayhead(playheadPosition + FRAME_MICROS)}
        />
        <TransportButton
          icon={<SkipForward size={14} />}
          label="Go to end"
          onClick={() => setPlayhead(duration)}
        />
        <span className="ml-3 text-xs tabular-nums text-white/50">
          {formatTimecode(playheadPosition)}
        </span>
      </div>
    </div>
  );
}

function TransportButton({
  icon,
  label,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`rounded p-1.5 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
        accent
          ? "bg-white/15 text-white hover:bg-white/25"
          : "text-white/50 hover:bg-white/10 hover:text-white"
      }`}
    >
      {icon}
    </button>
  );
}
