"use client";

import { useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { useHydrationStore } from "@/lib/store/hydration-store";

/**
 * Mounted once in root layout.
 * 1. Rehydrates project store from localStorage.
 * 2. Waits for feed store's own auto-rehydration to finish (it uses persist
 *    without skipHydration, so it rehydrates asynchronously on mount — we
 *    must not call hydrateAllPosts before userPosts is populated).
 * 3. Runs hydrateAllPosts to swap dead blob: URLs with fresh IDB-backed ones.
 * 4. Marks isHydrated so TheaterMode knows it's safe to start playback.
 */
export function GlobalHydrator() {
  useEffect(() => {
    const { markHydrated } = useHydrationStore.getState();
    async function run() {
      await Promise.resolve(useProjectStore.persist.rehydrate());
      if (!useFeedStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useFeedStore.persist.onFinishHydration(() => { unsub(); resolve(); });
        });
      }
      await useFeedStore.getState().hydrateAllPosts();
    }
    run().catch(console.warn).finally(markHydrated);
  }, []);

  return null;
}
