"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Search, X, Video, User as UserIcon, Hash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSearchStore } from "@/lib/store/search-store";
import type { FeedPost } from "@/lib/store/feed-store";
import { normalizeTag } from "@/lib/mock-posts";
import { buildPostIndex, rankPosts, fuzzyMatch } from "@/lib/search-index";

type ResultKind = "video" | "creator" | "tag";
interface Result {
  kind: ResultKind;
  id: string;      // stable key
  label: string;   // primary display
  sub?: string;    // secondary display
  payload: string; // routing target
}

interface Props {
  /** Candidate posts to search across. Caller passes the merged user + mock list. */
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

  const clear = useCallback(() => {
    setSearchQuery("");
    inputRef.current?.focus();
  }, [setSearchQuery]);

  // Cmd/Ctrl+K: focus + open dropdown from anywhere on the page.
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

  // Click outside → close dropdown (keeps query in the input).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Derived index — memoized on the posts array identity. Caller (home feed)
  // already memoizes allPosts, so this only rebuilds when the catalog changes.
  const index = useMemo(() => buildPostIndex(posts), [posts]);

  // Grouped results — uses index byTag/byCreator for O(1) lookups where
  // possible, and weighted scoring (title > tags > desc > creator) for videos.
  const { videos, creators, tags, flat } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { videos: [] as Result[], creators: [] as Result[], tags: [] as Result[], flat: [] as Result[] };
    const raw = q.replace(/^[@#]/, "");

    // Videos: weighted relevance via scorePost, bounded to 6.
    const ranked = rankPosts(posts, raw, 6);
    const videoRes: Result[] = ranked.map((p) => ({
      kind: "video",
      id: `v-${p.id}`,
      label: p.title,
      sub: `@${p.user.handle}`,
      payload: p.id,
    }));

    // Creators: substring on handle; fallback to fuzzyMatch for longer queries.
    const creatorRes: Result[] = [];
    const seenCreators = new Set<string>();
    for (const [handle] of index.byCreator) {
      if (seenCreators.has(handle)) continue;
      if (handle.includes(raw) || fuzzyMatch(handle, raw)) {
        creatorRes.push({
          kind: "creator",
          id: `c-${handle}`,
          label: `@${handle}`,
          payload: handle,
        });
        seenCreators.add(handle);
        if (creatorRes.length >= 5) break;
      }
    }

    // Tags: substring on normalized tag; fuzzyMatch for longer queries.
    const tagRes: Result[] = [];
    const rawNorm = normalizeTag(raw);
    for (const [tag] of index.byTag) {
      if (tag.includes(rawNorm) || fuzzyMatch(tag, rawNorm)) {
        tagRes.push({ kind: "tag", id: `t-${tag}`, label: `#${tag}`, payload: tag });
        if (tagRes.length >= 8) break;
      }
    }

    return {
      videos: videoRes,
      creators: creatorRes,
      tags: tagRes,
      flat: [...videoRes, ...creatorRes, ...tagRes],
    };
  }, [index, posts, searchQuery]);

  // Reset highlight whenever results change.
  useEffect(() => { setHi(0); }, [searchQuery]);

  const navigate = useCallback((r: Result) => {
    setOpen(false);
    if (r.kind === "video") {
      router.push(`/video/${r.payload}`);
    } else if (r.kind === "creator") {
      router.push(`/profile/${r.payload}`);
    } else {
      // Tag: sync the global search store + URL so the home feed filters instantly.
      setSearchQuery(r.payload);
      router.push(`/?search=${encodeURIComponent(r.payload)}`);
    }
  }, [router, setSearchQuery]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); clear(); return; }
    if (!open) { if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true); }
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
          const Icon = r.kind === "video" ? Video : r.kind === "creator" ? UserIcon : Hash;
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
              {r.sub && <span className="shrink-0 text-[10px] text-white/35">{r.sub}</span>}
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
          placeholder="Search videos, creators, tags…"
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
        {/* ⌘K hint — rendered as a proper <kbd> chip. Hidden on coarse
             pointer devices (touch) AND narrow viewports; only shown to
             users who actually have a keyboard. */}
        <kbd
          aria-hidden="true"
          className="synapse-kbd-chip hidden shrink-0 items-center rounded border border-white/15 bg-white/[0.04] px-1.5 text-[10px] font-mono font-semibold leading-[1.4] tracking-wider text-white/55 shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)] sm:inline-flex"
        >
          ⌘K
        </kbd>
      </div>

      {showDropdown && (
        <div className="absolute left-1/2 top-full z-50 mt-2 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-white/12 bg-[#141414]/95 shadow-2xl backdrop-blur-xl">
          {flat.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
              {renderGroup("Videos", videos, 0)}
              {renderGroup("Creators", creators, videos.length)}
              {renderGroup("Tags", tags, videos.length + creators.length)}
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
