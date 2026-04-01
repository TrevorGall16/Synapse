"use client";

import { useEffect, useRef, useState } from "react";
import { Scissors, Copy, Trash2, VolumeX, Volume2, Layers, RotateCcw } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { canRestoreOriginal } from "@/lib/store/project-helpers";

interface ClipContextMenuProps {
  clipId: string;
  trackId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function ClipContextMenu({ clipId, trackId, x, y, onClose }: ClipContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);

  // Clamp to viewport so menu never overflows
  const clampedX = Math.min(x, (typeof window !== "undefined" ? window.innerWidth : 1920) - 180);
  const clampedY = Math.min(y, (typeof window !== "undefined" ? window.innerHeight : 1080) - 200);

  const run = (fn: () => void) => { fn(); onClose(); };

  const store = useProjectStore.getState;
  const selectedClipIdsReactive = useProjectStore((s) => s.selectedClipIds);
  const allTracksReactive = useProjectStore((s) => s.tracks);
  const mediaPoolReactive = useProjectStore((s) => s.mediaPool);

  const onSplit = () => run(() => {
    const { playheadPosition } = usePlaybackStore.getState();
    store().splitSelectedClips([clipId], playheadPosition);
  });

  const onDuplicate = () => run(() => {
    const s = store();
    let clip;
    for (const t of s.tracks) {
      clip = t.clips.find((c) => c.id === clipId);
      if (clip) break;
    }
    if (!clip) return;
    s.addClip(trackId, {
      ...clip,
      id: crypto.randomUUID(),
      groupId: undefined,
      startTime: clip.startTime + clip.duration,
    });
  });

  const onDelete = () => run(() => store().deleteSelectedClips([clipId]));

  const onToggleMute = () => run(() => store().toggleMute(trackId));

  const onInspect = () => run(() => {
    const s = store();
    s.setInspectingClipId(clipId);
    s.setActiveUISection("inspector");
  });

  const isMuted = allTracksReactive.find((t) => t.id === trackId)?.isMuted ?? false;

  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);

  // Restore Original — only available when full selection shares one sourceId and one trackId
  const selectedClips = allTracksReactive.flatMap((t) => t.clips).filter((c) => selectedClipIdsReactive.includes(c.id));
  const canRestore = canRestoreOriginal(selectedClipIdsReactive, allTracksReactive);

  // Compute human-readable bounds for the confirmation message
  const restoreMediaName = (() => {
    if (!canRestore) return "";
    const media = mediaPoolReactive.find((m) => m.id === selectedClips[0].sourceId);
    return media?.name ?? selectedClips[0].sourceId;
  })();

  const formatTimeSec = (us: number) => `${(us / 1_000_000).toFixed(2)}s`;
  const restoreEarliest = canRestore ? Math.min(...selectedClips.map((c) => c.startTime)) : 0;
  const restoreLatest = canRestore
    ? Math.max(...selectedClips.map((c) => c.startTime + c.duration))
    : 0;

  const onRestoreConfirmed = () => {
    useProjectStore.getState().restoreOriginalClips(selectedClips.map((c) => c.id));
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] w-44 overflow-hidden rounded-lg border border-white/15 bg-[#1e1e1e] py-1 shadow-2xl shadow-black/60"
      style={{ left: clampedX, top: clampedY }}
    >
      <MenuItem icon={<Scissors size={11} />} label="Split at Playhead" onClick={onSplit} />
      <MenuItem icon={<Copy size={11} />}     label="Duplicate"         onClick={onDuplicate} />
      <div className="my-1 h-px bg-white/8" />
      <MenuItem
        icon={isMuted ? <Volume2 size={11} /> : <VolumeX size={11} />}
        label={isMuted ? "Unmute Track" : "Mute Track"}
        onClick={onToggleMute}
      />
      <MenuItem icon={<Layers size={11} />} label="Inspect Clip" onClick={onInspect} />
      {canRestore && (
        <>
          <div className="my-1 h-px bg-white/8" />
          <MenuItem
            icon={<RotateCcw size={11} />}
            label="Restore Original"
            onClick={() => setShowRestoreConfirm(true)}
          />
        </>
      )}
      <div className="my-1 h-px bg-white/8" />
      <MenuItem icon={<Trash2 size={11} />} label="Delete" onClick={onDelete} danger />

      {showRestoreConfirm && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60">
          <div className="w-80 rounded-xl border border-white/15 bg-[#1e1e1e] p-5 shadow-2xl shadow-black/80">
            <p className="mb-1 text-[13px] font-semibold text-white">Restore Original Clip</p>
            <p className="mb-4 text-[11px] leading-relaxed text-white/60">
              Revert <span className="font-medium text-white/80">{selectedClips.length} fragment{selectedClips.length !== 1 ? "s" : ""}</span> of{" "}
              <span className="font-medium text-white/80">&apos;{restoreMediaName}&apos;</span> between{" "}
              <span className="tabular-nums text-white/80">{formatTimeSec(restoreEarliest)}</span> –{" "}
              <span className="tabular-nums text-white/80">{formatTimeSec(restoreLatest)}</span> to one uncut clip?
              All cuts and edits within this range will be removed.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRestoreConfirm(false)}
                className="rounded-md px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={onRestoreConfirmed}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-500"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon, label, onClick, danger = false,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[11px] transition-colors ${
        danger
          ? "text-red-400/80 hover:bg-red-500/15 hover:text-red-400"
          : "text-white/60 hover:bg-white/8 hover:text-white"
      }`}
    >
      <span className="shrink-0 opacity-70">{icon}</span>
      {label}
    </button>
  );
}
