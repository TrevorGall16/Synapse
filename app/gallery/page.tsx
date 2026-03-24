"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, FolderOpen, Trash2, Pencil, Check, X, Clock, Film, Layers } from "lucide-react";
import { useProjectsRegistry, type ProjectSummary } from "@/lib/store/projects-registry";
import { useProjectStore } from "@/lib/store/project-store";
import { loadProjectFromIDB, deleteProjectFromIDB } from "@/lib/store/project-idb";
import { releaseSnapshotMedia } from "@/lib/store/media-pool-db";
import { runGcSweep } from "@/lib/store/gc-service";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(micros: number): string {
  const s = Math.floor(micros / 1_000_000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function projectAccent(id: string): string {
  const ACCENTS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#fb923c"];
  let h = 0;
  for (let i = 0; i < Math.min(id.length, 8); i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

interface CardMeta { duration: number; clipCount: number; }

// ── Project Card ──────────────────────────────────────────────────────────────
interface ProjectCardProps {
  project: ProjectSummary;
  meta: CardMeta | null;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  onRename: (name: string) => void;
}

function ProjectCard({ project, meta, onOpen, onDelete, onRename }: ProjectCardProps) {
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
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e1e] transition-all hover:border-white/20">
      {/* Thumbnail */}
      <button
        onClick={onOpen}
        className="relative w-full overflow-hidden bg-[#0d0d0d]"
        style={{ aspectRatio: `${project.width}/${Math.round(project.width * (9 / 16))}` }}
      >
        {/* Waveform-bar placeholder */}
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

        {/* Duration badge */}
        {meta && (
          <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[8px] tabular-nums text-white/60 backdrop-blur-sm">
            {formatDuration(meta.duration)}
          </span>
        )}

        {/* Resolution badge */}
        <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[8px] tabular-nums text-white/40 backdrop-blur-sm">
          {project.width}×{project.height}
        </span>

        {/* Hover play hint */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-white"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      </button>

      {/* Info panel */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* Name — inline rename or display */}
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={nameVal}
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

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[9px] text-white/35">
          <span className="flex items-center gap-0.5"><Clock size={8} />{formatDate(project.lastEdited)}</span>
          <span className="tabular-nums">{project.fps}fps</span>
          {meta && meta.clipCount > 0 && (
            <span className="flex items-center gap-0.5"><Film size={8} />{meta.clipCount}</span>
          )}
        </div>

        {/* Actions */}
        <div className="mt-auto flex gap-1.5 pt-1">
          <button
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

// ── Page ──────────────────────────────────────────────────────────────────────
export default function GalleryPage() {
  const router = useRouter();
  const { projects, removeProject, updateProject } = useProjectsRegistry();
  const openNewTab = useProjectStore((s) => s.openNewTab);
  const [metas, setMetas] = useState<Record<string, CardMeta>>({});

  // Async-load IDB metadata for each project card
  useEffect(() => {
    for (const p of projects) {
      if (metas[p.id]) continue;
      loadProjectFromIDB(p.id)
        .then((rec) => {
          if (!rec) return;
          setMetas((prev) => ({
            ...prev,
            [p.id]: {
              duration: rec.duration,
              clipCount: rec.tracks.flatMap((t) => t.clips).length,
            },
          }));
        })
        .catch(() => {});
    }
  }, [projects]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewProject = useCallback(() => {
    openNewTab();
    router.push("/studio");
  }, [openNewTab, router]);

  const handleOpen = useCallback((project: ProjectSummary) => {
    const store = useProjectStore.getState();

    // Already active → just navigate
    if (project.id === store.projectId) { router.push("/studio"); return; }

    // Already in savedProjects → switch tab
    if (store.savedProjects[project.id]) {
      store.switchTab(project.id);
      router.push("/studio");
      return;
    }

    // Load from IDB and open as new tab
    loadProjectFromIDB(project.id)
      .then((rec) => {
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
        router.push("/studio");
      })
      .catch(() => router.push("/studio"));
  }, [router]);

  const handleDelete = useCallback(async (project: ProjectSummary) => {
    if (!project.id) return; // guard: never delete with empty id

    // Hard-remove from all in-memory studio state (tabs, savedProjects, active).
    // removeProject handles every case: active tab, background tab, not open at all.
    useProjectStore.getState().removeProject(project.id);

    const rec = await loadProjectFromIDB(project.id).catch(() => null);
    if (rec?.mediaPool?.length) {
      await releaseSnapshotMedia(rec.mediaPool).catch(console.warn);
    }
    await deleteProjectFromIDB(project.id).catch(console.warn);
    removeProject(project.id);
    // Trigger GC sweep after short delay to let refCounts settle
    setTimeout(() => runGcSweep().catch(console.warn), 1500);
  }, [removeProject]);

  const handleRename = useCallback((project: ProjectSummary, newName: string) => {
    updateProject(project.id, { name: newName, lastEdited: Date.now() });
    // Also sync the active project name if it's the same project
    if (useProjectStore.getState().projectId === project.id) {
      useProjectStore.getState().setName(newName);
    }
  }, [updateProject]);

  const sorted = [...projects].sort((a, b) => b.lastEdited - a.lastEdited);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#141414]">
      {/* Header */}
      <div className="z-10 shrink-0 flex items-center justify-between border-b border-white/10 bg-[#141414]/95 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-white/35" />
          <h1 className="text-sm font-bold text-white">Gallery</h1>
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

      {/* Content */}
      <div className="flex-1 px-5 py-5">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-dashed border-white/8 py-28">
            <FolderOpen size={36} className="text-white/15" />
            <div className="text-center">
              <p className="text-sm font-semibold text-white/35">No projects yet</p>
              <p className="mt-1 text-xs text-white/20">Start editing in Studio — your projects will appear here.</p>
            </div>
            <button
              onClick={handleNewProject}
              className="flex items-center gap-2 rounded-lg bg-purple-500/20 px-4 py-2 text-xs font-bold text-purple-300 transition-colors hover:bg-purple-500/30"
            >
              <Plus size={13} />Create First Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {sorted.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                meta={metas[project.id] ?? null}
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
