"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { X, Volume2, VolumeX, History, GitBranch, MessageCircle } from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";
import { TheaterCell } from "./theater-cell";
import { CommentsDrawer } from "./theater/comments-drawer";
import { useSafeUrlSync } from "@/lib/hooks/use-safe-url-sync";
// Re-exported for backward compatibility — callers import primeTheaterGesture from this module.
export { primeTheaterGesture } from "./theater-gesture";

/** Width of the comments panel when open (desktop only) */
const COMMENTS_W = "350px";

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
  /** Called when the creator avatar/name is tapped inside a Theater cell. The
   *  ACTIVE post (the one visible in the viewport) is passed so callers can
   *  route to the correct profile even after vertical scroll has moved past
   *  the seed post. Invoked BEFORE any state teardown — callers must navigate
   *  synchronously so the router transition happens while the overlay is still
   *  mounted (prevents "/" fallback from a layout redirect). */
  onCreator: (post: FeedPost) => void;
  onHashtagClick?: (tag: string) => void;
  allPosts?: FeedPost[];
  onNavigate?: (post: FeedPost) => void;
  /** When provided, disables buildQueue reshuffling/recommendation logic.
   *  TheaterMode renders these posts in this exact order — used by Profile so the
   *  vertical scroll order matches the visual grid order (Up = previous, Down = next). */
  lockedQueue?: FeedPost[];
}

export function TheaterMode({ post, onClose, onRemix, onCreator, onHashtagClick, allPosts = [], lockedQueue }: TheaterModeProps) {
  const isLocked = !!lockedQueue;
  const [queue, setQueue]             = useState<FeedPost[]>(() => {
    if (lockedQueue && lockedQueue.length > 0) return lockedQueue;
    return buildQueue(post, allPosts);
  });
  const [muted, setMuted]             = useState(true);
  const [activePostId, setActivePostId] = useState(post.id);
  // Progressive hydration — only mount real <TheaterCell>s for ids in this set.
  // All other queue items render as lightweight placeholders that preserve scroll math.
  // Starts with just the seed, expands to seed±1 after first paint, then expands as IO
  // marks new active posts on scroll. Ids are never removed once hydrated.
  const [hydratedIds, setHydratedIds] = useState<Set<string>>(() => new Set([post.id]));
  const ensureHydrated = useCallback((ids: string[]) => {
    setHydratedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ids) if (id && !next.has(id)) { next.add(id); changed = true; }
      return changed ? next : prev;
    });
  }, []);
  const [showVersions, setShowVersions] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const toggleComments = useCallback(() => setCommentsOpen((v) => !v), []);
  const scrollRef               = useRef<HTMLDivElement>(null);
  const cellRefs                = useRef<Map<string, HTMLDivElement>>(new Map());
  const elementToPid            = useRef<WeakMap<HTMLDivElement, string>>(new WeakMap());
  const observerRef             = useRef<IntersectionObserver | null>(null);
  const { lightweightPush, lightweightReplace } = useSafeUrlSync("/");

  // Rebuild queue when seed post changes — skipped entirely when locked.
  // Why: subscribes to seed-post changes to rebuild the derived play queue.
  // setQueue is the UI-sync here; `buildQueue` is pure and the dep list is
  // deliberately narrow (post.id only — allPosts deltas don't re-shuffle an
  // open session, scroll-append handles those). No cascade risk.
  useEffect(() => {
    if (isLocked) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueue(buildQueue(post, allPosts));
  }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // After first paint: hydrate neighbors of the seed (prev + next) via rAF so
  // the shell becomes interactive before heavy cell work begins.
  useEffect(() => {
    const idx = queue.findIndex((p) => p.id === post.id);
    if (idx < 0) return;
    const r = requestAnimationFrame(() => {
      const ids: string[] = [];
      if (queue[idx - 1]) ids.push(queue[idx - 1].id);
      if (queue[idx + 1]) ids.push(queue[idx + 1].id);
      if (ids.length) ensureHydrated(ids);
    });
    return () => cancelAnimationFrame(r);
  }, [queue, post.id, ensureHydrated]);

  // When the active cell changes (scroll), hydrate it + its immediate neighbors.
  // Progressive: ids accumulate, so cells never unmount mid-session.
  // Why: subscribes to IntersectionObserver-driven activePostId changes. The
  // setState inside ensureHydrated is idempotent (returns prev when nothing
  // new, short-circuiting the render) so there is no cascade — each scroll
  // transition adds at most 3 ids once, then no-ops on re-entry.
  useEffect(() => {
    if (!activePostId) return;
    const idx = queue.findIndex((p) => p.id === activePostId);
    if (idx < 0) return;
    const ids = [activePostId];
    if (queue[idx - 1]) ids.push(queue[idx - 1].id);
    if (queue[idx + 1]) ids.push(queue[idx + 1].id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    ensureHydrated(ids);
  }, [activePostId, queue, ensureHydrated]);

  // Keyboard close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // URL masking via History API. Push-once rule: lightweightPush fires EXACTLY
  // ONCE per Theater session so the Home feed is the single "save point" in
  // the browser history. Subsequent seed/active changes use lightweightReplace
  // — swiping through 5 videos still leaves one Back press to reach Home.
  //
  // Popstate handling lives in the parent (app/page.tsx). It persists across
  // Theater unmount, so Forward-button reopen also works.
  const originalUrlRef = useRef(window.location.href);
  const hasPushedRef = useRef(false);

  useEffect(() => {
    if (!post.id) return;
    const targetPath = `/video/${post.id}`;
    if (window.location.pathname !== targetPath) {
      lightweightPush(targetPath, () => { /* no param change */ });
    }
    hasPushedRef.current = true;
    return () => {
      // Clean unmount (Escape/X button) restores the original URL. A back-button
      // close leaves pathname !== /video/... so this is a no-op; the parent's
      // popstate listener drove the state change there.
      if (window.location.pathname.startsWith("/video/")) {
        lightweightReplace(new URL(originalUrlRef.current).pathname, () => { /* preserve params */ });
      }
      hasPushedRef.current = false;
    };
    // Mount-once: post.id seed changes within an open session are handled by
    // the replace effect below, not a second push.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (isLocked) return; // locked queue: never append recommendations
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
  }, [allPosts, isLocked]);

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

  // Sync masked URL on any video change — scroll (activePostId) or seed swap
  // (post.id, e.g. from onNavigate). Always REPLACE so we never add history
  // entries; the single push from the mount effect remains the only save point.
  useEffect(() => {
    if (!hasPushedRef.current) return;
    const idForUrl = activePostId ?? post.id;
    if (!idForUrl) return;
    const targetPath = `/video/${idForUrl}`;
    if (window.location.pathname !== targetPath) {
      lightweightReplace(targetPath, () => { /* no param change */ });
    }
  }, [activePostId, post.id, lightweightReplace]);

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
    <div className="fixed inset-0 z-50 bg-[#0a0a0a]">
      {/* Versions drawer */}
      {showVersions && (
        <div className="fixed right-0 top-0 z-[55] flex h-full w-64 flex-col border-l border-white/10 bg-white/5 backdrop-blur-md backdrop-saturate-150">
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
                      <GitBranch size={8} className="text-brand-accent" />
                      <span className="text-[9px] text-brand-text">@{p.remixedFromHandle}</span>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Split-view container */}
      <div className="relative flex h-full w-full overflow-hidden">
        {/* Main content wrapper — video + overlays + top-right controls */}
        <div
          className="relative h-full w-full transition-[width] duration-300 ease-out"
          style={{
            width: commentsOpen ? `calc(100% - ${COMMENTS_W})` : "100%",
          }}
        >
          {/* Top-right controls: Versions | Mute | Close — absolute within wrapper */}
          <div className="absolute right-4 top-4 z-[100] flex items-center gap-2">
            {versionSiblings.length > 0 && (
              <button
                onClick={() => setShowVersions((v) => !v)}
                title="Versions"
                className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold backdrop-blur-sm transition-colors ${
                  showVersions
                    ? "border-brand-accent/50 bg-brand/25 text-brand-muted"
                    : "border-white/20 bg-[#0a0a0a]/60 text-white/70 hover:bg-white/15 hover:text-white"
                }`}
              >
                <History size={13} />
                {versionSiblings.length}
              </button>
            )}
            <button
              onClick={() => setMuted((v) => !v)}
              title={muted ? "Unmute" : "Mute"}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-[#0a0a0a]/80 text-white drop-shadow-lg backdrop-blur-sm transition-colors hover:bg-[#0a0a0a]/90"
            >
              {muted ? <VolumeX size={16} className="text-white" /> : <Volume2 size={16} className="text-white" />}
            </button>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-[#0a0a0a]/80 text-white/90 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
            >
              <X size={15} />
            </button>
          </div>

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-screen overflow-y-scroll snap-y snap-mandatory"
            style={{ scrollbarWidth: "none" }}
          >
            {Array.from(new Map(queue.map((p) => [p.id, p])).values()).map((p) => (
              hydratedIds.has(p.id) ? (
                <TheaterCell
                  key={p.id}
                  post={p}
                  isActive={activePostId === p.id}
                  cellRef={setCellRef(p.id)}
                  onRemix={onRemix}
                  onCreator={() => { hasPushedRef.current = false; onCreator(p); }}
                  onHashtagClick={onHashtagClick ?? (() => {})}
                  globalMuted={muted}
                  isCommentsOpen={commentsOpen}
                  onToggleComments={toggleComments}
                />
              ) : (
                // Placeholder: preserves snap/scroll math. Real <TheaterCell> mounts
                // once the cell enters viewport (IO → activePostId → ensureHydrated).
                <div
                  key={p.id}
                  ref={setCellRef(p.id)}
                  className="relative h-screen w-full snap-start flex items-center justify-center"
                  style={{ background: p.bg ?? "#0a0a0a" }}
                >
                  <div className="flex flex-col items-center gap-2 opacity-60">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Loading</span>
                  </div>
                </div>
              )
            ))}
          </div>
        </div>

        {/* Comments drawer — slides from right, zero width when closed.
            Only mount when activePostId is truthy to avoid setup with empty postId. */}
        {activePostId && (
          <CommentsDrawer
            postId={activePostId}
            isOpen={commentsOpen}
            onClose={toggleComments}
            commentsEnabled={activePost?.comments_enabled !== false}
          />
        )}
      </div>
    </div>
  );
}
