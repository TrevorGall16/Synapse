"use client";

import { Scissors, Unlink, Link, Trash2, Type, Sparkles, Combine, ArrowRightLeft, Music } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import type { ClipEvent } from "@/lib/store/types";


export function TimelineToolbar() {
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const rippleMode = usePlaybackStore((s) => s.rippleMode);
  const globalBpm = usePlaybackStore((s) => s.globalBpm);
  const hasSelection = selectedClipIds.length > 0;

  const onSplit = () => {
    const { playheadPosition } = usePlaybackStore.getState();
    const { selectedClipIds: ids, splitSelectedClips } = useProjectStore.getState();
    if (ids.length > 0) splitSelectedClips(ids, playheadPosition);
  };

  const onUngroup = () => {
    const { selectedClipIds: ids, ungroupClips } = useProjectStore.getState();
    if (ids.length > 0) ungroupClips(ids);
  };

  const onRegroup = () => {
    const { selectedClipIds: ids, groupClips } = useProjectStore.getState();
    if (ids.length > 1) groupClips(ids);
  };

  const onDelete = () => {
    const { selectedClipIds: ids, deleteSelectedClips } = useProjectStore.getState();
    if (ids.length > 0) deleteSelectedClips(ids);
  };

  const onHeal = () => {
    const { selectedClipIds: ids, joinClips } = useProjectStore.getState();
    if (ids.length > 1) joinClips(ids);
  };

  const onAddText = () => {
    const { tracks, addClip } = useProjectStore.getState();
    const { playheadPosition } = usePlaybackStore.getState();
    const textTrack = tracks.find((t) => t.type === "text");
    if (!textTrack) return;
    const clip: ClipEvent = {
      id: crypto.randomUUID(),
      trackId: textTrack.id,
      sourceId: "text-generator",
      startTime: playheadPosition,
      duration: 5_000_000,
      mediaOffset: 0,
    };
    addClip(textTrack.id, clip);
  };

  const onAddFx = () => {
    const { tracks, addClip } = useProjectStore.getState();
    const { playheadPosition } = usePlaybackStore.getState();
    const fxTrack = tracks.find((t) => t.type === "effect");
    if (!fxTrack) return;
    const clip: ClipEvent = {
      id: crypto.randomUUID(),
      trackId: fxTrack.id,
      sourceId: "fx-generator",
      startTime: playheadPosition,
      duration: 5_000_000,
      mediaOffset: 0,
    };
    addClip(fxTrack.id, clip);
  };

  return (
    <div className="flex items-center gap-0.5 px-2">
      <ToolbarButton
        icon={<Scissors size={12} />}
        label="Split (S)"
        disabled={!hasSelection}
        onClick={onSplit}
      />
      <ToolbarButton
        icon={<Unlink size={12} />}
        label="Ungroup (U)"
        disabled={!hasSelection}
        onClick={onUngroup}
      />
      <ToolbarButton
        icon={<Link size={12} />}
        label="Regroup (G)"
        disabled={selectedClipIds.length < 2}
        onClick={onRegroup}
      />
      <ToolbarButton
        icon={<Trash2 size={12} />}
        label="Delete (Del)"
        disabled={!hasSelection}
        onClick={onDelete}
      />

      <ToolbarButton
        icon={<Combine size={12} />}
        label="Heal (H)"
        disabled={selectedClipIds.length < 2}
        onClick={onHeal}
      />

      <div className="mx-1 h-4 w-px bg-white/10" />

      <ToolbarButton
        icon={<Type size={12} />}
        label="Add Text"
        disabled={false}
        onClick={onAddText}
      />
      <ToolbarButton
        icon={<Sparkles size={12} />}
        label="Add FX"
        disabled={false}
        onClick={onAddFx}
      />

      <div className="mx-1 h-4 w-px bg-white/10" />

      <button
        onClick={() => usePlaybackStore.getState().toggleRippleMode()}
        aria-label="Ripple Edit"
        title={`Ripple Edit ${rippleMode ? "(On)" : "(Off)"}`}
        className={`rounded p-1 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
          rippleMode
            ? "bg-orange-500/20 text-orange-400"
            : "text-white/50 hover:bg-white/10 hover:text-white"
        }`}
      >
        <ArrowRightLeft size={12} />
      </button>

      <div className="mx-1 h-4 w-px bg-white/10" />

      {/* BPM input */}
      <div className="flex items-center gap-1">
        <Music size={10} className="text-purple-400/70" />
        <input
          type="number"
          min={20}
          max={300}
          value={globalBpm}
          onChange={(e) => usePlaybackStore.getState().setGlobalBpm(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="BPM"
          title="BPM (beats per minute)"
          className="w-10 rounded bg-white/10 px-1 py-0.5 text-center text-[10px] tabular-nums text-white/70 outline-none transition-colors hover:bg-white/15 focus:ring-1 focus:ring-purple-400/40"
        />
        <span className="text-[9px] text-white/30">BPM</span>
      </div>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded p-1 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
        disabled
          ? "text-white/20 cursor-not-allowed"
          : "text-white/50 hover:bg-white/10 hover:text-white"
      }`}
    >
      {icon}
    </button>
  );
}
