"use client";

import { useEffect, useRef } from "react";
import { Scissors, Copy, Trash2, VolumeX, Volume2, Layers } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";

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
  const clampedX = Math.min(x, window.innerWidth - 180);
  const clampedY = Math.min(y, window.innerHeight - 200);

  const run = (fn: () => void) => { fn(); onClose(); };

  const store = useProjectStore.getState;

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

  const track = useProjectStore.getState().tracks.find((t) => t.id === trackId);
  const isMuted = track?.isMuted ?? false;

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
      <div className="my-1 h-px bg-white/8" />
      <MenuItem icon={<Trash2 size={11} />} label="Delete" onClick={onDelete} danger />
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
