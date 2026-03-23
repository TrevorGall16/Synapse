"use client";

import { useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { useHydrationStore } from "@/lib/store/hydration-store";
import { saveProjectToIDB, loadProjectFromIDB, saveHistoryToIDB, loadHistoryFromIDB } from "@/lib/store/project-idb";
import type { ProjectState } from "@/lib/store/project-store";

/**
 * Mounted once in root layout.
 * 1. Rehydrates project store from localStorage (lightweight registry only).
 * 2. Loads tracks + history from IDB for the active project and all open tabs.
 * 3. Sets up a debounced subscribe that writes tracks + history to IDB on every change.
 * 4. Waits for feed store hydration, then hydrateAllPosts for blob URL recovery.
 * 5. Marks isHydrated so TheaterMode knows it's safe to start playback.
 */
export function GlobalHydrator() {
  useEffect(() => {
    const { markHydrated } = useHydrationStore.getState();

    async function run() {
      // ── Step 1: rehydrate lightweight state from localStorage ──
      await Promise.resolve(useProjectStore.persist.rehydrate());

      // ── Step 2: load tracks + history from IDB ──
      const { projectId, openProjectIds } = useProjectStore.getState();
      if (projectId) {
        const [projectData, historyData] = await Promise.all([
          loadProjectFromIDB(projectId),
          loadHistoryFromIDB(projectId),
        ]);
        if (projectData && projectData.tracks.length > 0) {
          useProjectStore.setState({ tracks: projectData.tracks, duration: projectData.duration });
        }
        if (historyData) {
          useProjectStore.setState({ historyPast: historyData.past, historyFuture: historyData.future });
        }
      }

      // Load tracks for other open tabs (so switchTab has data)
      const { savedProjects } = useProjectStore.getState();
      for (const id of openProjectIds) {
        if (id === projectId || !savedProjects[id]) continue;
        const projectData = await loadProjectFromIDB(id);
        if (projectData && projectData.tracks.length > 0) {
          useProjectStore.setState((s) => ({
            savedProjects: {
              ...s.savedProjects,
              [id]: { ...s.savedProjects[id], tracks: projectData.tracks, duration: projectData.duration },
            },
          }));
        }
      }

      // ── Step 3: feed store hydration + blob URL recovery ──
      if (!useFeedStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useFeedStore.persist.onFinishHydration(() => { unsub(); resolve(); });
        });
      }
      await useFeedStore.getState().hydrateAllPosts();
    }

    run().catch(console.warn).finally(markHydrated);

    // ── Step 4: debounced IDB write on every tracks/history change ──
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useProjectStore.subscribe((state: ProjectState, prev: ProjectState) => {
      const tracksChanged  = state.tracks      !== prev.tracks;
      const historyChanged = state.historyPast !== prev.historyPast || state.historyFuture !== prev.historyFuture;
      const savedChanged   = state.savedProjects !== prev.savedProjects;
      if (!tracksChanged && !historyChanged && !savedChanged) return;

      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const s = useProjectStore.getState();
        if (!s.projectId) return;

        // Save active project
        saveProjectToIDB({
          projectId: s.projectId, name: s.name, tracks: s.tracks, duration: s.duration,
          markers: s.markers, projectSettings: s.projectSettings,
          parentProjectId: s.parentProjectId, remixedFromHandle: s.remixedFromHandle,
          rootParentId: s.rootParentId, rootParentHandle: s.rootParentHandle,
          updatedAt: Date.now(),
        }).catch(console.warn);
        saveHistoryToIDB(s.projectId, s.historyPast, s.historyFuture).catch(console.warn);

        // Save each open tab's tracks to IDB (so they survive across refreshes)
        for (const [id, proj] of Object.entries(s.savedProjects)) {
          if (proj.tracks.length > 0) {
            saveProjectToIDB({
              projectId: id, name: proj.name, tracks: proj.tracks, duration: proj.duration,
              markers: proj.markers, projectSettings: proj.projectSettings,
              parentProjectId: proj.parentProjectId, remixedFromHandle: proj.remixedFromHandle,
              rootParentId: proj.rootParentId, rootParentHandle: proj.rootParentHandle,
              updatedAt: Date.now(),
            }).catch(console.warn);
          }
        }
      }, 500);
    });

    return () => {
      unsub();
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, []);

  return null;
}
