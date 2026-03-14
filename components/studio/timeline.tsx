"use client";

import { useState, useCallback } from "react";
import { TrackHeader } from "@/components/timeline/track-header";
import { TrackLane } from "@/components/timeline/track-lane";

interface Track {
  id: string;
  label: string;
  color: string;
  isMuted: boolean;
  isSolo: boolean;
  volume: number;
}

const INITIAL_TRACKS: Track[] = [
  { id: "text-1",   label: "Text",    color: "#eab308", isMuted: false, isSolo: false, volume: 100 },
  { id: "pulse-1",  label: "Pulse",   color: "#a855f7", isMuted: false, isSolo: false, volume: 100 },
  { id: "strobe-1", label: "Strobe",  color: "#ef4444", isMuted: false, isSolo: false, volume: 100 },
  { id: "video-2",  label: "Video 2", color: "#3b82f6", isMuted: false, isSolo: false, volume: 100 },
  { id: "video-1",  label: "Video 1", color: "#3b82f6", isMuted: false, isSolo: false, volume: 100 },
  { id: "audio-1",  label: "Audio 1", color: "#22c55e", isMuted: false, isSolo: false, volume: 100 },
  { id: "audio-2",  label: "Audio 2", color: "#22c55e", isMuted: false, isSolo: false, volume: 100 },
];

let nextTrackId = 1;

export function Timeline() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);

  const addTrack = useCallback(() => {
    nextTrackId++;
    setTracks((prev) => [
      ...prev,
      {
        id: `video-new-${nextTrackId}`,
        label: `Video ${nextTrackId}`,
        color: "#3b82f6",
        isMuted: false,
        isSolo: false,
        volume: 100,
      },
    ]);
  }, []);

  const toggleMute = useCallback((id: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isMuted: !t.isMuted } : t))
    );
  }, []);

  const toggleSolo = useCallback((id: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isSolo: !t.isSolo } : t))
    );
  }, []);

  const changeVolume = useCallback((id: string, volume: number) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, volume } : t))
    );
  }, []);

  return (
    <section className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
      {/* Ruler bar + Add Track */}
      <div className="flex h-7 shrink-0 items-center border-b border-white/10">
        <div className="flex w-40 shrink-0 items-center justify-center border-r border-white/10">
          <button
            onClick={addTrack}
            className="rounded px-2 py-0.5 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40"
            aria-label="Add new track"
          >
            + Add Track
          </button>
        </div>
        <span className="px-3 text-[10px] tabular-nums text-white/40">
          00:00.000
        </span>
      </div>

      {/* Track rows */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {tracks.map((track) => (
          <div key={track.id} className="flex">
            <TrackHeader
              label={track.label}
              color={track.color}
              isMuted={track.isMuted}
              isSolo={track.isSolo}
              volume={track.volume}
              onToggleMute={() => toggleMute(track.id)}
              onToggleSolo={() => toggleSolo(track.id)}
              onVolumeChange={(v) => changeVolume(track.id, v)}
            />
            <TrackLane trackId={track.id} />
          </div>
        ))}
      </div>
    </section>
  );
}
