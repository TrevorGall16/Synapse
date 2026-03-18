"use client";

import { useState } from "react";
import { Scissors, Unlink, Link, Trash2, Type, Sparkles, Combine, ArrowRightLeft, Music, Settings, Download, X } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import type { ClipEvent } from "@/lib/store/types";
import { ExportModal } from "@/components/studio/export-modal";


export function TimelineToolbar() {
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const rippleMode = usePlaybackStore((s) => s.rippleMode);
  const globalBpm = usePlaybackStore((s) => s.globalBpm);
  const selectionStart = usePlaybackStore((s) => s.selectionStart);
  const clearSelection = usePlaybackStore((s) => s.clearSelection);
  const projectResolution = useProjectStore((s) => s.projectResolution);
  const projectFps = useProjectStore((s) => s.projectFps);
  const setProjectResolution = useProjectStore((s) => s.setProjectResolution);
  const setProjectFps = useProjectStore((s) => s.setProjectFps);
  const hasSelection = selectedClipIds.length > 0;

  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);

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
    <>
      <div className="flex items-center gap-0.5 px-2">
        <ToolbarButton icon={<Scissors size={12} />} label="Split (S)" disabled={!hasSelection} onClick={onSplit} />
        <ToolbarButton icon={<Unlink size={12} />} label="Ungroup (U)" disabled={!hasSelection} onClick={onUngroup} />
        <ToolbarButton icon={<Link size={12} />} label="Regroup (G)" disabled={selectedClipIds.length < 2} onClick={onRegroup} />
        <ToolbarButton icon={<Trash2 size={12} />} label="Delete (Del)" disabled={!hasSelection} onClick={onDelete} />
        <ToolbarButton icon={<Combine size={12} />} label="Heal (H)" disabled={selectedClipIds.length < 2} onClick={onHeal} />

        <div className="mx-1 h-4 w-px bg-white/10" />

        <ToolbarButton icon={<Type size={12} />} label="Add Text" disabled={false} onClick={onAddText} />
        <ToolbarButton icon={<Sparkles size={12} />} label="Add FX" disabled={false} onClick={onAddFx} />

        <div className="mx-1 h-4 w-px bg-white/10" />

        <button
          onClick={() => usePlaybackStore.getState().toggleRippleMode()}
          aria-label="Ripple Edit"
          title={`Ripple Edit ${rippleMode ? "(On)" : "(Off)"}`}
          className={`rounded p-1 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
            rippleMode ? "bg-orange-500/20 text-orange-400" : "text-white/50 hover:bg-white/10 hover:text-white"
          }`}
        >
          <ArrowRightLeft size={12} />
        </button>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* BPM input */}
        <div className="flex items-center gap-1">
          <Music size={10} className="text-purple-400/70" />
          <input
            type="number" min={20} max={300} value={globalBpm}
            onChange={(e) => usePlaybackStore.getState().setGlobalBpm(Number(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="BPM" title="BPM (beats per minute)"
            className="w-10 rounded bg-white/10 px-1 py-0.5 text-center text-[10px] tabular-nums text-white/70 outline-none transition-colors hover:bg-white/15 focus:ring-1 focus:ring-purple-400/40"
          />
          <span className="text-[9px] text-white/30">BPM</span>
        </div>

        {/* Settings gear */}
        <div className="relative ml-1">
          <button
            onClick={() => setShowSettings((v) => !v)}
            aria-label="Project Settings"
            title="Project Settings"
            className={`rounded p-1 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
              showSettings ? "bg-white/15 text-white" : "text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Settings size={12} />
          </button>
          {showSettings && (
            <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[180px] rounded border border-white/10 bg-[#242424] p-3 shadow-xl">
              <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-white/40">Project Settings</div>
              <label className="mb-2 flex flex-col gap-1">
                <span className="text-[10px] font-medium text-white/50">Resolution</span>
                <select
                  value={projectResolution}
                  onChange={(e) => setProjectResolution(e.target.value as "1080p" | "4k" | "vertical")}
                  className="rounded bg-white/10 px-2 py-1 text-xs text-white outline-none"
                >
                  <option value="1080p" className="text-black">1080p (16:9)</option>
                  <option value="4k" className="text-black">4K (16:9)</option>
                  <option value="vertical" className="text-black">Vertical (TikTok/Reels)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-white/50">Frame Rate</span>
                <select
                  value={projectFps}
                  onChange={(e) => setProjectFps(Number(e.target.value) as 24 | 30 | 60)}
                  className="rounded bg-white/10 px-2 py-1 text-xs text-white outline-none"
                >
                  <option value={24} className="text-black">24 fps</option>
                  <option value={30} className="text-black">30 fps</option>
                  <option value={60} className="text-black">60 fps</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {/* Clear Selection */}
        {selectionStart != null && (
          <button
            onClick={clearSelection}
            aria-label="Clear Selection"
            title="Clear Selection"
            className="ml-1 rounded p-1 text-blue-400/70 transition-colors hover:bg-white/10 hover:text-blue-400"
          >
            <X size={12} />
          </button>
        )}

        {/* Export button — right side */}
        <button
          onClick={() => setShowExport(true)}
          aria-label="Export"
          title="Export Project"
          className="ml-auto rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Download size={12} />
        </button>
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </>
  );
}

function ToolbarButton({
  icon, label, disabled, onClick,
}: {
  icon: React.ReactNode; label: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`rounded p-1 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 ${
        disabled ? "cursor-not-allowed text-white/20" : "text-white/50 hover:bg-white/10 hover:text-white"
      }`}
    >
      {icon}
    </button>
  );
}
