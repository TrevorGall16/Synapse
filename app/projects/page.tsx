// app/projects/page.tsx
// Project Library — primary project management entry point.
// Mirrors app/gallery/page.tsx for navigation guard patterns.

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, FolderOpen, Layers, Trash2, Pencil, Check, X } from "lucide-react";
import { useProjectsRegistry, type ProjectSummary } from "@/lib/store/projects-registry";
import { useProjectStore } from "@/lib/store/project-store";
import { loadProjectFromIDB, deleteProjectFromIDB } from "@/lib/store/project-idb";
import { validateSerializedProject } from "@/lib/schema";
import type { SerializedProject } from "@/lib/store/types";
import { releaseSnapshotMedia } from "@/lib/store/media-pool-db";
import { runGcSweep } from "@/lib/store/gc-service";
import { ensureFlushedBeforeNav } from "@/lib/store/project-store";

function formatDate(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000)          return "just now";
  if (diff < 3_600_000)       return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)      return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000)     return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function projectAccent(id: string): string {
  const ACCENTS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#fb923c"];
  let h = 0;
  for (let i = 0; i < Math.min(id.length, 8); i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

type FilterTab = "all" | "drafts" | "published";

// ── Status Badge ──────────────────────────────────────────
function StatusBadge({ status }: { status?: "draft" | "published" }) {
  if (status === "published") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded border border-green-500/30 bg-green-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-green-400">
        ✓ Published
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
      ● Draft
    </span>
  );
}

// ── Project Card ──────────────────────────────────────────
interface CardProps {
  project: ProjectSummary;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  onRename: (name: string) => void;
}

function ProjectCard({ project, onOpen, onDelete, onRename }: CardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting]       = useState(false);
  const [renaming, setRenaming]           = useState(false);
  const [nameVal, setNameVal]             = useState(project.name);
  const accent = projectAccent(project.id);

  const submitRename = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== project.name) onRename(trimmed);
    setRenaming(false);
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    await onDelete();
    setIsDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <article
      data-testid={`project-card-${project.id}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e1e] transition-all hover:border-white/20"
    >
      {/* Thumbnail */}
      <button
        onClick={onOpen}
        className="relative w-full overflow-hidden bg-[#0d0d0d]"
        style={{ aspectRatio: `${project.width}/${Math.round(project.width * (9 / 16))}` }}
        aria-label={`Open ${project.name}`}
      >
        <div className="absolute inset-0 flex items-end gap-[2px] px-3 pb-8 opacity-[0.12]" aria-hidden>
          {Array.from({ length: 28 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[2px]"
              style={{
                background: accent,
                height: `${20 + Math.sin(i * 0.8 + (project.id.charCodeAt(0) || 0)) * 32 + (i % 5) * 7}%`,
              }}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/75" />
        <span className="absolute right-2 top-2 rounded bg-[#0a0a0a]/60 px-1.5 py-0.5 text-[8px] tabular-nums text-white/40 backdrop-blur-sm">
          {project.width}×{project.height}
        </span>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-[#0a0a0a]/55 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-white"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      </button>

      {/* Info panel */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") { setNameVal(project.name); setRenaming(false); }
              }}
              className="flex-1 rounded border border-purple-500/40 bg-white/6 px-2 py-1 text-xs font-semibold text-white outline-none"
            />
            <button onClick={submitRename} className="rounded p-1 text-green-400 hover:bg-green-500/15"><Check size={11} /></button>
            <button onClick={() => { setNameVal(project.name); setRenaming(false); }} className="rounded p-1 text-white/30 hover:bg-white/8"><X size={11} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <h3 className="flex-1 truncate text-[12px] font-semibold text-white">{project.name}</h3>
            <button
              onClick={() => { setNameVal(project.name); setRenaming(true); }}
              className="shrink-0 rounded p-1 text-white/20 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/8 hover:text-white/60"
              title="Rename"
            >
              <Pencil size={10} />
            </button>
          </div>
        )}

        {/* Status + last edited */}
        <div className="flex items-center gap-2">
          <StatusBadge status={project.projectStatus} />
          <span className="text-[9px] text-white/30">{formatDate(project.lastEdited)}</span>
        </div>

        {/* Actions */}
        <div className="mt-auto flex gap-1.5 pt-1">
          <button
            data-testid={`project-open-btn-${project.id}`}
            onClick={onOpen}
            className="flex-1 rounded-lg bg-white/8 py-1.5 text-[10px] font-semibold text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            Open
          </button>

          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded-lg bg-red-500/25 px-2.5 py-1.5 text-[10px] font-bold text-red-400 transition-colors hover:bg-red-500/35 disabled:opacity-50"
              >
                {isDeleting ? "…" : "Delete"}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-white/10 px-2 py-1.5 text-[10px] text-white/35 hover:text-white/65"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg border border-white/8 px-2.5 py-1.5 text-[10px] text-white/25 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Page ──────────────────────────────────────────────────
export default function ProjectsPage() {
  const router   = useRouter();
  const { projects, removeProject, updateProject } = useProjectsRegistry();
  const openNewTab = useProjectStore((s) => s.openNewTab);
  const [filter, setFilter] = useState<FilterTab>("all");

  const handleNewProject = useCallback(async () => {
    await ensureFlushedBeforeNav();
    openNewTab();
    router.push("/studio");
  }, [openNewTab, router]);

  // Mirrors app/gallery/page.tsx handleOpen exactly
  const handleOpen = useCallback(async (project: ProjectSummary) => {
    await ensureFlushedBeforeNav();
    const store = useProjectStore.getState();

    if (project.id === store.projectId) { router.push("/studio"); return; }

    if (store.savedProjects[project.id]) {
      store.switchTab(project.id);
      router.push("/studio");
      return;
    }

    loadProjectFromIDB(project.id)
      .then((raw) => {
        if (raw) {
          const rec = validateSerializedProject(raw, `projects open ${project.id}`) as unknown as SerializedProject | null;
          if (rec) {
            useProjectStore.getState().openProjectInTab({
              projectId: rec.projectId,
              tracks: rec.tracks,
              duration: rec.duration,
              projectSettings: rec.projectSettings,
              mediaPool: rec.mediaPool,
              name: rec.name,
              parentProjectId: rec.parentProjectId,
              remixedFromHandle: rec.remixedFromHandle,
              rootParentId: rec.rootParentId,
              rootParentHandle: rec.rootParentHandle,
            });
          }
        }
        router.push("/studio");
      })
      .catch(() => router.push("/studio"));
  }, [router]);

  const handleDelete = useCallback(async (project: ProjectSummary) => {
    if (!project.id) return;
    useProjectStore.getState().removeProject(project.id);
    const rec = await loadProjectFromIDB(project.id).catch(() => null);
    if (rec?.mediaPool?.length) await releaseSnapshotMedia(rec.mediaPool).catch(console.warn);
    await deleteProjectFromIDB(project.id).catch(console.warn);
    removeProject(project.id);
    setTimeout(() => runGcSweep().catch(console.warn), 1500);
  }, [removeProject]);

  const handleRename = useCallback((project: ProjectSummary, newName: string) => {
    updateProject(project.id, { name: newName, lastEdited: Date.now() });
    if (useProjectStore.getState().projectId === project.id) {
      useProjectStore.getState().setName(newName);
    }
  }, [updateProject]);

  const sorted = [...projects].sort((a, b) => b.lastEdited - a.lastEdited);

  const filtered = sorted.filter((p) => {
    if (filter === "drafts")    return (p.projectStatus ?? "draft") === "draft";
    if (filter === "published") return p.projectStatus === "published";
    return true;
  });

  return (
    <div data-testid="projects-page" className="flex h-full flex-col overflow-y-auto bg-[#141414]">
      {/* Header */}
      <div className="z-10 shrink-0 flex items-center justify-between border-b border-white/10 bg-[#141414]/95 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-white/35" />
          <h1 className="text-sm font-bold text-white">Projects</h1>
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/35">
            {projects.length} Project{projects.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={handleNewProject}
          className="flex items-center gap-1.5 rounded-lg bg-purple-500/20 px-3 py-1.5 text-[11px] font-bold text-purple-300 transition-colors hover:bg-purple-500/30"
        >
          <Plus size={12} />New Project
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex shrink-0 gap-1 border-b border-white/8 px-5 py-2">
        {(["all", "drafts", "published"] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            data-testid={`project-filter-${tab}`}
            onClick={() => setFilter(tab)}
            className={`rounded-full px-3 py-1 text-[10px] font-semibold capitalize transition-colors ${
              filter === tab
                ? "bg-white/12 text-white"
                : "text-white/40 hover:bg-white/6 hover:text-white/70"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 px-5 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-dashed border-white/8 py-28">
            <FolderOpen size={36} className="text-white/15" />
            <div className="text-center">
              <p className="text-sm font-semibold text-white/35">
                {projects.length === 0 ? "No projects yet" : "No projects match this filter"}
              </p>
              {projects.length === 0 && (
                <p className="mt-1 text-xs text-white/20">Start editing in Studio — your projects will appear here.</p>
              )}
            </div>
            {projects.length === 0 && (
              <button
                onClick={handleNewProject}
                className="flex items-center gap-2 rounded-lg bg-purple-500/20 px-4 py-2 text-xs font-bold text-purple-300 transition-colors hover:bg-purple-500/30"
              >
                <Plus size={13} />Create First Project
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => handleOpen(project)}
                onDelete={() => handleDelete(project)}
                onRename={(name) => handleRename(project, name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Suppress unused import warning
type _SerializedProjectCompat = SerializedProject;
