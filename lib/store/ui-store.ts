"use client";

import { create } from "zustand";

interface UiState {
  // ── Search overlay ────────────────────────────────────────────────────────
  searchOverlayOpen: boolean;
  openSearchOverlay: () => void;
  closeSearchOverlay: () => void;
  toggleSearchOverlay: () => void;

  // ── Feed view mode ────────────────────────────────────────────────────────
  feedViewMode: "grid" | "single";
  setFeedViewMode: (mode: "grid" | "single") => void;
  toggleFeedViewMode: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  searchOverlayOpen: false,
  openSearchOverlay:  () => set({ searchOverlayOpen: true }),
  closeSearchOverlay: () => set({ searchOverlayOpen: false }),
  toggleSearchOverlay: () =>
    set((s) => ({ searchOverlayOpen: !s.searchOverlayOpen })),

  feedViewMode: "single",
  setFeedViewMode: (mode) => set({ feedViewMode: mode }),
  toggleFeedViewMode: () =>
    set((s) => ({ feedViewMode: s.feedViewMode === "grid" ? "single" : "grid" })),
}));
