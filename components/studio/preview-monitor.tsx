"use client";

import { useRef, useEffect, useState } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent } from "@/lib/store/types";

type PreviewQuality = "Draft" | "Auto" | "Best";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [quality, setQuality] = useState<PreviewQuality>("Auto");
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const playheadPosition = usePlaybackStore((s) => s.playheadPosition);
  const togglePlayback = usePlaybackStore((s) => s.togglePlayback);
  const setPlayhead = usePlaybackStore((s) => s.setPlayhead);
  const duration = useProjectStore((s) => s.duration);
  const tracks = useProjectStore((s) => s.tracks);
  const mediaPool = useProjectStore((s) => s.mediaPool);

  // Top-down compositing: Track 1 (index 0) is topmost and obscures lower tracks
  const videoTracks = tracks.filter((t) => t.type === "video");

  let activeClip: ClipEvent | undefined;
  for (const vt of videoTracks) {
    activeClip = vt.clips.find(
      (c) => playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration
    );
    if (activeClip) break;
  }

  const activeMedia = activeClip
    ? mediaPool.find((m) => m.id === activeClip.sourceId)
    : undefined;

  // Play/pause sync
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying && activeClip) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, activeClip]);

  // Time sync: only force-seek when scrubbing or significant drift
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;
    const localTime = (playheadPosition - activeClip.startTime) / MICROS_PER_SECOND;
    if (!isPlaying) {
      // Scrubbing — always seek
      if (Math.abs(video.currentTime - localTime) > 0.05) {
        video.currentTime = localTime;
      }
    } else {
      // Playing — only correct large drift
      if (Math.abs(video.currentTime - localTime) > 0.25) {
        video.currentTime = localTime;
      }
    }
  }, [playheadPosition, activeClip, isPlaying]);

  // Collect active text clips at playhead
  const textTracks = tracks.filter((t) => t.type === "text");
  const activeTextClips: ClipEvent[] = [];
  for (const tt of textTracks) {
    for (const c of tt.clips) {
      if (playheadPosition >= c.startTime && playheadPosition < c.startTime + c.duration) {
        activeTextClips.push(c);
      }
    }
  }

  return (
    <div className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">
          Preview
        </h2>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as PreviewQuality)}
          aria-label="Preview quality"
          className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/60 outline-none transition-colors hover:bg-white/15 focus-visible:ring-1 focus-visible:ring-white/40"
        >
          <option value="Draft" className="text-black">Draft</option>
          <option value="Auto" className="text-black">Auto</option>
          <option value="Best" className="text-black">Best</option>
        </select>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
        {activeMedia?.previewUrl ? (
          <video
            ref={videoRef}
            key={activeMedia.id}
            src={activeMedia.previewUrl}
            className="h-full w-full object-contain"
            playsInline
            preload="auto"
          />
        ) : (
          <div className="aspect-video w-full max-w-lg rounded bg-[#111111]" />
        )}

        {/* Text clip overlays */}
        {activeTextClips.map((tc) => {
          const content = tc.fxParams?.content as string | undefined;
          if (!content) return null;
          return (
            <div
              key={tc.id}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <span className="text-3xl font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
                {content}
              </span>
            </div>
          );
        })}
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
