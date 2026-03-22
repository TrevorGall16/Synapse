"use client";

import { useProjectStore } from "@/lib/store/project-store";
import { RotateCcw, RotateCw } from "lucide-react";

export function HistoryPanel() {
  const historyPast = useProjectStore((s) => s.historyPast);
  const historyFuture = useProjectStore((s) => s.historyFuture);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  const canUndo = historyPast.length > 0;
  const canRedo = historyFuture.length > 0;

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a] text-white">
      {/* Undo/Redo buttons */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-30 enabled:hover:bg-white/10"
          aria-label="Undo"
        >
          <RotateCcw size={11} />
          Undo
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-30 enabled:hover:bg-white/10"
          aria-label="Redo"
        >
          <RotateCw size={11} />
          Redo
        </button>
        <span className="ml-auto text-[9px] text-white/30">
          {historyPast.length} / 50
        </span>
      </div>

      {/* History list */}
      <div className="flex-1 overflow-y-auto">
        {historyPast.length === 0 && historyFuture.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-[10px] text-white/25">No history yet</span>
          </div>
        ) : (
          <ul className="py-1">
            {/* Future stack (grayed — can be redone) */}
            {[...historyFuture].reverse().map((snap, i) => (
              <li
                key={`future-${i}`}
                className="flex items-center gap-2 px-3 py-1 text-[10px] text-white/25"
              >
                <RotateCw size={9} className="shrink-0" />
                <span className="truncate">{snap.label}</span>
              </li>
            ))}

            {/* Current state marker */}
            <li className="flex items-center gap-2 border-y border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold text-white/70">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
              Current State
            </li>

            {/* Past stack (most recent first) */}
            {[...historyPast].reverse().map((snap, i) => (
              <li
                key={`past-${i}`}
                className="flex items-center gap-2 px-3 py-1 text-[10px] text-white/45 transition-colors hover:bg-white/5"
              >
                <RotateCcw size={9} className="shrink-0 text-white/25" />
                <span className="truncate">{snap.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Keyboard hint */}
      <div className="shrink-0 border-t border-white/10 px-3 py-1.5">
        <p className="text-[9px] text-white/20">
          <kbd className="rounded bg-white/10 px-1 py-px font-mono">Ctrl+Z</kbd> Undo
          &nbsp;·&nbsp;
          <kbd className="rounded bg-white/10 px-1 py-px font-mono">Ctrl+Y</kbd> Redo
        </p>
      </div>
    </div>
  );
}
