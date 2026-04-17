"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Search, X, User as UserIcon, Hash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSearchStore } from "@/lib/store/search-store";
import type { FeedPost } from "@/lib/store/feed-store";
import { channelSlug, type Channel } from "@/lib/config/taxonomy";
import { buildAutocompleteSuggestions } from "@/lib/search-autocomplete";

type ResultKind = "channel" | "creator";
interface Result {
  kind: ResultKind;
  id: string;     // stable key
  label: string;  // primary display, e.g. "#Anal" or "@aurora_vj"
  payload: string; // channel name OR creator handle
}

interface Props {
  /** Candidate posts — used only as the creator-handle source. */
  posts?: FeedPost[];
}

export function GlobalSearch({ posts = [] }: Props) {
  const router = useRouter();
  const searchQuery    = useSearchStore((s) => s.searchQuery);
  const setSearchQuery = useSearchStore((s) => s.setSearchQuery);

  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef  = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi]     = useState(0);
  // Reset highlight on every query change — derived, not in an effect.
  const [prevQuery, setPrevQuery] = useState(searchQuery);
  if (prevQuery !== searchQuery) {
    setPrevQuery(searchQuery);
    setHi(0);
  }

  const clear = useCallback(() => {
    setSearchQuery("");
    inputRef.current?.focus();
  }, [setSearchQuery]);

  // Cmd/Ctrl+K: global focus shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside → close dropdown; query stays in the input.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const { channels, creators, flat } = useMemo(() => {
    const { channels, creators } = buildAutocompleteSuggestions(posts, searchQuery);
    const channelRes: Result[] = channels.map((c) => ({
      kind: "channel",
      id: `ch-${c}`,
      label: `#${c}`,
      payload: c,
    }));
    const creatorRes: Result[] = creators.map((h) => ({
      kind: "creator",
      id: `cr-${h}`,
      label: `@${h}`,
      payload: h,
    }));
    return { channels: channelRes, creators: creatorRes, flat: [...channelRes, ...creatorRes] };
  }, [posts, searchQuery]);

  const navigate = useCallback((r: Result) => {
    setOpen(false);
    if (r.kind === "channel") {
      // Channel selected → activate channel filter on the home feed and
      // clear the free-text query so the filter is unambiguous.
      setSearchQuery("");
      router.push(`/?channel=${channelSlug(r.payload as Channel)}`);
    } else {
      router.push(`/profile/${r.payload}`);
    }
  }, [router, setSearchQuery]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape closes the dropdown but keeps the query.
    if (e.key === "Escape") { setOpen(false); return; }
    // Tab is not intercepted — native focus traversal continues; blur closes the dropdown.
    if (e.key === "Tab") return;

    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) setOpen(true);
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % flat.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + flat.length) % flat.length); }
    else if (e.key === "Enter")  { e.preventDefault(); const r = flat[hi]; if (r) navigate(r); }
  };

  const renderGroup = (label: string, items: Result[], startIdx: number) => {
    if (items.length === 0) return null;
    return (
      <div className="px-1 pb-1">
        <div className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-widest text-white/35">{label}</div>
        {items.map((r, i) => {
          const idx = startIdx + i;
          const active = idx === hi;
          const Icon = r.kind === "channel" ? Hash : UserIcon;
          return (
            <button
              key={r.id}
              onMouseEnter={() => setHi(idx)}
              onMouseDown={(e) => { e.preventDefault(); navigate(r); }}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors ${
                active ? "bg-white/10" : "hover:bg-white/6"
              }`}
            >
              <Icon size={11} className="shrink-0 text-white/40" />
              <span className="flex-1 truncate text-[11px] text-white/85">{r.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const showDropdown = open && searchQuery.trim().length > 0;

  return (
    <div ref={wrapRef} className="relative shrink-0 border-b border-white/8 px-4 py-2">
      <div
        className={[
          "mx-auto flex max-w-xl items-center gap-2 rounded-full px-3 py-1.5",
          "bg-white/5 backdrop-blur-md",
          "ring-1 ring-inset ring-white/8",
          "transition-all duration-150",
          "focus-within:bg-white/8 focus-within:ring-brand/30",
        ].join(" ")}
      >
        <Search size={12} className="shrink-0 text-white/30" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setSearchQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder="Search channels & creators…"
          spellCheck={false}
          className="flex-1 bg-transparent text-[11px] text-white/80 placeholder:text-white/25 outline-none"
        />
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

      {showDropdown && (
        <div className="absolute left-1/2 top-full z-50 mt-2 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-white/12 bg-[#141414]/95 shadow-2xl backdrop-blur-xl">
          {flat.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
              {renderGroup("Channels", channels, 0)}
              {renderGroup("Creators", creators, channels.length)}
            </div>
          ) : (
            <div className="px-4 py-6 text-center">
              <p className="text-[11px] text-white/40">No results for &ldquo;{searchQuery}&rdquo;</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
