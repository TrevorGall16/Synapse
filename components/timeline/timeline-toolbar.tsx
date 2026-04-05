"use client";

import { useState, useRef } from "react";
import { Scissors, Unlink, Link, Trash2, Type, Sparkles, Combine, ArrowRightLeft, Music, Settings, Download, X, Globe, FolderX } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { removeMediaFromDB } from "@/lib/store/media-pool-db";
import { usePlaybackStore } from "@/lib/store/playback-store";
import type { ClipEvent } from "@/lib/store/types";
import { ExportModal } from "@/components/studio/export-modal";
import { ProjectSettingsModal } from "@/components/studio/project-settings-modal";
import { PublishModal } from "@/components/studio/publish-modal";

export function TimelineToolbar() {
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const tracks = useProjectStore((s) => s.tracks);
  const rippleMode = usePlaybackStore((s) => s.rippleMode);
  const globalBpm = usePlaybackStore((s) => s.globalBpm);
  const selectionStart = usePlaybackStore((s) => s.selectionStart);
  const clearSelection = usePlaybackStore((s) => s.clearSelection);
  const hasSelection = selectedClipIds.length > 0;
  const projectName = useProjectStore((s) => s.name);
  const setName     = useProjectStore((s) => s.setName);
  const resetProject = useProjectStore((s) => s.resetProject);

  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport]     = useState(false);
  const [showPublish, setShowPublish]   = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmHeal, setConfirmHeal] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const handleDeleteProject = () => {
    const { mediaPool } = useProjectStore.getState();
    mediaPool.forEach((m) => removeMediaFromDB(m.id).catch(console.warn));
    resetProject();
    setConfirmDelete(false);
  };

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
    if (selectedClipIds.length > 1) setConfirmHeal(true);
  };

  const onHealConfirmed = () => {
    const { selectedClipIds: ids, joinClips } = useProjectStore.getState();
    if (ids.length > 1) joinClips(ids);
    setConfirmHeal(false);
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
      {/* Delete-project confirmation banner */}
      {confirmDelete && (
        <div className="absolute inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b border-red-500/30 bg-red-950/80 px-4 py-2 backdrop-blur-sm">
          <span className="text-[11px] font-semibold text-red-300">Delete project and all media from disk?</span>
          <button onClick={handleDeleteProject} className="rounded bg-red-500/30 px-2.5 py-1 text-[10px] font-bold text-red-300 hover:bg-red-500/50">Delete</button>
          <button onClick={() => setConfirmDelete(false)} className="rounded border border-white/15 px-2.5 py-1 text-[10px] text-white/50 hover:bg-white/8">Cancel</button>
        </div>
      )}
      {/* Heal confirmation banner */}
      {confirmHeal && (
        <div className="absolute inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-b border-amber-500/30 bg-amber-950/80 px-4 py-2 backdrop-blur-sm">
          <span className="text-[11px] font-semibold text-amber-300">Heal selected clips into one? This cannot be undone.</span>
          <button onClick={onHealConfirmed} className="rounded bg-amber-500/30 px-2.5 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/50">Heal</button>
          <button onClick={() => setConfirmHeal(false)} className="rounded border border-white/15 px-2.5 py-1 text-[10px] text-white/50 hover:bg-white/8">Cancel</button>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2">
        {/* Project name input */}
        <input ref={nameRef} type="text" value={projectName} onChange={(e) => setName(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()} placeholder="Untitled Project"
          className="mr-1 w-32 truncate rounded bg-transparent px-1.5 py-0.5 text-[11px] font-semibold text-white/70 outline-none ring-1 ring-transparent transition-all hover:ring-white/15 focus:bg-white/5 focus:ring-white/25 focus:text-white"
        />
        <button onClick={() => setConfirmDelete(true)} title="Delete Project" aria-label="Delete Project"
          className="mr-1 rounded p-1.5 text-white/30 transition-colors hover:bg-red-500/15 hover:text-red-400 focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-none">
          <FolderX size={14} />
        </button>
        <div className="mx-0.5 h-4 w-px bg-white/10" />
        <Btn icon={<Scissors size={16} />} label="Split (S)" disabled={!hasSelection} onClick={onSplit} />
        <Btn icon={<Unlink size={16} />} label="Ungroup (U)" disabled={!hasSelection} onClick={onUngroup} />
        <Btn icon={<Link size={16} />} label="Regroup (G)" disabled={selectedClipIds.length < 2} onClick={onRegroup} />
        <Btn icon={<Trash2 size={16} />} label="Delete (Del)" disabled={!hasSelection} onClick={onDelete} />
        <Btn icon={<Combine size={16} />} label="Heal (H)" disabled={selectedClipIds.length < 2} onClick={onHeal} />

        <div className="mx-1 h-4 w-px bg-white/10" />

        <Btn icon={<Type size={16} />} label="Add Text" onClick={onAddText} />
        <Btn icon={<Sparkles size={16} />} label="Add FX" onClick={onAddFx} />

        <div className="mx-1 h-4 w-px bg-white/10" />

        <button
          onClick={() => usePlaybackStore.getState().toggleRippleMode()}
          title={`Ripple Edit ${rippleMode ? "(On)" : "(Off)"}`} aria-label="Ripple Edit"
          className={`rounded p-1.5 transition-colors focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-none ${rippleMode ? "bg-orange-500/20 text-orange-400" : "text-white/50 hover:bg-white/10 hover:text-white active:bg-white/15"}`}
        >
          <ArrowRightLeft size={14} />
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
          className="ml-1 rounded p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-none">
          <Settings size={14} />
        </button>

        {/* Clear selection */}
        {selectionStart != null && (
          <button onClick={clearSelection} title="Clear Selection" aria-label="Clear Selection"
            className="ml-1 rounded p-1.5 text-blue-400/70 transition-colors hover:bg-white/10 hover:text-blue-400 focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-none">
            <X size={14} />
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
        <button data-testid="export-btn" onClick={() => setShowExport(true)} title="Export Project" aria-label="Export Project"
          className="rounded p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:outline-none">
          <Download size={14} />
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
      className={`rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none ${disabled ? "cursor-not-allowed text-white/20" : "text-white/50 hover:bg-white/10 hover:text-white active:bg-white/20"}`}>
      {icon}
    </button>
  );
}
