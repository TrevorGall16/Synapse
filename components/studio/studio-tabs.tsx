"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { ProjectSettingsModal } from "./project-settings-modal";

export function StudioTabs() {
  const [showNewProject, setShowNewProject] = useState(false);

  const projectId      = useProjectStore((s) => s.projectId);
  const activeName     = useProjectStore((s) => s.name);
  const openProjectIds = useProjectStore((s) => s.openProjectIds);
  const savedProjects  = useProjectStore((s) => s.savedProjects);
  const switchTab      = useProjectStore((s) => s.switchTab);
  const closeTab       = useProjectStore((s) => s.closeTab);
  const openNewTab     = useProjectStore((s) => s.openNewTab);

  // Fall back to current project if openProjectIds hasn't been populated yet (migration)
  const effectiveIds = openProjectIds.length > 0 ? openProjectIds : (projectId ? [projectId] : []);

  const tabs = effectiveIds.map((id) => ({
    id,
    name: id === projectId ? activeName : (savedProjects[id]?.name ?? "Untitled"),
    active: id === projectId,
  }));

  if (tabs.length === 0) return null;

  return (
    <>
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-white/10 bg-[#161616] scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`group flex shrink-0 items-center gap-1.5 border-r border-white/8 px-3 text-[11px] font-semibold transition-colors ${
              tab.active
                ? "border-b-2 border-b-purple-400/80 bg-[#1e1e1e] text-white/90"
                : "text-white/35 hover:bg-white/5 hover:text-white/65"
            }`}
          >
            <span className="max-w-[120px] truncate">{tab.name}</span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="flex h-4 w-4 items-center justify-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-white/15"
            >
              <X size={9} />
            </span>
          </button>
        ))}
        <button
          onClick={() => { openNewTab(); setShowNewProject(true); }}
          className="flex h-full shrink-0 items-center px-2.5 text-white/25 transition-colors hover:bg-white/5 hover:text-white/60"
          title="New project tab"
        >
          <Plus size={13} />
        </button>
      </div>
      {showNewProject && <ProjectSettingsModal onClose={() => setShowNewProject(false)} />}
    </>
  );
}
