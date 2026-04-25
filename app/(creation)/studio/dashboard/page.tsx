"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, BarChart3, Eye, Heart, MessageCircle, Layers,
} from "lucide-react";
import { ProjectsTab, type ProjectFilterTab } from "@/components/studio/projects-tab";
import { useProjectStore } from "@/lib/store/project-store";
import { useProjectsRegistry } from "@/lib/store/projects-registry";
import { useFeedStore } from "@/lib/store/feed-store";
import { ensureFlushedBeforeNav } from "@/lib/store/project-store";

type DashboardSection = "projects" | "analytics";

export default function StudioDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const section = (searchParams.get("section") as DashboardSection) || "projects";
  const restoredFilter = (searchParams.get("filter") as ProjectFilterTab) || "all";

  const [projectFilter, setProjectFilter] = useState<ProjectFilterTab>(restoredFilter);

  const openNewTab = useProjectStore((s) => s.openNewTab);
  const projectCount = useProjectsRegistry((s) => s.projects.length);
  const addProjectToRegistry = useProjectsRegistry((s) => s.addProject);

  const switchSection = useCallback((s: DashboardSection) => {
    const params = new URLSearchParams();
    if (s !== "projects") params.set("section", s);
    if (projectFilter !== "all") params.set("filter", projectFilter);
    const qs = params.toString();
    router.replace(`/studio/dashboard${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, projectFilter]);

  const handleFilterChange = useCallback((tab: ProjectFilterTab) => {
    setProjectFilter(tab);
    // Persist filter in URL so returning from editor restores it
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "all") {
      params.delete("filter");
    } else {
      params.set("filter", tab);
    }
    const qs = params.toString();
    router.replace(`/studio/dashboard${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  const handleCreateNew = useCallback(async () => {
    await ensureFlushedBeforeNav();
    openNewTab();
    const { projectId, name, projectSettings } = useProjectStore.getState();
    // Persist standalone draft record immediately so it appears as its own dashboard card.
    addProjectToRegistry({
      id: projectId,
      name,
      lastEdited: Date.now(),
      width: projectSettings.width,
      height: projectSettings.height,
      fps: projectSettings.fps,
      projectStatus: "draft",
    });
    router.push(`/studio?workspace=focused&projectId=${projectId}&from=dashboard&init=new`);
  }, [openNewTab, router, addProjectToRegistry]);

  // Build the editor route with return context + focused workspace flag
  const buildEditorRoute = (projectId: string) =>
    `/studio?workspace=focused&projectId=${projectId}&from=dashboard${projectFilter !== "all" ? `&dashFilter=${projectFilter}` : ""}`;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#121014]">
      {/* Header */}
      <div className="z-10 shrink-0 border-b border-white/10 bg-[#121014]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Layers size={15} className="text-brand-accent" />
            <h1 className="text-base font-bold text-white">Studio</h1>
            <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/35">
              {projectCount} Project{projectCount !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-brand-accent"
          >
            <Plus size={13} /> New Project
          </button>
        </div>

        {/* Section tabs */}
        <div className="flex gap-0 px-6">
          <button
            onClick={() => switchSection("projects")}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-[11px] font-semibold transition-colors ${
              section === "projects"
                ? "border-brand-accent text-brand-text"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            <Layers size={13} /> My Projects
          </button>
          <button
            onClick={() => switchSection("analytics")}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-[11px] font-semibold transition-colors ${
              section === "analytics"
                ? "border-brand-accent text-brand-text"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            <BarChart3 size={13} /> Analytics
          </button>
        </div>
      </div>

      {/* Content */}
      {section === "projects" && (
        <ProjectsTab
          editorRouteBuilder={buildEditorRoute}
          filter={projectFilter}
          onFilterChange={handleFilterChange}
        />
      )}
      {section === "analytics" && <AnalyticsSummary />}
    </div>
  );
}

// ── Analytics Summary (placeholder cards) ────────────────────

function AnalyticsSummary() {
  const posts = useFeedStore((s) => s.userPosts);
  const totalLikes = posts.reduce((sum, p) => sum + (p.likes ?? 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.comments ?? 0), 0);

  const cards = [
    { label: "Published Posts", value: posts.length, icon: <Eye size={16} />, color: "text-cyan-400" },
    { label: "Total Likes", value: totalLikes, icon: <Heart size={16} />, color: "text-pink-400" },
    { label: "Total Comments", value: totalComments, icon: <MessageCircle size={16} />, color: "text-amber-400" },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/[0.02] p-5"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white/6 ${card.color}`}>
              {card.icon}
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums text-white">{card.value}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-white/8 py-20">
        <BarChart3 size={36} className="text-white/15" />
        <p className="text-sm font-semibold text-white/35">Detailed analytics coming soon</p>
        <p className="text-xs text-white/20">Track views, engagement trends, and audience growth.</p>
      </div>
    </div>
  );
}
