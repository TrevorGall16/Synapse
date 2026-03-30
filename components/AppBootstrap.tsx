"use client";

import { useEffect, useRef, useState } from "react";
import { registerIdbToast } from "@/lib/store/idb-safe-write";
import { runGcSweep } from "@/lib/store/gc-service";
import { useSaveBarrierStore } from "@/lib/store/save-barrier-store";

/**
 * Mounts once in root layout (client-side only).
 * - Registers the IDB QuotaExceededError toast handler.
 * - Runs an initial GC sweep on boot, then every 30 minutes.
 * - In AUDIT_MODE: installs PerformanceObserver for long-task capture,
 *   console.info interceptor for export summaries, and dirty-state sentinel.
 */
export function AppBootstrap() {
  const [idbError, setIdbError] = useState<string | null>(null);
  const gcTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDirty = useSaveBarrierStore((s) => s.isDirty);
  const isFlushing = useSaveBarrierStore((s) => s.isFlushing);

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

  useEffect(() => {
    // ── Always-available test hooks ────────────────────────────────────────────
    // These are harmless in production: __auditTriggerDirty is a no-op unless
    // explicitly called; the console.info interceptor only writes when
    // window.__synapseAudit is set (by resetAuditBuffers in tests or by the
    // AUDIT_MODE init block below).

    // Test hook: directly trigger dirty state without a real project mutation.
    // Used by nav-durability spec to reliably seed dirty=true before the nav guard test.
    (window as Record<string, unknown>)["__auditTriggerDirty"] = () => {
      useSaveBarrierStore.getState().setDirty(true);
    };

    // console.info interceptor: capture [SynapseExport] SUMMARY lines.
    // Uses optional chaining — no-op in production where window.__synapseAudit is null.
    const originalInfo = console.info.bind(console);
    console.info = (...args: unknown[]) => {
      originalInfo(...args);
      const line = args.join(" ");
      if (line.includes("[SynapseExport] SUMMARY")) {
        window.__synapseAudit?.exportSummaries.push(line);
      }
    };

    // ── AUDIT_MODE-only hooks (expensive / not needed in production) ───────────
    let obs: PerformanceObserver | null = null;
    if (process.env.NEXT_PUBLIC_AUDIT_MODE === "1") {
      window.__synapseAudit = { longTasks: [], exportSummaries: [], workerEvents: [] };

      // PerformanceObserver: capture long tasks in Date.now() epoch domain
      if (typeof PerformanceObserver !== "undefined") {
        obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__synapseAudit!.longTasks.push({
              epochStartTime: Math.round(performance.timeOrigin + e.startTime),
              duration: e.duration,
              name: e.name,
            });
          }
        });
        try {
          obs.observe({ type: "longtask", buffered: true });
        } catch {
          // longtask not supported in this context — safe to ignore
        }
      }
    }

    return () => {
      obs?.disconnect();
      console.info = originalInfo;
    };
  }, []);

  if (!idbError) {
    // Always render the dirty-state sentinel (audit hook) — sr-only, never visible to users
    return (
      <span
        data-testid="dirty-state-indicator"
        data-dirty={isDirty ? "true" : "false"}
        data-flushing={isFlushing ? "true" : "false"}
        className="sr-only"
        aria-hidden
      />
    );
  }

  return (
    <>
      <span
        data-testid="dirty-state-indicator"
        data-dirty={isDirty ? "true" : "false"}
        data-flushing={isFlushing ? "true" : "false"}
        className="sr-only"
        aria-hidden
      />
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 flex items-center gap-2 rounded-full border border-red-500/30 bg-[#1c1c1c]/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        <span className="text-xs font-semibold text-red-300">{idbError}</span>
      </div>
    </>
  );
}
