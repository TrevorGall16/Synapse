"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { useProjectsRegistry } from "@/lib/store/projects-registry";

interface FocusedBreadcrumbProps {
  onNavigateDashboard: () => void;
}

export function FocusedBreadcrumb({ onNavigateDashboard }: FocusedBreadcrumbProps) {
  const name = useProjectStore((s) => s.name);
  const setName = useProjectStore((s) => s.setName);
  const projectId = useProjectStore((s) => s.projectId);
  const updateRegistry = useProjectsRegistry((s) => s.updateProject);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seed editValue when entering edit mode is handled in the onClick that sets
  // editing=true (see below). The effect below only runs the DOM side-effect
  // (select text) — no setState — so it no longer trips set-state-in-effect.
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      setName(trimmed);
      if (projectId) updateRegistry(projectId, { name: trimmed, lastEdited: Date.now() });
    }
    setEditing(false);
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-white/10 bg-[#161616] px-3">
      <button
        onClick={onNavigateDashboard}
        className="text-[11px] font-semibold text-white/40 transition-colors hover:text-brand-text"
      >
        Studio Dashboard
      </button>
      <ChevronRight size={11} className="text-white/20" />

      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={commitRename}
          className="rounded border border-brand-accent/40 bg-white/6 px-2 py-0.5 text-[11px] font-semibold text-white outline-none"
        />
      ) : (
        <button
          onClick={() => {
            setEditValue(name);
            setEditing(true);
          }}
          className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-white/8"
        >
          <span className="text-[11px] font-semibold text-white/80">{name}</span>
          <Pencil size={9} className="text-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}
