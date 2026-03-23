"use client";

import { useEffect, useRef, useState } from "react";
import { registerIdbToast } from "@/lib/store/idb-safe-write";
import { runGcSweep } from "@/lib/store/gc-service";

/**
 * Mounts once in root layout (client-side only).
 * - Registers the IDB QuotaExceededError toast handler.
 * - Runs an initial GC sweep on boot, then every 30 minutes.
 */
export function AppBootstrap() {
  const [idbError, setIdbError] = useState<string | null>(null);
  const gcTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Wire IDB error toast
    registerIdbToast((msg) => {
      setIdbError(msg);
      setTimeout(() => setIdbError(null), 5000);
    });

    // Initial GC sweep (delayed 10s to not contend with hydration)
    const bootTimer = setTimeout(() => runGcSweep().catch(console.warn), 10_000);

    // Periodic GC every 30 minutes
    gcTimerRef.current = setInterval(() => runGcSweep().catch(console.warn), 30 * 60 * 1_000);

    return () => {
      clearTimeout(bootTimer);
      if (gcTimerRef.current) clearInterval(gcTimerRef.current);
    };
  }, []);

  if (!idbError) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 flex items-center gap-2 rounded-full border border-red-500/30 bg-[#1c1c1c]/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
      <span className="text-xs font-semibold text-red-300">{idbError}</span>
    </div>
  );
}
