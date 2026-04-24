"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useUiStore } from "@/lib/store/ui-store";

export function SearchOverlay() {
  const open = useUiStore((s) => s.searchOverlayOpen);
  const close = useUiStore((s) => s.closeSearchOverlay);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      // Defer one tick so the DOM is visible before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm pt-[20vh]"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="glass-pill flex w-full max-w-xl flex-col gap-3 p-4 mx-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="search"
            placeholder="Search Synapse…"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 outline-none"
          />
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-white/30">Start typing to search posts, creators, and sounds.</p>
      </div>
    </div>
  );
}
