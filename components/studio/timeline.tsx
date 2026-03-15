"use client";

import { useRef, useCallback, useEffect } from "react";
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
  const deleteTrack = useProjectStore((s) => s.deleteTrack);
  const toggleMute = useProjectStore((s) => s.toggleMute);
  const toggleSolo = useProjectStore((s) => s.toggleSolo);
  const setOpacityOrVolume = useProjectStore((s) => s.setOpacityOrVolume);
  const ungroupClips = useProjectStore((s) => s.ungroupClips);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const duration = useProjectStore((s) => s.duration);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rafScrollId = useRef(0);

  usePlaybackLoop();

  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const setZoom = usePlaybackStore((s) => s.setZoom);
  const setScrollLeft = usePlaybackStore((s) => s.setScrollLeft);
  const setContainerWidth = usePlaybackStore((s) => s.setContainerWidth);

  const contentWidth = (duration / 1_000_000) * pixelsPerSecond;

  // ── Focal-Point Zooming (4-Step Algorithm) ────────────
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const container = scrollContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const { zoomLevel, pixelsPerSecond: oldPPS } = usePlaybackStore.getState();

      // Step 1: Capture pre-zoom anchor
      const mouseX = e.clientX - rect.left;
      const timeAtMouse = (container.scrollLeft + mouseX) / oldPPS;

      // Step 2: Change zoom level
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(0.001, Math.min(3, zoomLevel * factor));
      const newPPS = 100 * newZoom;

      // Step 3: Adjust scroll to keep mouse anchored
      container.scrollLeft = timeAtMouse * newPPS - mouseX;

      // Step 4: Save to store
      setZoom(newZoom);
    },
    [setZoom]
  );

  // ── Scroll sync (rAF-throttled) ──────────────────────
  const onScroll = useCallback(() => {
    cancelAnimationFrame(rafScrollId.current);
    rafScrollId.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      setScrollLeft(container.scrollLeft);
    });
  }, [setScrollLeft]);

  // ── ResizeObserver for containerWidth ─────────────────
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    setContainerWidth(container.clientWidth);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [setContainerWidth]);

  // ── Keyboard shortcuts ───────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "u" || e.key === "U") {
        if (selectedClipIds.length > 0) {
          ungroupClips(selectedClipIds);
        }
      }

      if (e.key === "s" || e.key === "S") {
        if (e.ctrlKey || e.metaKey) return; // Don't hijack Ctrl+S
        const { playheadPosition } = usePlaybackStore.getState();
        const { selectedClipIds: ids, splitClip } = useProjectStore.getState();
        for (const clipId of ids) {
          splitClip(clipId, playheadPosition);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedClipIds, ungroupClips]);

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
              height={track.height}
              isMuted={track.isMuted}
              isSolo={track.isSolo}
              opacityOrVolume={track.opacityOrVolume}
              onToggleMute={() => toggleMute(track.id)}
              onToggleSolo={() => toggleSolo(track.id)}
              onOpacityOrVolumeChange={(v) => setOpacityOrVolume(track.id, v)}
              onDelete={() => deleteTrack(track.id)}
            />
          ))}
        </div>

        {/* Right Column: The Canvas (scrolls horizontally) */}
        <div
          ref={scrollContainerRef}
          className="scrollbar-hidden flex-1 flex flex-col overflow-x-auto overflow-y-auto min-w-0 relative"
          onWheel={onWheel}
          onScroll={onScroll}
        >
          {/* The Spacer Div — creates the scrollable Cartesian plane */}
          <div style={{ width: contentWidth }} className="flex flex-col min-h-full">
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
