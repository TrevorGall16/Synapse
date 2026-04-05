"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { X, Volume2, VolumeX, History, GitBranch } from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";
import { TheaterCell } from "./theater-cell";
// Re-exported for backward compatibility — callers import primeTheaterGesture from this module.
export { primeTheaterGesture } from "./theater-gesture";

/** Build a strictly deduplicated queue: seed first, then same-author posts, then tag-matched, then rest */
function buildQueue(seed: FeedPost, all: FeedPost[]): FeedPost[] {
  const seen = new Set<string>([seed.id]);
  const byAuthor = all.filter((p) => p.id !== seed.id && p.user.handle === seed.user.handle);
  byAuthor.forEach((p) => seen.add(p.id)); // populate BEFORE byTag so author posts can't appear twice
  const byTag = all.filter((p) => !seen.has(p.id) && p.tags.some((t) => seed.tags.includes(t)));
  byTag.forEach((p) => seen.add(p.id));
  const rest = all.filter((p) => !seen.has(p.id));
  return [seed, ...byAuthor, ...byTag, ...rest].slice(0, 50);
}

// ── TheaterMode ────────────────────────────────────────────────────────────────
interface TheaterModeProps {
  post: FeedPost;
  onClose: () => void;
  onRemix: (post: FeedPost) => void;
  onCreator: () => void;
  onHashtagClick?: (tag: string) => void;
  allPosts?: FeedPost[];
  onNavigate?: (post: FeedPost) => void;
}

export function TheaterMode({ post, onClose, onRemix, onCreator, onHashtagClick, allPosts = [] }: TheaterModeProps) {
  const [queue, setQueue]             = useState<FeedPost[]>(() => buildQueue(post, allPosts));
  const [muted, setMuted]             = useState(true);
  const [activePostId, setActivePostId] = useState(post.id);
  const [showVersions, setShowVersions] = useState(false);
  const scrollRef               = useRef<HTMLDivElement>(null);
  const cellRefs                = useRef<Map<string, HTMLDivElement>>(new Map());
  const elementToPid            = useRef<WeakMap<HTMLDivElement, string>>(new WeakMap());
  const observerRef             = useRef<IntersectionObserver | null>(null);

  // Rebuild queue when seed post changes
  useEffect(() => { setQueue(buildQueue(post, allPosts)); }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // URL masking via History API — push /video/:id on open, restore on close/back
  const originalUrlRef = useRef(window.location.href);
  const hasPushedRef = useRef(false);

  useEffect(() => {
    if (!post.id) return;
    const targetPath = `/video/${post.id}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ synapse_theater: true }, "", targetPath);
      hasPushedRef.current = true;
    }
    const onPopState = () => {
      // User hit browser Back — close the overlay instead of navigating.
      // Mark that Back already restored the URL so the cleanup doesn't double-navigate.
      hasPushedRef.current = false;
      onClose();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Restore original URL when Theater unmounts via normal close (not back-button)
      if (hasPushedRef.current) {
        window.history.replaceState(null, "", originalUrlRef.current);
        hasPushedRef.current = false;
      }
    };
  }, [post.id, onClose]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Scroll seed post into view on open
  useEffect(() => {
    const el = cellRefs.current.get(post.id);
    el?.scrollIntoView({ behavior: "instant" });
  }, [post.id]);

  // IntersectionObserver — play/pause videos as cells enter/leave the viewport
  useEffect(() => {
    observerRef.current?.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const pid = elementToPid.current.get(entry.target as HTMLDivElement);
          if (pid) setActivePostId(pid);
        }
      },
      { threshold: 0.6 }
    );

    cellRefs.current.forEach((el) => observer.observe(el));
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [queue.length]);

  // Load more when scrolling near the end
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - el.clientHeight * 1.5;
    if (nearBottom) {
      setQueue((prev) => {
        const extra = allPosts.filter((p) => !prev.some((q) => q.id === p.id));
        if (!extra.length) return prev;
        return [...prev, ...extra.slice(0, 10)];
      });
    }
  }, [allPosts]);

  const setCellRef = useCallback((postId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      cellRefs.current.set(postId, el);
      elementToPid.current.set(el, postId);
      observerRef.current?.observe(el);
    } else {
      cellRefs.current.delete(postId);
      // WeakMap self-cleans when el is GC'd — no delete needed
    }
  }, []);

  // Update masked URL when active post changes (scroll between videos)
  useEffect(() => {
    if (!activePostId || !hasPushedRef.current) return;
    const targetPath = `/video/${activePostId}`;
    if (window.location.pathname !== targetPath) {
      window.history.replaceState({ synapse_theater: true }, "", targetPath);
    }
  }, [activePostId]);

  const activePost = useMemo(() => queue.find((p) => p.id === activePostId) ?? queue[0], [queue, activePostId]);
  const versionSiblings = useMemo(() => {
    if (!activePost) return [];
    const root = activePost.rootParentId ?? (activePost.remixedFromPostId ? activePost.id : null);
    if (!root && !activePost.remixedFromPostId) return [];
    return allPosts.filter((p) =>
      p.id !== activePost.id &&
      (p.rootParentId === root || p.rootParentId === activePost.id || p.remixedFromPostId === activePost.id)
    );
  }, [activePost, allPosts]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Top-right controls: Versions | Mute | Close */}
      <div className="fixed right-4 top-4 z-[100] flex items-center gap-2">
        {versionSiblings.length > 0 && (
          <button
            onClick={() => setShowVersions((v) => !v)}
            title="Versions"
            className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold backdrop-blur-sm transition-colors ${
              showVersions
                ? "border-purple-400/50 bg-purple-500/25 text-purple-200"
                : "border-white/20 bg-black/60 text-white/70 hover:bg-white/15 hover:text-white"
            }`}
          >
            <History size={13} />
            {versionSiblings.length}
          </button>
        )}
        <button
          onClick={() => setMuted((v) => !v)}
          title={muted ? "Unmute" : "Mute"}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/80 text-white drop-shadow-lg backdrop-blur-sm transition-colors hover:bg-black/90"
        >
          {muted ? <VolumeX size={16} className="text-white" /> : <Volume2 size={16} className="text-white" />}
        </button>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/80 text-white/90 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
        >
          <X size={15} />
        </button>
      </div>

      {/* Versions drawer */}
      {showVersions && (
        <div className="fixed right-0 top-0 z-[55] flex h-full w-64 flex-col border-l border-white/10 bg-black/90 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-xs font-bold text-white/80">Versions ({versionSiblings.length})</span>
            <button onClick={() => setShowVersions(false)} className="text-white/40 hover:text-white"><X size={13} /></button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {versionSiblings.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  const el = cellRefs.current.get(p.id);
                  if (el) { el.scrollIntoView({ behavior: "smooth" }); }
                  else {
                    setQueue((prev) => prev.some((q) => q.id === p.id) ? prev : [p, ...prev]);
                    setTimeout(() => cellRefs.current.get(p.id)?.scrollIntoView({ behavior: "smooth" }), 120);
                  }
                  setShowVersions(false);
                }}
                className="flex w-full items-start gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/5"
              >
                <div
                  className="h-14 w-10 shrink-0 overflow-hidden rounded-md"
                  style={{ background: p.bg ?? "#1a1a1a" }}
                >
                  {p.videoUrl && (
                    <video
                      src={p.videoUrl}
                      muted playsInline preload="none"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-white/90">{p.title}</p>
                  <p className="text-[10px] text-white/40">@{p.user.handle}</p>
                  {p.remixedFromHandle && (
                    <div className="mt-1 flex items-center gap-1">
                      <GitBranch size={8} className="text-purple-400" />
                      <span className="text-[9px] text-purple-300">@{p.remixedFromHandle}</span>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Vertical snap-scroll feed — deduplicate at render time as a final safety net */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-screen overflow-y-scroll snap-y snap-mandatory"
        style={{ scrollbarWidth: "none" }}
      >
        {Array.from(new Map(queue.map((p) => [p.id, p])).values()).map((p) => (
          <TheaterCell
            key={p.id}
            post={p}
            isActive={activePostId === p.id}
            cellRef={setCellRef(p.id)}
            onRemix={onRemix}
            onCreator={onCreator}
            onHashtagClick={onHashtagClick ?? (() => {})}
            globalMuted={muted}
          />
        ))}
      </div>
    </div>
  );
}
