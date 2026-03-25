"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { useSearchStore } from "@/lib/store/search-store";

export function GlobalSearch() {
  const searchQuery    = useSearchStore((s) => s.searchQuery);
  const setSearchQuery = useSearchStore((s) => s.setSearchQuery);
  const inputRef       = useRef<HTMLInputElement>(null);

  const clear = () => {
    setSearchQuery("");
    inputRef.current?.focus();
  };

  return (
    <div className="shrink-0 border-b border-white/8 px-4 py-2">
      <div
        className={[
          "flex items-center gap-2 rounded-full px-3 py-1.5",
          "bg-white/5 backdrop-blur-md",
          "ring-1 ring-inset ring-white/8",
          "transition-all duration-150",
          "focus-within:bg-white/8 focus-within:ring-purple-500/25",
        ].join(" ")}
      >
        <Search size={12} className="shrink-0 text-white/30" />

        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") clear(); }}
          placeholder="Search creators, tags, effects…"
          spellCheck={false}
          className="flex-1 bg-transparent text-[11px] text-white/80 placeholder:text-white/25 outline-none"
        />

        {/* result hint — appears once user is typing */}
        {searchQuery && (
          <button
            onClick={clear}
            aria-label="Clear search"
            className="shrink-0 rounded-full p-0.5 text-white/30 transition-colors hover:text-white/70"
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
