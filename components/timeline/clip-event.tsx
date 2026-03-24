"use client";

import { useRef, useCallback, useState } from "react";
import type { ClipEvent } from "@/lib/store/types";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { Settings, Crop, Volume2, Layers } from "lucide-react";
import { ClipFilmstrip } from "./clip-filmstrip";
import { ClipWaveform } from "./clip-waveform";
import { ClipContextMenu } from "./clip-context-menu";
import { snapToNearby } from "@/lib/utils/snap";

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

  const isDragging = useRef(false);
  const hardSnapLock = useRef<number | null>(null); // micros of current hard-snap position
  // Virtual-position anchors — set once at mousedown, NEVER advanced during drag.
  // virtualTime = dragAnchorTime + (e.clientX - dragAnchorX) / pps * 1e6
  // This gives the total accumulated displacement, so the hard-wall break correctly
  // fires after 20px of cumulative leftward movement (not just per-frame delta).
  const dragAnchorX    = useRef(0);
  const dragAnchorTime = useRef(0);
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

  const xPx = (clip.startTime / 1_000_000) * pixelsPerSecond;
  const wPx = (clip.duration / 1_000_000) * pixelsPerSecond;
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

      const rect = e.currentTarget.getBoundingClientRect();
      const clickTime = clip.startTime + Math.round(((e.clientX - rect.left) / pixelsPerSecond) * 1_000_000);
      usePlaybackStore.getState().setPlayhead(clickTime);

      e.currentTarget.setPointerCapture(e.pointerId);
      isDragging.current = true;
      accumY.current = 0;
      hardSnapLock.current = null;
      // Fix the virtual-position anchors at mousedown — never changed during drag
      dragAnchorX.current    = e.clientX;
      dragAnchorTime.current = clip.startTime;
      lastClientX.current    = e.clientX;
    },
    [clip.id, clip.groupId, clip.startTime, trackId, pixelsPerSecond]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;

      // ── Speed detection via stable manual delta (e.movementX is unreliable during snaps) ──
      const speed = Math.abs(e.clientX - lastClientX.current);
      lastClientX.current = e.clientX;

      // ── Virtual position: total delta from mousedown anchors ──────────────────
      // This is the key fix for the "kinky/frozen" drag:
      // Old code used per-frame delta (startPos.x advances every frame), so when snapped,
      // targetTime was always "snapPos ± 2px" — the 20px wall could never break.
      // New code uses TOTAL accumulated displacement from the fixed mousedown anchor,
      // so after dragging 21px left past the snap, virtualTime is 21px past it and the wall breaks.
      const totalDeltaX = e.clientX - dragAnchorX.current;
      const virtualTime = Math.max(0, dragAnchorTime.current + Math.round((totalDeltaX / pixelsPerSecond) * 1_000_000));

      let newStart: number;

      if (speed > SNAP_BREAK_PX) {
        // Fast drag: break all magnets, follow mouse immediately
        hardSnapLock.current = null;
        newStart = virtualTime;
        usePlaybackStore.getState().setSnapIndicator(null);
      } else if (hardSnapLock.current !== null) {
        // Hard wall active — check if virtualTime has moved outside the protective zone:
        //   LEFT  (overlap territory): 20px wall — must push 20px past snap to open crossfade
        //   RIGHT (natural escape):     8px catch — releases cleanly with no lag
        const offsetPx = ((virtualTime - hardSnapLock.current) / 1_000_000) * pixelsPerSecond;
        if (offsetPx < -HARD_WALL_LEFT_PX) {
          hardSnapLock.current = null;
          newStart = virtualTime;
          usePlaybackStore.getState().setSnapIndicator(null);
        } else if (offsetPx > HARD_WALL_RIGHT_PX) {
          hardSnapLock.current = null;
          newStart = virtualTime;
          usePlaybackStore.getState().setSnapIndicator(null);
        } else {
          // In zone: hold clip exactly at snap edge (zero overlap guaranteed)
          newStart = hardSnapLock.current;
          usePlaybackStore.getState().setSnapIndicator(hardSnapLock.current, true);
        }
      } else {
        const result = snapToNearby(virtualTime, pixelsPerSecond, clip.id);
        newStart = result.time;
        if (result.isHard && result.time !== virtualTime) {
          hardSnapLock.current = result.time;
        }
      }

      const deltaTime = newStart - clip.startTime;
      accumY.current += e.movementY;
      const trackJumps = Math.trunc(accumY.current / trackHeight);

      if (deltaTime !== 0 || trackJumps !== 0) {
        useProjectStore.getState().moveClip(clip.id, deltaTime, trackJumps);
        // No startPos update needed — virtualTime uses fixed dragAnchorX/dragAnchorTime,
        // so deltaTime is always derived from clip.startTime (current store value) correctly.
        if (trackJumps !== 0) accumY.current -= trackJumps * trackHeight;
      }
    },
    [clip.id, clip.startTime, pixelsPerSecond, trackHeight]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = false;
      hardSnapLock.current = null;
      accumY.current = 0;
      e.currentTarget.releasePointerCapture(e.pointerId);
      usePlaybackStore.getState().setSnapIndicator(null);
    },
    []
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
      const rawDelta = Math.round((deltaX / pixelsPerSecond) * 1_000_000);
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
      const deltaMicros = Math.round((deltaX / pixelsPerSecond) * 1_000_000);
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
      const deltaMicros = Math.round((deltaX / pixelsPerSecond) * 1_000_000);
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
      className={`absolute top-0 flex h-full cursor-grab select-none items-center overflow-hidden transition-transform active:cursor-grabbing ${
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
