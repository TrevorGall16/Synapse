"use client";

import { useSaveBarrierStore } from "@/lib/store/save-barrier-store";

/**
 * Full-screen "Saving…" overlay.
 * Rendered at root layout level; visible only while isFlushing is true.
 * Blocks pointer events to prevent double-navigation during async flush.
 */
export function SaveBarrierOverlay() {
  const isFlushing = useSaveBarrierStore((s) => s.isFlushing);
  if (!isFlushing) return null;

  return (
    <div
      data-testid="save-barrier-overlay"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a]/40 backdrop-blur-[1px]"
      aria-live="polite"
      aria-label="Saving project"
    >
      <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#1e1e1e] px-5 py-4 shadow-2xl">
        <div className="h-2 w-2 animate-pulse rounded-full bg-purple-400" />
        <span className="text-[13px] font-medium text-white/70">Saving…</span>
      </div>
    </div>
  );
}
