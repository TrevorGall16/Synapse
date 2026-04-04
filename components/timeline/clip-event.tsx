"use client";

import { useRef, useCallback, useState } from "react";
import type { ClipEvent } from "@/lib/store/types";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { Settings, Crop, Volume2, Layers } from "lucide-react";
import { ClipFilmstrip } from "./clip-filmstrip";
import { ClipWaveform } from "./clip-waveform";
import { ClipContextMenu } from "./clip-context-menu";
import { snapToNearbyPure, snapToNearby } from "@/lib/utils/snap";
import { timeMicrosToTimelinePx, screenXToTimeMicros } from "@/lib/utils/coords";

const SNAP_BREAK_PX = 20;       // px/pointermove — break out of snap magnets when dragging fast
const HARD_WALL_LEFT_PX  = 20;  // px to the LEFT of snap before overlap territory opens
const HARD_WALL_RIGHT_PX = 8;   // px to the RIGHT before magnetic catch releases

interface ClipEventBlockProps {
  clip: ClipEvent;
  trackId: string;
  pixelsPerSecond: number;
  trackColor: string;
  trackHeight: number;
}

export function ClipEventBlock({ clip, trackId, pixelsPerSecond, trackColor, trackHeight }: ClipEventBlockProps) {
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const tracks = useProjectStore((s) => s.tracks);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const media = mediaPool.find((m) => m.id === clip.sourceId);
  const track = tracks.find((t) => t.id === trackId);
  const isSelected = selectedClipIds.includes(clip.id);
  const isCollapsed = trackHeight <= 24;

  // Baked remix clips: embedded FX/text prove this came from a published project.
  // Adjacent baked clips are styled as one continuous block (no gap border or radius).
  const isBaked = !!(clip.embeddedEffectClips?.length || clip.embeddedTextClips?.length);
  const siblings = track?.clips ?? [];
  const ADJ_US = 1_000; // 1 ms tolerance for "exactly touching"
  const hasLeftNeighbor  = isBaked && siblings.some((s) =>
    s.id !== clip.id && Math.abs((s.startTime + s.duration) - clip.startTime) < ADJ_US
    && !!(s.embeddedEffectClips?.length || s.embeddedTextClips?.length));
  const hasRightNeighbor = isBaked && siblings.some((s) =>
    s.id !== clip.id && Math.abs(s.startTime - (clip.startTime + clip.duration)) < ADJ_US
    && !!(s.embeddedEffectClips?.length || s.embeddedTextClips?.length));

  const label = isBaked ? "Remix Track" : (media?.name ?? clip.sourceId);

  const clipRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const hardSnapLock = useRef<number | null>(null); // micros of current hard-snap position
  // Transient drag position — the single source of truth during active drag.
  // Both clip preview (via direct DOM style) and snap indicator derive from this value.
  // Committed to the store only at drag end to avoid split-frame desync between
  // the project store (clip.startTime) and playback store (snapIndicatorMicros).
  const dragStartMicros = useRef<number | null>(null);
  // The clip.startTime captured at drag begin — used to compute the store delta at drag end.
  const dragOriginMicros = useRef(0);
  // Cursor-lock grab anchor — set once at mousedown, NEVER advanced during drag.
  const grabOffsetMicros = useRef(0);
  const dragAnchorX    = useRef(0); // clientX at mousedown — used for speed detection only
  const lastClientX    = useRef(0); // used for speed detection (avoids e.movementX unreliability)
  const isEdgeDragging = useRef<"left" | "right" | false>(false);
  const isLevelDragging = useRef(false);
  const isStretchDragging = useRef(false);
  const isFadeDragging = useRef<"in" | "out" | false>(false);
  const edgeStartX = useRef(0);
  const edgeOrigDuration = useRef(0);
  const levelStartY = useRef(0);
  const levelStartVal = useRef(100);
  const fadeStartX = useRef(0);
  const accumY = useRef(0);
  const [levelTooltip, setLevelTooltip] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [dropBlockMsg, setDropBlockMsg] = useState<string | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);
  const [isDraggingState, setIsDraggingState] = useState(false);

  const xPx = timeMicrosToTimelinePx(clip.startTime, pixelsPerSecond);
  const wPx = timeMicrosToTimelinePx(clip.duration, pixelsPerSecond);
  const clipLevel = clip.level ?? 100;

  const fadeInPx = clip.fadeInDuration ? (clip.fadeInDuration / 1_000_000) * pixelsPerSecond : 0;
  const fadeOutPx = clip.fadeOutDuration ? (clip.fadeOutDuration / 1_000_000) * pixelsPerSecond : 0;

  // ── Main clip drag ─────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();

      // Select this clip (+ all grouped clips)
      const { setSelectedClipIds, tracks: allTracks, snapshotHistory } = useProjectStore.getState();
      const groupIds: string[] = [clip.id];
      if (clip.groupId) {
        for (const t of allTracks) {
          for (const c of t.clips) {
            if (c.groupId === clip.groupId && c.id !== clip.id) groupIds.push(c.id);
          }
        }
      }
      if (e.shiftKey) {
        setSelectedClipIds([...useProjectStore.getState().selectedClipIds, ...groupIds]);
      } else {
        setSelectedClipIds(groupIds);
      }

      // Track the exact source track for the V shortcut
      useProjectStore.getState().setSelectedTrackId(trackId);

      // Snapshot before drag for undo
      snapshotHistory("Move Clip");

      const { scrollLeft: sl, cssZoomScale: zs } = usePlaybackStore.getState();
      const ctr = e.currentTarget.closest("[data-timeline-scroll-container]");
      const ctrRect = ctr?.getBoundingClientRect() ?? new DOMRect();
      const clickTime = Math.round(screenXToTimeMicros(e.clientX, ctrRect, sl, pixelsPerSecond, zs));
      usePlaybackStore.getState().setPlayhead(clickTime);

      e.currentTarget.setPointerCapture(e.pointerId);
      isDragging.current = true;
      setIsDraggingState(true);
      accumY.current = 0;
      hardSnapLock.current = null;
      dragStartMicros.current = null;
      dragOriginMicros.current = clip.startTime;
      // Compute grab offset at mousedown in micros — locks cursor to grab point.
      // Uses the scroll container rect + cssZoomScale so the conversion is correct
      // even when the zoom slider applies a transient CSS scaleX to the track area.
      const { scrollLeft, cssZoomScale } = usePlaybackStore.getState();
      const container = e.currentTarget.closest("[data-timeline-scroll-container]");
      const containerRect = container?.getBoundingClientRect() ?? new DOMRect();
      grabOffsetMicros.current = screenXToTimeMicros(e.clientX, containerRect, scrollLeft, pixelsPerSecond, cssZoomScale) - clip.startTime;
      dragAnchorX.current = e.clientX; // for speed detection
      lastClientX.current = e.clientX;
    },
    [clip.id, clip.groupId, clip.startTime, trackId, pixelsPerSecond]
  );

  // ── Lockstep indicator update ──────────────────────────────────────────────
  // During drag, update the snap indicator DOM element directly (same frame as
  // clip DOM) instead of going through the playback store. This prevents the
  // split-frame desync that occurs when two separate Zustand stores trigger two
  // independent React renders.
  const updateIndicatorDOM = useCallback(
    (snapMicros: number | null, isHard: boolean) => {
      const el = document.querySelector<HTMLElement>("[data-snap-indicator]");
      if (!el) return;
      if (snapMicros === null) {
        el.style.display = "none";
        return;
      }
      const pps = usePlaybackStore.getState().pixelsPerSecond;
      const xPx = (snapMicros / 1_000_000) * pps;
      const color = isHard ? "rgba(255,255,255,0.95)" : "rgba(0,229,255,0.85)";
      const shadow = isHard
        ? "0 0 6px 2px rgba(255,255,255,0.6)"
        : "0 0 6px 1px rgba(0,229,255,0.5)";
      el.style.display = "block";
      el.style.left = `${xPx}px`;
      el.style.background = color;
      el.style.boxShadow = shadow;
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;

      // ── Speed detection via stable manual delta (e.movementX is unreliable during snaps) ──
      const speed = Math.abs(e.clientX - lastClientX.current);
      lastClientX.current = e.clientX;

      // ── Virtual position: cursor-locked grab-offset approach ────────────────
      const { scrollLeft, cssZoomScale } = usePlaybackStore.getState();
      const container = (e.currentTarget as HTMLElement).closest("[data-timeline-scroll-container]");
      const containerRect = container?.getBoundingClientRect() ?? new DOMRect();
      const virtualTime = Math.max(0, Math.round(screenXToTimeMicros(e.clientX, containerRect, scrollLeft, pixelsPerSecond, cssZoomScale) - grabOffsetMicros.current));

      // ── Compute snappedStart once ────────────────────────────────────────────
      let newStart: number;
      let snapPos: number | null = null;
      let snapIsHard = false;

      if (speed > SNAP_BREAK_PX) {
        hardSnapLock.current = null;
        newStart = virtualTime;
      } else if (hardSnapLock.current !== null) {
        const offsetPx = ((virtualTime - hardSnapLock.current) / 1_000_000) * pixelsPerSecond;
        if (offsetPx < -HARD_WALL_LEFT_PX) {
          hardSnapLock.current = null;
          newStart = virtualTime;
        } else if (offsetPx > HARD_WALL_RIGHT_PX) {
          hardSnapLock.current = null;
          newStart = virtualTime;
        } else {
          newStart = hardSnapLock.current;
          snapPos = hardSnapLock.current;
          snapIsHard = true;
        }
      } else {
        const result = snapToNearbyPure(virtualTime, pixelsPerSecond, clip.id);
        newStart = result.time;
        if (result.isHard && result.time !== virtualTime) {
          hardSnapLock.current = result.time;
        }
        // snapToNearby already called setSnapIndicator — but we'll override with DOM below
        snapPos = result.time !== virtualTime ? result.time : null;
        snapIsHard = result.isHard;
      }

      // ── Store the transient position ────────────────────────────────────────
      dragStartMicros.current = newStart;

      // ── Lockstep DOM writes: clip preview + indicator in the SAME frame ─────
      // 1. Clip position — direct DOM, no store round-trip
      if (clipRef.current) {
        const previewPx = timeMicrosToTimelinePx(newStart, pixelsPerSecond);
        clipRef.current.style.transform = `translate3d(${previewPx}px, 0, 0)`;
      }
      // 2. Snap indicator — direct DOM, same frame
      updateIndicatorDOM(snapPos, snapIsHard);

      // ── Track jumps require store mutation (clip moves between tracks) ──────
      accumY.current += e.movementY;
      const trackJumps = Math.trunc(accumY.current / trackHeight);
      if (trackJumps !== 0) {
        useProjectStore.getState().moveClip(clip.id, 0, trackJumps);
        accumY.current -= trackJumps * trackHeight;
      }
    },
    [clip.id, pixelsPerSecond, trackHeight, updateIndicatorDOM]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      // ── Commit transient drag position to the store ──────────────────────────
      if (dragStartMicros.current !== null) {
        const deltaTime = dragStartMicros.current - dragOriginMicros.current;
        if (deltaTime !== 0) {
          useProjectStore.getState().moveClip(clip.id, deltaTime, 0);
        }
      }
      dragStartMicros.current = null;
      isDragging.current = false;
      setIsDraggingState(false);
      hardSnapLock.current = null;
      accumY.current = 0;
      e.currentTarget.releasePointerCapture(e.pointerId);
      // Clear indicator via store for React reconciliation
      usePlaybackStore.getState().setSnapIndicator(null);
      updateIndicatorDOM(null, false);
    },
    [clip.id, updateIndicatorDOM]
  );

  // ── Edge trim handlers ──────────────────────────────────
  const onEdgeDown = useCallback(
    (edge: "left" | "right", e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      useProjectStore.getState().snapshotHistory("Trim Clip");
      isEdgeDragging.current = edge;
      edgeStartX.current = e.clientX;
    },
    []
  );

  const onEdgeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isEdgeDragging.current) return;
      const deltaX = e.clientX - edgeStartX.current;
      const { cssZoomScale } = usePlaybackStore.getState();
      const rawDelta = Math.round((deltaX / (pixelsPerSecond * cssZoomScale)) * 1_000_000);
      const edge = isEdgeDragging.current === "left"
        ? clip.startTime + rawDelta
        : clip.startTime + clip.duration + rawDelta;
      const { time: snappedEdge } = snapToNearby(edge, pixelsPerSecond, clip.id);
      const deltaMicros = isEdgeDragging.current === "left"
        ? snappedEdge - clip.startTime
        : snappedEdge - (clip.startTime + clip.duration);
      useProjectStore.getState().trimClip(clip.id, isEdgeDragging.current, deltaMicros);
      edgeStartX.current = e.clientX;
    },
    [clip.id, pixelsPerSecond]
  );

  const onEdgeUp = useCallback(
    (e: React.PointerEvent) => {
      isEdgeDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      usePlaybackStore.getState().setSnapIndicator(null);
    },
    []
  );

  // ── Top-edge level drag ──────────────────────────────────
  const onLevelDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      useProjectStore.getState().snapshotHistory("Adjust Level");
      isLevelDragging.current = true;
      levelStartY.current = e.clientY;
      levelStartVal.current = clip.level ?? 100;
    },
    [clip.level]
  );

  const onLevelMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isLevelDragging.current) return;
      const deltaY = e.clientY - levelStartY.current;
      const deltaLevel = -(deltaY / trackHeight) * 100;
      const newLevel = Math.max(0, Math.min(100, Math.round(levelStartVal.current + deltaLevel)));
      useProjectStore.getState().setClipLevel(clip.id, newLevel);
      setLevelTooltip(newLevel);
    },
    [clip.id, trackHeight]
  );

  const onLevelUp = useCallback(
    (e: React.PointerEvent) => {
      isLevelDragging.current = false;
      setLevelTooltip(null);
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  // ── Fade handle drag ─────────────────────────────────────
  const onFadeDown = useCallback(
    (edge: "in" | "out", e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      useProjectStore.getState().snapshotHistory("Adjust Fade");
      isFadeDragging.current = edge;
      fadeStartX.current = e.clientX;
    },
    []
  );

  const onFadeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isFadeDragging.current) return;
      const deltaX = e.clientX - fadeStartX.current;
      const { cssZoomScale: fadeZs } = usePlaybackStore.getState();
      const deltaMicros = Math.round((deltaX / (pixelsPerSecond * fadeZs)) * 1_000_000);
      const store = useProjectStore.getState();
      if (isFadeDragging.current === "in") {
        store.setClipFade(clip.id, "in", Math.max(0, (clip.fadeInDuration ?? 0) + deltaMicros));
      } else {
        store.setClipFade(clip.id, "out", Math.max(0, (clip.fadeOutDuration ?? 0) - deltaMicros));
      }
      fadeStartX.current = e.clientX;
    },
    [clip.id, clip.fadeInDuration, clip.fadeOutDuration, pixelsPerSecond]
  );

  const onFadeUp = useCallback(
    (e: React.PointerEvent) => {
      isFadeDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  // ── Time-stretch handle ──────────────────────────────────
  const onStretchDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      useProjectStore.getState().snapshotHistory("Time Stretch");
      isStretchDragging.current = true;
      edgeStartX.current = e.clientX;
      edgeOrigDuration.current = clip.duration;
    },
    [clip.duration]
  );

  const onStretchMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isStretchDragging.current) return;
      const deltaX = e.clientX - edgeStartX.current;
      const { cssZoomScale: stretchZs } = usePlaybackStore.getState();
      const deltaMicros = Math.round((deltaX / (pixelsPerSecond * stretchZs)) * 1_000_000);
      useProjectStore.getState().timeStretchClip(clip.id, edgeOrigDuration.current + deltaMicros);
    },
    [clip.id, pixelsPerSecond]
  );

  const onStretchUp = useCallback(
    (e: React.PointerEvent) => {
      isStretchDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    []
  );

  // ── Preset DnD drop target ───────────────────────────────
  const isPresetDrag = useCallback((e: React.DragEvent) =>
    e.dataTransfer.types.includes("application/x-synapse-preset"), []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!isPresetDrag(e)) return;
    // Block audio tracks — FX presets cannot apply to audio
    if (track?.type === "audio") { e.dataTransfer.dropEffect = "none"; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, [isPresetDrag, track?.type]);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!isPresetDrag(e)) return;
    e.preventDefault();
    if (track?.type === "audio") return;
    setIsDropTarget(true);
  }, [isPresetDrag, track?.type]);

  const onDragLeave = useCallback(() => {
    setIsDropTarget(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDropTarget(false);
      const raw = e.dataTransfer.getData("application/x-synapse-preset");
      if (!raw) return;
      // Block wrong track type
      if (track?.type === "audio") {
        setDropBlockMsg("Wrong track type");
        setTimeout(() => setDropBlockMsg(null), 2000);
        return;
      }
      try {
        const fxParams = JSON.parse(raw) as Record<string, unknown>;
        const store = useProjectStore.getState();
        store.snapshotHistory("Apply Preset");
        // Shift held → stack (merge) on top of existing params; otherwise replace
        const mode = e.shiftKey ? "merge" : "replace";
        store.updateClipFxParams(clip.id, fxParams, mode);
        store.setSelectedClipIds([clip.id]);
        // Brief pulse to confirm the drop
        setIsPulsing(true);
        setTimeout(() => setIsPulsing(false), 300);
      } catch {
        // ignore malformed drag data
      }
    },
    [clip.id, track?.type]
  );

  return (
    <div
      ref={clipRef}
      className={`absolute top-0 flex h-full cursor-grab select-none items-center overflow-hidden ${isDraggingState ? "" : "transition-transform"} active:cursor-grabbing ${
        isSelected ? "ring-2 ring-white" : isDropTarget ? "ring-2 ring-purple-400" : isPulsing ? "ring-2 ring-purple-300" : ""
      } ${hasLeftNeighbor ? "rounded-r" : hasRightNeighbor ? "rounded-l" : "rounded"}`}
      style={{
        transform: `translate3d(${xPx}px, 0, 0) ${isPulsing ? "scale(1.03)" : ""}`,
        width: wPx,
        backgroundColor: isPulsing ? trackColor + "70" : trackColor + "40",
        ...(hasLeftNeighbor ? {} : { borderLeft: `2px solid ${trackColor}` }),
      }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Preset drop highlight */}
      {isDropTarget && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-purple-500/25">
          <span className="rounded bg-purple-900/80 px-1.5 py-0.5 text-[9px] font-bold text-purple-200">Drop FX · Shift=Stack</span>
        </div>
      )}
      {/* Wrong track type toast */}
      {dropBlockMsg && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-red-500/20">
          <span className="rounded bg-red-900/90 px-1.5 py-0.5 text-[9px] font-bold text-red-200">{dropBlockMsg}</span>
        </div>
      )}
      {/* Filmstrip — only in expanded mode */}
      {!isCollapsed && track?.type === "video" && media?.previewUrl && (
        <ClipFilmstrip clip={clip} media={media} clipWidthPx={wPx} />
      )}

      {/* Waveform — only in expanded mode */}
      {!isCollapsed && track?.type === "audio" && (
        <ClipWaveform sourceId={clip.sourceId} clipWidthPx={wPx} trackHeight={trackHeight} />
      )}

      {/* Auto fade-in gradient (crossfade — no drag handle, just visual) */}
      {fadeInPx > 0 && !clip.manualFadeIn && (
        <div
          className="pointer-events-none absolute left-0 top-0 h-full"
          style={{ width: Math.max(fadeInPx, 4), background: "linear-gradient(to right, rgba(0,0,0,0.55), transparent)" }}
        />
      )}

      {/* Auto fade-out gradient (crossfade — no drag handle) */}
      {fadeOutPx > 0 && !clip.manualFadeOut && (
        <div
          className="pointer-events-none absolute right-0 top-0 h-full"
          style={{ width: Math.max(fadeOutPx, 4), background: "linear-gradient(to left, rgba(0,0,0,0.55), transparent)" }}
        />
      )}

      {/* Manual fade-in triangle (user-set via drag) */}
      {fadeInPx > 0 && clip.manualFadeIn && (
        <svg
          className="absolute top-0 left-0 z-20 h-full cursor-ew-resize"
          style={{ width: Math.max(fadeInPx, 6) }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          onPointerDown={(e) => onFadeDown("in", e)}
          onPointerMove={onFadeMove}
          onPointerUp={onFadeUp}
        >
          <polygon points="0,0 100,100 0,100" fill="rgba(0,0,0,0.5)" />
          <line x1="100" y1="100" x2="0" y2="0" stroke="white" strokeWidth="2" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      {/* Manual fade-out triangle */}
      {fadeOutPx > 0 && clip.manualFadeOut && (
        <svg
          className="absolute top-0 right-0 z-20 h-full cursor-ew-resize"
          style={{ width: Math.max(fadeOutPx, 6) }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          onPointerDown={(e) => onFadeDown("out", e)}
          onPointerMove={onFadeMove}
          onPointerUp={onFadeUp}
        >
          <polygon points="100,0 100,100 0,100" fill="rgba(0,0,0,0.5)" />
          <line x1="0" y1="100" x2="100" y2="0" stroke="white" strokeWidth="2" strokeOpacity="0.4" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      {/* Level line */}
      {!isCollapsed && (
        <div
          className="pointer-events-none absolute left-0 z-10 w-full border-t border-yellow-400/70"
          style={{ top: `${100 - clipLevel}%` }}
        />
      )}

      {/* Level badge */}
      {!isCollapsed && (clipLevel !== 100 || levelTooltip !== null) && (
        <span className="absolute right-1 top-0 z-10 text-[8px] tabular-nums text-yellow-400/80">
          {levelTooltip ?? clipLevel}%
        </span>
      )}

      {/* Label + rate badge — hidden when baked clip is too narrow to read */}
      {!(isBaked && wPx < 80) && (
        <span className="relative z-10 flex items-center gap-1 truncate px-1.5 text-[10px] font-medium text-white/80 drop-shadow-sm">
          {isBaked ? (
            <span className="flex shrink-0 items-center gap-0.5 rounded bg-purple-500/35 px-1 py-px text-[7px] font-bold text-purple-200">
              <Layers size={7} />FX
            </span>
          ) : null}
          <span className="truncate">{label}</span>
          {clip.playbackRate != null && clip.playbackRate !== 1 && (
            <span className="shrink-0 rounded bg-white/20 px-0.5 text-[8px] tabular-nums">
              {Math.round(clip.playbackRate * 100)}%
            </span>
          )}
        </span>
      )}

      {/* Inspector button */}
      {!isCollapsed && (
        <button
          className="absolute right-1 top-1 z-20 rounded p-0.5 text-white/40 transition-colors hover:bg-white/15 hover:text-white"
          aria-label="Clip settings"
          onPointerDown={(e) => {
            e.stopPropagation();
            const store = useProjectStore.getState();
            store.setInspectingClipId(clip.id);
            store.setActiveUISection("inspector");
          }}
        >
          {track?.type === "video" ? <Crop size={12} /> : track?.type === "audio" ? <Volume2 size={12} /> : <Settings size={12} />}
        </button>
      )}

      {/* Top-edge level drag handle */}
      {!isCollapsed && (
        <div
          className="absolute left-0 top-0 z-30 h-2.5 w-full cursor-ns-resize"
          onPointerDown={onLevelDown}
          onPointerMove={onLevelMove}
          onPointerUp={onLevelUp}
        />
      )}

      {/* Edge trim handles */}
      <div
        className="absolute left-0 top-0 z-20 h-full w-2 cursor-ew-resize"
        onPointerDown={(e) => onEdgeDown("left", e)}
        onPointerMove={onEdgeMove}
        onPointerUp={onEdgeUp}
      />
      <div
        className="absolute right-0 top-0 z-20 w-2 cursor-ew-resize"
        style={{ height: isCollapsed ? "100%" : "calc(100% - 10px)" }}
        onPointerDown={(e) => onEdgeDown("right", e)}
        onPointerMove={onEdgeMove}
        onPointerUp={onEdgeUp}
      />

      {/* Bottom-right stretch handle */}
      {!isCollapsed && (
        <div
          className="absolute right-0 bottom-0 z-40 h-2.5 w-2.5 cursor-nwse-resize rounded-tl bg-white/20"
          onPointerDown={onStretchDown}
          onPointerMove={onStretchMove}
          onPointerUp={onStretchUp}
        />
      )}

      {ctxMenu && (
        <ClipContextMenu
          clipId={clip.id}
          trackId={trackId}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
