"use client";

import { useRef, useCallback } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { usePlaybackLoop } from "@/lib/hooks/use-playback-loop";
import { TrackHeader } from "@/components/timeline/track-header";
import { TrackLane } from "@/components/timeline/track-lane";
import { TimelineRuler } from "@/components/timeline/timeline-ruler";
import { Playhead } from "@/components/timeline/playhead";

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
  const setZoom = usePlaybackStore((s) => s.setZoom);
  const pixelsPerSecond = 100 * zoomLevel;
  const contentWidth = (duration / 1_000_000) * pixelsPerSecond;

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();

      const container = scrollContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const currentPPS = 100 * usePlaybackStore.getState().zoomLevel;
      const timeUnderMouse = (e.clientX - rect.left + container.scrollLeft) / currentPPS;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = usePlaybackStore.getState().zoomLevel * factor;
      setZoom(newZoom);

      // Adjust scroll so the time under the mouse stays anchored
      const clampedZoom = Math.max(0.1, Math.min(10, newZoom));
      const newPPS = 100 * clampedZoom;
      container.scrollLeft = timeUnderMouse * newPPS - (e.clientX - rect.left);
    },
    [setZoom]
  );

  return (
    <section className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
      {/* Toolbar: Add Track */}
      <div className="flex h-7 shrink-0 items-center border-b border-white/10">
        <div className="flex w-40 shrink-0 items-center justify-center border-r border-white/10">
          <button
            onClick={() => addTrack("video")}
            className="rounded px-2 py-0.5 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40"
            aria-label="Add new track"
          >
            + Add Track
          </button>
        </div>
      </div>

      {/* Scrollable track area with ruler + playhead */}
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed track headers column */}
        <div className="flex w-40 shrink-0 flex-col">
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

        {/* Scrollable lanes area */}
        <div
          ref={scrollContainerRef}
          className="scrollbar-hidden relative flex-1 overflow-x-auto overflow-y-hidden"
          onWheel={onWheel}
        >
          <div style={{ width: contentWidth, minHeight: "100%" }}>
            {/* Ruler */}
            <TimelineRuler scrollContainerRef={scrollContainerRef} />

            {/* Track lanes + playhead overlay */}
            <div className="relative">
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
