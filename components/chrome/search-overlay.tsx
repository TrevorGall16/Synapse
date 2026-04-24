"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { useUiStore } from "@/lib/store/ui-store";
import { GlobalSearch } from "@/components/feed/global-search";
import { useFeedStore } from "@/lib/store/feed-store";

export function SearchOverlay() {
  const open  = useUiStore((s) => s.searchOverlayOpen);
  const close = useUiStore((s) => s.closeSearchOverlay);
  // Mirror the same filter the feed page uses so autocomplete sees identical content.
  const userPosts = useFeedStore((s) => s.userPosts);
  const posts = useMemo(
    () => userPosts.filter((p) => !p.type || p.type === "video"),
    [userPosts],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm pt-[20vh]"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="relative w-full max-w-2xl mx-4">
        <button
          type="button"
          onClick={close}
          aria-label="Close search"
          className="absolute -right-2 -top-12 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        >
          <X size={18} />
        </button>
        <GlobalSearch posts={posts} />
      </div>
    </div>
  );
}
