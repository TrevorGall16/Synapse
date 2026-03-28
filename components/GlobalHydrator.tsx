"use client";

import { useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { useHydrationStore } from "@/lib/store/hydration-store";
import { saveProjectToIDB, loadProjectFromIDB, saveHistoryToIDB, loadHistoryFromIDB } from "@/lib/store/project-idb";
import { validateSerializedProject } from "@/lib/schema";
import type { ProjectState } from "@/lib/store/project-store";
import type { SerializedProject } from "@/lib/store/types";

/**
 * Mounted once in root layout.
 * 1. Rehydrates project store from localStorage (lightweight registry only).
 * 2. Loads tracks + history from IDB for the active project and all open tabs.
 *    — All IDB payloads are validated via Zod before state injection.
 * 3. Sets up a debounced subscribe that writes tracks + history to IDB on every change.
 * 4. Waits for feed store hydration, then hydrateAllPosts for blob URL recovery.
 * 5. Marks isHydrated so TheaterMode knows it's safe to start playback.
 *
 * flush() bypasses the 500ms debounce for critical save points (tab switch, publish, pagehide).
 */

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _flushFn: (() => void) | null = null;

/** Immediately persist active project + all open tabs to IDB, bypassing the debounce. */
export function flushProjectToIDB(): void {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _flushFn?.();
}

export function GlobalHydrator() {
  useEffect(() => {
    const { markHydrated } = useHydrationStore.getState();

    async function run() {
      // ── Step 1: rehydrate lightweight state from localStorage ──
      await Promise.resolve(useProjectStore.persist.rehydrate());

      // ── Step 2: load tracks + history from IDB (validated) ──
      const { projectId, openProjectIds } = useProjectStore.getState();
      if (projectId) {
        const [rawProjectData, historyData] = await Promise.all([
          loadProjectFromIDB(projectId),
          loadHistoryFromIDB(projectId),
        ]);
        // Cast is safe: validateSerializedProject already confirmed structural integrity.
        // z.unknown() sub-fields cause Zod's inferred type to diverge from the native type.
        const projectData = rawProjectData
          ? validateSerializedProject(rawProjectData, `active project ${projectId}`) as unknown as SerializedProject | null
          : null;
        if (projectData && projectData.tracks.length > 0) {
          useProjectStore.setState({ tracks: projectData.tracks, duration: projectData.duration });
        }
        if (historyData) {
          useProjectStore.setState({ historyPast: historyData.past, historyFuture: historyData.future });
        }
      }

      // Reconstruct saved tabs entirely from IDB (validated)
      for (const id of openProjectIds) {
        if (id === projectId) continue;
        const [rawProjectData, historyData] = await Promise.all([
          loadProjectFromIDB(id),
          loadHistoryFromIDB(id),
        ]);
        const projectData = rawProjectData
          ? validateSerializedProject(rawProjectData, `tab project ${id}`) as unknown as SerializedProject | null
          : null;
        if (projectData) {
          useProjectStore.setState((s) => ({
            savedProjects: {
              ...s.savedProjects,
              [id]: {
                ...(s.savedProjects[id] ?? {}),
                projectId: id,
                name: projectData.name,
                tracks: projectData.tracks,
                duration: projectData.duration,
                markers: projectData.markers ?? [],
                projectSettings: projectData.projectSettings,
                mediaPool: projectData.mediaPool ?? s.savedProjects[id]?.mediaPool ?? [],
                parentProjectId: projectData.parentProjectId,
                remixedFromHandle: projectData.remixedFromHandle,
                rootParentId: projectData.rootParentId,
                rootParentHandle: projectData.rootParentHandle,
                historyPast: historyData?.past ?? [],
                historyFuture: historyData?.future ?? [],
              },
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
    const doSave = () => {
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

      // Save each open tab's full state to IDB
      for (const [id, proj] of Object.entries(s.savedProjects)) {
        saveProjectToIDB({
          projectId: id, name: proj.name, tracks: proj.tracks, duration: proj.duration,
          markers: proj.markers, projectSettings: proj.projectSettings,
          mediaPool: proj.mediaPool,
          parentProjectId: proj.parentProjectId, remixedFromHandle: proj.remixedFromHandle,
          rootParentId: proj.rootParentId, rootParentHandle: proj.rootParentHandle,
          updatedAt: Date.now(),
        }).catch(console.warn);
      }
    };

    // Expose flush for external callers (publish, tab switch, pagehide)
    _flushFn = doSave;

    const unsub = useProjectStore.subscribe((state: ProjectState, prev: ProjectState) => {
      const tracksChanged  = state.tracks      !== prev.tracks;
      const historyChanged = state.historyPast !== prev.historyPast || state.historyFuture !== prev.historyFuture;
      const savedChanged   = state.savedProjects !== prev.savedProjects;
      if (!tracksChanged && !historyChanged && !savedChanged) return;

      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(doSave, 500);
    });

    // Flush on visibility loss (tab switch, browser close)
    const handleVisibilityChange = () => { if (document.visibilityState === "hidden") flushProjectToIDB(); };
    const handlePageHide = () => flushProjectToIDB();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      unsub();
      if (_saveTimer) clearTimeout(_saveTimer);
      _flushFn = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  return null;
}
