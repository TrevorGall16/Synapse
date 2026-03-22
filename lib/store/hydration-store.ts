import { create } from "zustand";

interface HydrationState {
  isHydrated: boolean;
  markHydrated: () => void;
}

export const useHydrationStore = create<HydrationState>((set) => ({
  isHydrated: false,
  markHydrated: () => set({ isHydrated: true }),
}));
