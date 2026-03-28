"use client";

import { useRef, useCallback, useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { audioEngine } from "@/lib/audio/audio-engine";
import { usePlaybackLoop } from "@/lib/hooks/use-playback-loop";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";
import { TrackHeader } from "@/components/timeline/track-header";
import { TrackLane } from "@/components/timeline/track-lane";
import { TimelineRuler } from "@/components/timeline/timeline-ruler";
import { Playhead } from "@/components/timeline/playhead";
import { SnapIndicator } from "@/components/timeline/snap-indicator";
import { TimelineMarkers } from "@/components/timeline/timeline-markers";
import { ZoomSlider } from "@/components/timeline/zoom-slider";
import { TimelineToolbar } from "@/components/timeline/timeline-toolbar";
import { TimelineGrid } from "@/components/timeline/timeline-grid";
import { requestAudioPeaks } from "@/lib/utils/media-extractor";
import type { TrackType } from "@/lib/store/types";

const COLLAPSED_HEIGHT = 24;

// ── Below-tracks drop zone: drag media here to auto-create a new track ──────
function NewTrackDropZone() {
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const mediaId = e.dataTransfer.getData("mediaId");
    if (!mediaId) return;

    const { mediaPool, addTrack, addClip, tracks } = useProjectStore.getState();
    const media = mediaPool.find((m) => m.id === mediaId);
    if (!media) return;

    useProjectStore.getState().snapshotHistory("Add Track");

    const pixelsPerSecond = usePlaybackStore.getState().pixelsPerSecond;
    const startTime = Math.max(0, Math.round((e.nativeEvent.offsetX / pixelsPerSecond) * 1_000_000));

    if (media.type === "video") {
      // Create a paired Video + Audio track so the linked clips are always together
      const beforeVideo = new Set(useProjectStore.getState().tracks.map((t) => t.id));
      addTrack("video");
      const newVideoTrack = useProjectStore.getState().tracks.find((t) => !beforeVideo.has(t.id));
      if (!newVideoTrack) return;

      const beforeAudio = new Set(useProjectStore.getState().tracks.map((t) => t.id));
      addTrack("audio");
      const newAudioTrack = useProjectStore.getState().tracks.find((t) => !beforeAudio.has(t.id));
      if (!newAudioTrack) return;

      const groupId = crypto.randomUUID();
      addClip(newVideoTrack.id, { id: crypto.randomUUID(), trackId: newVideoTrack.id, sourceId: mediaId, groupId, startTime, duration: media.duration, mediaOffset: 0 });
      addClip(newAudioTrack.id, { id: crypto.randomUUID(), trackId: newAudioTrack.id, sourceId: mediaId, groupId, startTime, duration: media.duration, mediaOffset: 0 });
      if (media.previewUrl) requestAudioPeaks(media.previewUrl, media.id);
    } else {
      // Audio-only: create a single audio track
      const before = new Set(tracks.map((t) => t.id));
      addTrack("audio");
      const newTrack = useProjectStore.getState().tracks.find((t) => !before.has(t.id));
      if (!newTrack) return;
      addClip(newTrack.id, { id: crypto.randomUUID(), trackId: newTrack.id, sourceId: mediaId, startTime, duration: media.duration, mediaOffset: 0 });
      if (media.previewUrl) requestAudioPeaks(media.previewUrl, media.id);
    }
  }, []);

  return (
    <div
      className="flex min-h-12 items-center justify-center border-b border-dashed border-white/10 transition-colors hover:border-white/25 hover:bg-white/[0.02]"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span className="select-none text-[9px] tracking-widest text-white/15 uppercase pointer-events-none">
        Drop here to create new track
      </span>
    </div>
  );
}

export function Timeline() {
  const tracks = useProjectStore((s) => s.tracks);
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const addTrack = useProjectStore((s) => s.addTrack);
  const deleteTrack = useProjectStore((s) => s.deleteTrack);
  const reorderTrack = useProjectStore((s) => s.reorderTrack);
  const toggleMute = useProjectStore((s) => s.toggleMute);
  const toggleSolo = useProjectStore((s) => s.toggleSolo);
  const ungroupClips = useProjectStore((s) => s.ungroupClips);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const duration = useProjectStore((s) => s.duration);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollDirtyRef = useRef(false);
  const scrollTickIdRef = useRef<number | null>(null);

  usePlaybackLoop();

  const pixelsPerSecond = usePlaybackStore((s) => s.pixelsPerSecond);
  const setZoom = usePlaybackStore((s) => s.setZoom);
  const setScrollLeft = usePlaybackStore((s) => s.setScrollLeft);
  const setContainerWidth = usePlaybackStore((s) => s.setContainerWidth);

  const onTrackAreaClick = useCallback((e: React.MouseEvent) => {
    if (!e.shiftKey) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickedMicros = Math.max(0, Math.round(((e.clientX - rect.left + container.scrollLeft) / pixelsPerSecond) * 1_000_000));
    const { selectionStart, setSelection } = usePlaybackStore.getState();
    const anchor = selectionStart ?? clickedMicros;
    setSelection(Math.min(anchor, clickedMicros), Math.max(anchor, clickedMicros));
  }, [pixelsPerSecond]);

  const contentWidth = (duration / 1_000_000) * pixelsPerSecond;

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const container = scrollContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const { zoomLevel, pixelsPerSecond: oldPPS } = usePlaybackStore.getState();
      const mouseX = e.clientX - rect.left;
      const timeAtMouse = (container.scrollLeft + mouseX) / oldPPS;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(0.001, Math.min(3, zoomLevel * factor));
      container.scrollLeft = timeAtMouse * (100 * newZoom) - mouseX;
      setZoom(newZoom);
    },
    [setZoom]
  );

  // Register a GlobalTicker callback that drains the scroll dirty flag
  useEffect(() => {
    scrollTickIdRef.current = registerTickCallback(() => {
      if (!scrollDirtyRef.current) return;
      scrollDirtyRef.current = false;
      const container = scrollContainerRef.current;
      if (container) setScrollLeft(container.scrollLeft);
    });
    return () => {
      if (scrollTickIdRef.current !== null) {
        unregisterTickCallback(scrollTickIdRef.current);
        scrollTickIdRef.current = null;
      }
    };
  }, [setScrollLeft]);

  const onScroll = useCallback(() => {
    scrollDirtyRef.current = true;
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    setContainerWidth(container.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [setContainerWidth]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      // Ctrl+Z — Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useProjectStore.getState().undo();
        return;
      }

      // Ctrl+Y / Ctrl+Shift+Z — Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        useProjectStore.getState().redo();
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        usePlaybackStore.getState().togglePlayback();
        return;
      }

      // V — collapse/expand ONLY the exact track the user last clicked on
      if (e.key === "v" || e.key === "V") {
        const { tracks: allTracks, selectedTrackId } = useProjectStore.getState();
        const target = selectedTrackId
          ? allTracks.find((t) => t.id === selectedTrackId)
          : null;
        if (target) {
          useProjectStore.getState().setTrackCollapsed(target.id, !target.collapsed);
        }
        return;
      }

      if (e.key === "g" || e.key === "G") {
        if (selectedClipIds.length > 1) {
          useProjectStore.getState().snapshotHistory("Group Clips");
          useProjectStore.getState().groupClips(selectedClipIds);
        }
        return;
      }

      if (e.key === "u" || e.key === "U") {
        if (selectedClipIds.length > 0) {
          useProjectStore.getState().snapshotHistory("Ungroup Clips");
          ungroupClips(selectedClipIds);
        }
        return;
      }

      if (e.key === "m" || e.key === "M") {
        if (e.ctrlKey || e.metaKey) return;
        const { playheadPosition } = usePlaybackStore.getState();
        useProjectStore.getState().addMarker({ id: crypto.randomUUID(), time: playheadPosition, color: "#f97316" });
        return;
      }

      if (e.key === "s" || e.key === "S") {
        if (e.ctrlKey || e.metaKey) return;
        const { tracks: allTracks, selectedClipIds: ids, splitSelectedClips, selectedTrackId } = useProjectStore.getState();
        const { playheadPosition } = usePlaybackStore.getState();

        let toSplit = ids;
        if (toSplit.length === 0) {
          const under: string[] = [];
          for (const t of allTracks) {
            for (const c of t.clips) {
              if (c.startTime < playheadPosition && c.startTime + c.duration > playheadPosition) under.push(c.id);
            }
          }
          toSplit = under;
        }

        if (toSplit.length > 0) {
          useProjectStore.getState().snapshotHistory("Split Clip");
          splitSelectedClips(toSplit, playheadPosition);
        } else if (selectedTrackId) {
          useProjectStore.getState().toggleSolo(selectedTrackId);
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const { selectedClipIds: ids, deleteSelectedClips } = useProjectStore.getState();
        if (ids.length > 0) {
          useProjectStore.getState().snapshotHistory("Delete Clip");
          deleteSelectedClips(ids);
        }
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const { masterVolume, setMasterVolume } = usePlaybackStore.getState();
        const delta = e.key === "ArrowUp" ? 5 : -5;
        const newVol = Math.max(0, Math.min(100, masterVolume + delta));
        setMasterVolume(newVol);
        audioEngine.setMasterVolume(newVol);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedClipIds, ungroupClips]);

  return (
    <section className="flex h-full w-full flex-col overflow-hidden min-w-0 min-h-0 border-t border-white/20 bg-[#1a1a1a]">
      {/* Toolbar */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-white/10">
        <div className="flex w-48 shrink-0 items-center border-r border-white/10">
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                addTrack(e.target.value as TrackType);
                e.target.value = "";
              }
            }}
            className="rounded bg-transparent px-2 py-0.5 text-[10px] font-medium text-white/50 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40"
            aria-label="Add new track"
          >
            <option value="" disabled className="text-black">+ Add Track</option>
            <option value="video" className="text-black">Video</option>
            <option value="audio" className="text-black">Audio</option>
            <option value="text" className="text-black">Text</option>
            <option value="effect" className="text-black">Effect</option>
          </select>
        </div>
        <TimelineToolbar />
        <div className="pr-3">
          <ZoomSlider scrollContainerRef={scrollContainerRef} />
        </div>
      </div>

      {/* Header/Canvas split */}
      <div className="flex h-full w-full flex-1 overflow-hidden min-w-0 min-h-0">
        {/* Left Column: Track Headers */}
        <div className="w-48 shrink-0 flex flex-col overflow-y-auto overflow-x-hidden border-r border-white/10">
          <div className="h-6 shrink-0 border-b border-white/10" />
          {tracks.map((track, idx) => {
            const effectiveHeight = track.collapsed ? COLLAPSED_HEIGHT : track.height;
            return (
              <TrackHeader
                key={track.id}
                label={track.name}
                color={track.color ?? "#666"}
                trackType={track.type}
                trackId={track.id}
                height={effectiveHeight}
                trackIndex={idx}
                collapsed={track.collapsed}
                isMuted={track.isMuted}
                isSolo={track.isSolo}
                onToggleMute={() => toggleMute(track.id)}
                onToggleSolo={() => toggleSolo(track.id)}
                onToggleCollapse={() => useProjectStore.getState().setTrackCollapsed(track.id, !track.collapsed)}
                onDelete={() => deleteTrack(track.id)}
                onReorder={reorderTrack}
              />
            );
          })}
          {/* Spacer below headers aligned with drop zone */}
          <div className="min-h-12 border-b border-dashed border-white/10" />
        </div>

        {/* Right Column: Scrollable canvas */}
        <div
          ref={scrollContainerRef}
          className="scrollbar-hidden flex-1 flex flex-col overflow-x-auto overflow-y-auto min-w-0 relative"
          onWheel={onWheel}
          onScroll={onScroll}
          onClick={onTrackAreaClick}
        >
          <div style={{ width: contentWidth }} className="flex flex-col min-h-full">
            <TimelineRuler scrollContainerRef={scrollContainerRef} />

            <div className="relative">
              <TimelineGrid />
              <div className="pointer-events-none absolute inset-0 z-10">
                <Playhead />
                <SnapIndicator />
                <TimelineMarkers />
              </div>
              {tracks.map((track) => {
                const effectiveHeight = track.collapsed ? COLLAPSED_HEIGHT : track.height;
                return (
                  <div
                    key={track.id}
                    style={{ contentVisibility: "auto", containIntrinsicHeight: effectiveHeight }}
                  >
                    <TrackLane trackId={track.id} trackHeight={effectiveHeight} />
                  </div>
                );
              })}
              {/* Empty-state hint — shown when every track has zero clips AND the pool is empty */}
              {tracks.every((t) => t.clips.length === 0) && mediaPool.length === 0 && (
                <div className="flex min-h-[120px] items-center justify-center">
                  <p className="select-none text-center text-[11px] font-medium text-white/25">
                    This project is empty<br />
                    <span className="text-[10px] font-normal text-white/15">Drag media from the pool onto a track to begin.</span>
                  </p>
                </div>
              )}
              {/* Drop zone to create a new track */}
              <NewTrackDropZone />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
