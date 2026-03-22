"use client";

import { useState } from "react";
import { Scissors, Unlink, Link, Trash2, Type, Sparkles, Combine, ArrowRightLeft, Music, Settings, Download, X, Globe } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import type { ClipEvent } from "@/lib/store/types";
import { ExportModal } from "@/components/studio/export-modal";
import { ProjectSettingsModal } from "@/components/studio/project-settings-modal";
import { PublishModal } from "@/components/studio/publish-modal";


export function TimelineToolbar() {
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const rippleMode = usePlaybackStore((s) => s.rippleMode);
  const globalBpm = usePlaybackStore((s) => s.globalBpm);
  const selectionStart = usePlaybackStore((s) => s.selectionStart);
  const clearSelection = usePlaybackStore((s) => s.clearSelection);
  const hasSelection = selectedClipIds.length > 0;

  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport]     = useState(false);
  const [showPublish, setShowPublish]   = useState(false);

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
    const clip: ClipEvent = { id: crypto.randomUUID(), trackId: textTrack.id, sourceId: "text-generator", startTime: playheadPosition, duration: 5_000_000, mediaOffset: 0 };
    addClip(textTrack.id, clip);
  };

  const onAddFx = () => {
    const { tracks, addClip } = useProjectStore.getState();
    const { playheadPosition } = usePlaybackStore.getState();
    const fxTrack = tracks.find((t) => t.type === "effect");
    if (!fxTrack) return;
    const clip: ClipEvent = { id: crypto.randomUUID(), trackId: fxTrack.id, sourceId: "fx-generator", startTime: playheadPosition, duration: 5_000_000, mediaOffset: 0 };
    addClip(fxTrack.id, clip);
  };

  return (
    <>
      <div className="flex items-center gap-0.5 px-2">
        <Btn icon={<Scissors size={12} />} label="Split (S)" disabled={!hasSelection} onClick={onSplit} />
        <Btn icon={<Unlink size={12} />} label="Ungroup (U)" disabled={!hasSelection} onClick={onUngroup} />
        <Btn icon={<Link size={12} />} label="Regroup (G)" disabled={selectedClipIds.length < 2} onClick={onRegroup} />
        <Btn icon={<Trash2 size={12} />} label="Delete (Del)" disabled={!hasSelection} onClick={onDelete} />
        <Btn icon={<Combine size={12} />} label="Heal (H)" disabled={selectedClipIds.length < 2} onClick={onHeal} />

        <div className="mx-1 h-4 w-px bg-white/10" />

        <Btn icon={<Type size={12} />} label="Add Text" onClick={onAddText} />
        <Btn icon={<Sparkles size={12} />} label="Add FX" onClick={onAddFx} />

        <div className="mx-1 h-4 w-px bg-white/10" />

        <button
          onClick={() => usePlaybackStore.getState().toggleRippleMode()}
          title={`Ripple Edit ${rippleMode ? "(On)" : "(Off)"}`} aria-label="Ripple Edit"
          className={`rounded p-1 transition-colors ${rippleMode ? "bg-orange-500/20 text-orange-400" : "text-white/50 hover:bg-white/10 hover:text-white"}`}
        >
          <ArrowRightLeft size={12} />
        </button>

        <div className="mx-1 h-4 w-px bg-white/10" />

        {/* BPM */}
        <div className="flex items-center gap-1">
          <Music size={10} className="text-purple-400/70" />
          <input type="number" min={20} max={300} value={globalBpm}
            onChange={(e) => usePlaybackStore.getState().setGlobalBpm(Number(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()} aria-label="BPM" title="BPM"
            className="w-10 rounded bg-white/10 px-1 py-0.5 text-center text-[10px] tabular-nums text-white/70 outline-none hover:bg-white/15 focus:ring-1 focus:ring-purple-400/40" />
          <span className="text-[9px] text-white/30">BPM</span>
        </div>

        {/* Project Settings gear — opens full modal */}
        <button onClick={() => setShowSettings(true)} title="Project Settings" aria-label="Project Settings"
          className="ml-1 rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white">
          <Settings size={12} />
        </button>

        {/* Clear selection */}
        {selectionStart != null && (
          <button onClick={clearSelection} title="Clear Selection" aria-label="Clear Selection"
            className="ml-1 rounded p-1 text-blue-400/70 transition-colors hover:bg-white/10 hover:text-blue-400">
            <X size={12} />
          </button>
        )}

        {/* Publish */}
        <button
          onClick={() => setShowPublish(true)}
          title="Publish to Feed"
          aria-label="Publish to Feed"
          className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 hover:text-purple-200"
        >
          <Globe size={10} />Publish
        </button>

        {/* Export */}
        <button onClick={() => setShowExport(true)} title="Export Project" aria-label="Export Project"
          className="rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white">
          <Download size={12} />
        </button>
      </div>

      {showSettings && <ProjectSettingsModal onClose={() => setShowSettings(false)} />}
      {showExport   && <ExportModal   onClose={() => setShowExport(false)} />}
      {showPublish  && <PublishModal  onClose={() => setShowPublish(false)} />}
    </>
  );
}

function Btn({ icon, label, disabled = false, onClick }: { icon: React.ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`rounded p-1 transition-colors ${disabled ? "cursor-not-allowed text-white/20" : "text-white/50 hover:bg-white/10 hover:text-white"}`}>
      {icon}
    </button>
  );
}
