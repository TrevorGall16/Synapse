"use client";

import { useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { useHydrationStore } from "@/lib/store/hydration-store";
import { saveProjectToIDB, loadProjectFromIDB, saveHistoryToIDB, loadHistoryFromIDB } from "@/lib/store/project-idb";
import { hydrateMediaPool } from "@/lib/store/media-pool-db";
import { validateSerializedProject, validateHistoryData } from "@/lib/schema";
import { registerFlush, deregisterFlush, flushProjectToIDB } from "@/lib/store/flush-registry";
import { useSaveBarrierStore } from "@/lib/store/save-barrier-store";
import type { ProjectState } from "@/lib/store/project-store";
import type { SerializedProject } from "@/lib/store/types";
import { useProjectsRegistry } from "@/lib/store/projects-registry";

// Re-export so publish-modal.tsx import path stays unchanged.
export { flushProjectToIDB };

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
        const projectData = rawProjectData
          ? validateSerializedProject(rawProjectData, `active project ${projectId}`)
          : null;
        if (projectData && projectData.tracks.length > 0) {
          // F5 black-screen fix: blob: URLs created by URL.createObjectURL in
          // the previous page session are revoked the moment that document
          // unloads. The mediaPool we just loaded from IDB carries those dead
          // URLs verbatim — leaving the timeline pointing at nothing and the
          // monitor fully black. Re-issue fresh ObjectURLs from the raw bytes
          // stored in IDB BEFORE we publish the pool to React, so the very
          // first render after refresh has live blob handles.
          const freshPool = await hydrateMediaPool(projectData.mediaPool ?? []);
          useProjectStore.setState({
            tracks: projectData.tracks,
            duration: projectData.duration,
            mediaPool: freshPool,
          });
        }
        const validatedHistory = historyData
          ? validateHistoryData(historyData, `active project history ${projectId}`)
          : null;
        if (validatedHistory) {
          useProjectStore.setState({ historyPast: validatedHistory.past, historyFuture: validatedHistory.future });
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
          ? validateSerializedProject(rawProjectData, `tab project ${id}`)
          : null;
        const validatedTabHistory = historyData
          ? validateHistoryData(historyData, `tab project history ${id}`)
          : null;
        if (projectData) {
          // Re-issue fresh ObjectURLs for the tab's mediaPool too. Without this
          // the moment the user clicks a saved tab after F5, the monitor would
          // turn black exactly the way the active project did pre-fix.
          const tabPool = await hydrateMediaPool(projectData.mediaPool ?? []);
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
                mediaPool: tabPool.length > 0
                  ? tabPool
                  : (s.savedProjects[id]?.mediaPool ?? []),
                parentProjectId: projectData.parentProjectId,
                remixedFromHandle: projectData.remixedFromHandle,
                rootParentId: projectData.rootParentId,
                rootParentHandle: projectData.rootParentHandle,
                historyPast: validatedTabHistory?.past ?? [],
                historyFuture: validatedTabHistory?.future ?? [],
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
    // doSave is async so flushProjectToIDB() can await physical write completion.
    const doSave = async (): Promise<void> => {
      const { setFlushing, setDirty } = useSaveBarrierStore.getState();
      setFlushing(true);
      try {
        const s = useProjectStore.getState();
        if (!s.projectId) return;

        // Each save returns boolean — `idbSafeSet` already toasts on failure.
        // We collect the booleans so a quota-exceeded write (or any IDB error)
        // keeps `isDirty` true; the previous code unconditionally cleared dirty
        // even when writes had silently rejected, which let the user keep
        // editing under the false impression their work was being saved.
        const results = await Promise.all([
          // Active project — mediaPool always included for GC symmetry (ref-counts must survive restart)
          saveProjectToIDB({
            projectId: s.projectId, name: s.name, tracks: s.tracks, duration: s.duration,
            markers: s.markers, projectSettings: s.projectSettings,
            mediaPool: s.mediaPool,
            parentProjectId: s.parentProjectId, remixedFromHandle: s.remixedFromHandle,
            rootParentId: s.rootParentId, rootParentHandle: s.rootParentHandle,
            updatedAt: Date.now(),
            projectStatus: (s as unknown as { projectStatus?: "draft" | "published" }).projectStatus ?? "draft",
          }),
          saveHistoryToIDB(s.projectId, s.historyPast, s.historyFuture),
          // All open tabs
          ...Object.entries(s.savedProjects).map(([id, proj]) =>
            saveProjectToIDB({
              projectId: id, name: proj.name, tracks: proj.tracks, duration: proj.duration,
              markers: proj.markers, projectSettings: proj.projectSettings,
              mediaPool: proj.mediaPool,
              parentProjectId: proj.parentProjectId, remixedFromHandle: proj.remixedFromHandle,
              rootParentId: proj.rootParentId, rootParentHandle: proj.rootParentHandle,
              updatedAt: Date.now(),
              projectStatus: (proj as unknown as { projectStatus?: "draft" | "published" }).projectStatus ?? "draft",
            })
          ),
        ]);
        const allSaved = results.every(Boolean);
        // Sync projectStatus to the lightweight registry so /projects page
        // can filter without loading full IDB records.
        if (s.projectId) {
          const status = (s as unknown as { projectStatus?: "draft" | "published" }).projectStatus ?? "draft";
          useProjectsRegistry.getState().updateProject(s.projectId, { projectStatus: status });
        }
        // Only clear dirty when every IDB write succeeded — otherwise the user
        // still has unsaved work and the save-barrier nav guard must hold.
        if (allSaved) setDirty(false);
        else console.error("[GlobalHydrator] doSave: one or more IDB writes failed; leaving project dirty");
      } finally {
        useSaveBarrierStore.getState().setFlushing(false);
      }
    };

    // Register flush fn in neutral registry (breaks circular dep with project-store)
    registerFlush(doSave);

    const unsub = useProjectStore.subscribe((state: ProjectState, prev: ProjectState) => {
      // Tab switch: flush the outgoing project immediately before the new one loads
      if (state.projectId !== prev.projectId && prev.projectId) {
        if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
        // Save the outgoing project using prev snapshot
        saveProjectToIDB({
          projectId: prev.projectId, name: prev.name, tracks: prev.tracks, duration: prev.duration,
          markers: prev.markers, projectSettings: prev.projectSettings,
          mediaPool: prev.mediaPool,
          parentProjectId: prev.parentProjectId, remixedFromHandle: prev.remixedFromHandle,
          rootParentId: prev.rootParentId, rootParentHandle: prev.rootParentHandle,
          updatedAt: Date.now(),
        }).catch(console.warn);
        saveHistoryToIDB(prev.projectId, prev.historyPast, prev.historyFuture).catch(console.warn);
      }

      const tracksChanged  = state.tracks      !== prev.tracks;
      const historyChanged = state.historyPast !== prev.historyPast || state.historyFuture !== prev.historyFuture;
      const savedChanged   = state.savedProjects !== prev.savedProjects;
      if (!tracksChanged && !historyChanged && !savedChanged) return;

      // Mark dirty — unsaved changes exist until doSave completes.
      useSaveBarrierStore.getState().setDirty(true);

      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => { void doSave(); }, 500);
    });

    // Flush on visibility loss (tab switch, browser close).
    // void is intentional — browser unload events can't await Promises.
    const handleVisibilityChange = () => { if (document.visibilityState === "hidden") void flushProjectToIDB(); };
    const handlePageHide = () => void flushProjectToIDB();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    // Warn on hard reload / tab close when there are unsaved changes.
    // Note: beforeunload does NOT fire for Next.js SPA navigation — that is handled
    // by ensureFlushedBeforeNav() wrapping all router.push calls.
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const { isDirty } = useSaveBarrierStore.getState();
      if (!isDirty) return;
      // Trigger the browser's native "Leave site?" dialog.
      e.preventDefault();
      // returnValue is required for cross-browser compatibility (Chrome ignores custom strings).
      e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
      // Attempt a best-effort flush — browser may not wait, but it helps if it does.
      void flushProjectToIDB();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unsub();
      if (_saveTimer) clearTimeout(_saveTimer);
      deregisterFlush();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return null;
}

// Suppress unused import warning — SerializedProject is used for type assertions above.
type _SerializedProjectCompat = SerializedProject;
