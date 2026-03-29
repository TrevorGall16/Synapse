// lib/store/save-barrier-store.ts
import { create } from "zustand";

interface SaveBarrierState {
  /** True while the 500ms debounce timer is active (unsaved changes exist). */
  isDirty: boolean;
  /** True while flushProjectToIDB() is in flight. */
  isFlushing: boolean;
  setDirty: (v: boolean) => void;
  setFlushing: (v: boolean) => void;
}

export const useSaveBarrierStore = create<SaveBarrierState>()((set) => ({
  isDirty: false,
  isFlushing: false,
  setDirty: (v) => set({ isDirty: v }),
  setFlushing: (v) => set({ isFlushing: v }),
}));
