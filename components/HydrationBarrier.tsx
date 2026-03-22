"use client";

import { useHydrationStore } from "@/lib/store/hydration-store";

/**
 * Blocks page rendering until GlobalHydrator has finished rehydrating all
 * feed-post blob: URLs from IndexedDB. Prevents the "Media Offline" flash
 * that occurs when the feed renders before IDB recovery completes.
 */
export function HydrationBarrier({ children }: { children: React.ReactNode }) {
  const isHydrated = useHydrationStore((s) => s.isHydrated);

  if (!isHydrated) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#141414]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
          <p className="text-xs font-semibold text-white/40">Syncing Database…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
