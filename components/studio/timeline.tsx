"use client";

import { useRef } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { usePlaybackLoop } from "@/lib/hooks/use-playback-loop";
import { TrackHeader } from "@/components/timeline/track-header";
import { TrackLane } from "@/components/timeline/track-lane";
import { TimelineRuler } from "@/components/timeline/timeline-ruler";
import { Playhead } from "@/components/timeline/playhead";
import { ZoomSlider } from "@/components/timeline/zoom-slider";

export function Timeline() {
  const tracks = useProjectStore((s) => s.tracks);
  const addTrack = useProjectStore((s) => s.addTrack);
  const toggleMute = useProjectStore((s) => s.toggleMute);
  const toggleSolo = useProjectStore((s) => s.toggleSolo);
  const setOpacityOrVolume = useProjectStore((s) => s.setOpacityOrVolume);
  const duration = useProjectStore((s) => s.duration);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  usePlaybackLoop();

  const zoomLevel = usePlaybackStore((s) => s.zoomLevel);
  const pixelsPerSecond = 100 * zoomLevel;
  const contentWidth = (duration / 1_000_000) * pixelsPerSecond;

  return (
    <section className="flex h-full w-full flex-col overflow-hidden min-w-0 min-h-0 border-t border-white/20 bg-[#1a1a1a]">
      {/* Toolbar: Add Track + Zoom */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/10">
        <div className="flex w-48 shrink-0 items-center justify-center border-r border-white/10">
          <button
            onClick={() => addTrack("video")}
            className="rounded px-2 py-0.5 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40"
            aria-label="Add new track"
          >
            + Add Track
          </button>
        </div>
        <div className="pr-3">
          <ZoomSlider scrollContainerRef={scrollContainerRef} />
        </div>
      </div>

      {/* Header/Canvas split */}
      <div className="flex h-full w-full flex-1 overflow-hidden min-w-0 min-h-0">
        {/* Left Column: Track Headers (never scrolls horizontally) */}
        <div className="w-48 shrink-0 flex flex-col overflow-y-auto overflow-x-hidden border-r border-white/10">
          {/* Spacer aligned with ruler */}
          <div className="h-6 shrink-0 border-b border-white/10" />
          {tracks.map((track) => (
            <TrackHeader
              key={track.id}
              label={track.name}
              color={track.color ?? "#666"}
              trackType={track.type}
              isMuted={track.isMuted}
              isSolo={track.isSolo}
              opacityOrVolume={track.opacityOrVolume}
              onToggleMute={() => toggleMute(track.id)}
              onToggleSolo={() => toggleSolo(track.id)}
              onOpacityOrVolumeChange={(v) => setOpacityOrVolume(track.id, v)}
            />
          ))}
        </div>

        {/* Right Column: The Canvas (scrolls horizontally) */}
        <div
          ref={scrollContainerRef}
          className="scrollbar-hidden flex-1 flex flex-col overflow-x-auto overflow-y-auto min-w-0 relative"
        >
          {/* The 30,000px monster — ONLY this element is wide */}
          <div style={{ width: contentWidth }} className="flex flex-col min-h-full">
            {/* Ruler */}
            <TimelineRuler scrollContainerRef={scrollContainerRef} />

            {/* Track lanes + playhead overlay */}
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-0 z-10">
                <Playhead />
              </div>
              {tracks.map((track) => (
                <TrackLane key={track.id} trackId={track.id} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
