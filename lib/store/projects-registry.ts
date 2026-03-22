"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProjectSummary {
  id: string;
  name: string;
  lastEdited: number; // ms epoch
  width: number;
  height: number;
  fps: number;
  parentProjectId?: string;  // set when forked from another project
  authorUsername?: string;   // username of the creator who published this
}

interface ProjectsRegistryState {
  projects: ProjectSummary[];
  addProject: (p: ProjectSummary) => void;
  removeProject: (id: string) => void;
  updateProject: (id: string, patch: Partial<Omit<ProjectSummary, "id">>) => void;
}

export const useProjectsRegistry = create<ProjectsRegistryState>()(
  persist(
    (set) => ({
      projects: [],
      addProject: (p) => set((s) => ({ projects: [...s.projects, p] })),
      removeProject: (id) =>
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
      updateProject: (id, patch) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
    }),
    { name: "synapse-projects-registry" }
  )
);
