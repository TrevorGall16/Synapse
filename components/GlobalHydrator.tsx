"use client";

import { useEffect } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { useHydrationStore } from "@/lib/store/hydration-store";

/**
 * Mounted once in root layout.
 * Fires project-store rehydration + feed IDB recovery in parallel,
 * then marks isHydrated so TheaterMode knows it's safe to play.
 */
export function GlobalHydrator() {
  useEffect(() => {
    const { markHydrated } = useHydrationStore.getState();
    Promise.all([
      Promise.resolve(useProjectStore.persist.rehydrate()),
      useFeedStore.getState().hydrateAllPosts(),
    ]).catch(console.warn).finally(markHydrated);
  }, []);

  return null;
}
