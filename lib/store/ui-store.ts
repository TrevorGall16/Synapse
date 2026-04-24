"use client";

import { create } from "zustand";

interface UiState {
  // ── Feed view mode ────────────────────────────────────────────────────────
  feedViewMode: "grid" | "single";
  setFeedViewMode: (mode: "grid" | "single") => void;
  toggleFeedViewMode: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  feedViewMode: "single",
  setFeedViewMode: (mode) => set({ feedViewMode: mode }),
  toggleFeedViewMode: () =>
    set((s) => ({ feedViewMode: s.feedViewMode === "grid" ? "single" : "grid" })),
}));
