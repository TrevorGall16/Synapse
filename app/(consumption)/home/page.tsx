"use client";

import { useProjectsRegistry, type ProjectSummary } from "@/lib/store/projects-registry";
import { useProjectStore } from "@/lib/store/project-store";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus, Trash2, Clock } from "lucide-react";

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ProjectCard({ project, onOpen, onDelete }: {
  project: ProjectSummary;
  onOpen: (p: ProjectSummary) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group flex flex-col gap-3 rounded-lg border border-white/10 bg-[#1e1e1e] p-4 transition-colors hover:border-white/20 hover:bg-[#242424]">
      {/* Thumbnail placeholder */}
      <div
        className="flex items-center justify-center rounded bg-[#0a0a0a]/40 text-xs text-white/20"
        style={{ aspectRatio: `${project.width}/${project.height}`, maxHeight: 120 }}
      >
        {project.width} × {project.height}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="truncate text-sm font-semibold text-white">{project.name}</h3>
        <div className="flex items-center gap-1 text-[10px] text-white/40">
          <Clock size={10} />
          <span>{formatDate(project.lastEdited)}</span>
          <span className="ml-auto">{project.fps}fps</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onOpen(project)}
          className="flex-1 rounded bg-white/10 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
        >
          Open in Studio
        </button>
        <button
          onClick={() => onDelete(project.id)}
          aria-label="Delete project"
          className="rounded p-1.5 text-white/30 transition-colors hover:bg-red-500/20 hover:text-red-400"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { projects, addProject, removeProject } = useProjectsRegistry();
  const projectSettings = useProjectStore((s) => s.projectSettings);
  const router = useRouter();

  const handleOpen = (_project: ProjectSummary) => {
    // In a full multi-project system, load the project into the store here.
    router.push("/studio");
  };

  const handleNewProject = () => {
    const id = crypto.randomUUID();
    addProject({
      id,
      name: `Project ${projects.length + 1}`,
      lastEdited: Date.now(),
      width: projectSettings.width,
      height: projectSettings.height,
      fps: projectSettings.fps,
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#141414] p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">My Projects</h1>
          <p className="mt-0.5 text-xs text-white/40">
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={handleNewProject}
          className="flex items-center gap-2 rounded bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20"
        >
          <Plus size={14} />
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        /* Empty state */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-white/10 py-20">
          <FolderOpen size={40} className="text-white/20" />
          <div className="text-center">
            <p className="text-sm font-medium text-white/40">No projects yet</p>
            <p className="mt-1 text-xs text-white/25">Create a new project to get started</p>
          </div>
          <button
            onClick={handleNewProject}
            className="flex items-center gap-2 rounded bg-white/10 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            <Plus size={14} />
            Create Project
          </button>
        </div>
      ) : (
        /* Projects grid */
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onOpen={handleOpen}
              onDelete={removeProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}
