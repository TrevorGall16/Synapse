import { useEffect, useState } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { refreshMediaUrl } from "@/lib/store/media-pool-db";

/**
 * Blocks the Studio UI until:
 *  1. Zustand `persist` has finished reading from localStorage (skipHydration safe)
 *  2. Every mediaPool item with a missing previewUrl has been restored from IDB
 *
 * Returns { isHydrating } — true until both steps complete.
 */
export function useMediaHydration() {
  const [isHydrating, setIsHydrating] = useState(true); // start blocked

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // ── Step 1: trigger localStorage rehydration and wait for it ──
      await Promise.resolve(useProjectStore.persist.rehydrate());

      if (!useProjectStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
          const unsub = useProjectStore.persist.onFinishHydration(() => {
            unsub();
            resolve();
          });
        });
      }

      if (cancelled) return;

      // ── Step 2: read from getState() — guaranteed post-rehydration ──
      const { mediaPool } = useProjectStore.getState();
      const stale = mediaPool.filter((m) => !m.previewUrl);

      if (stale.length === 0) {
        setIsHydrating(false);
        return;
      }

      // ── Step 3: restore each dead URL from IndexedDB ──
      await Promise.all(
        stale.map(async (item) => {
          const url = await refreshMediaUrl(item.id);
          if (url && !cancelled) {
            useProjectStore.getState().updateMediaItemUrl(item.id, url);
            console.log(`IDB Recovery Success: ${item.name} (${item.id.slice(0, 8)})`);
          }
        })
      );

      if (!cancelled) setIsHydrating(false);
    };

    run().catch((err) => {
      console.warn("useMediaHydration failed:", err);
      if (!cancelled) setIsHydrating(false);
    });

    return () => { cancelled = true; };
  }, []); // run once on mount

  return { isHydrating };
}
