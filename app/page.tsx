"use client";

import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Zap, TrendingUp, Upload, User, ArrowUp, Trash2 } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore, type FeedPost, isBlobUrl } from "@/lib/store/feed-store";
import { useSearchStore } from "@/lib/store/search-store";
import { useUserStore } from "@/lib/store/user-store";
import { TheaterMode, primeTheaterGesture } from "@/components/feed/theater-mode";
import { GlobalSearch } from "@/components/feed/global-search";
import { FeedPostCard } from "@/components/feed/feed-post-card";
import { retainMedia } from "@/lib/store/media-pool-db";
import type { Track, ProjectSettings, MediaPoolItem } from "@/lib/store/types";
import { normalizeTag } from "@/lib/mock-posts";
import { rankPosts } from "@/lib/search-index";
import { NICHE_TAGS as OFFICIAL_CATEGORIES } from "@/lib/config/taxonomy";
import { rankByWindow, TIME_WINDOWS, TIME_WINDOW_LABEL, DEFAULT_WINDOW_FOR_SORT, type TimeWindow } from "@/lib/ranking";
import { navigateToCreator } from "@/lib/nav/theater-nav";

// ── Demo snapshot ─────────────────────────────────────────────────────────────
function buildDemoSnapshot(id: string, title: string) {
  const ps: ProjectSettings = { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1.0, gammaTag: "sRGB" };
  return {
    projectId: id,
    tracks: [
      { id: `${id}-fx`,  type: "effect" as const, name: "FX Layer", color: "#7c3aed", height: 48, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: [{ id: `${id}-fx-c`,  trackId: `${id}-fx`,  sourceId: "fx-gen",  startTime: 0, duration: 30_000_000, mediaOffset: 0 }] },
      { id: `${id}-txt`, type: "text"   as const, name: "Text",     color: "#f59e0b", height: 40, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: [{ id: `${id}-txt-c`, trackId: `${id}-txt`, sourceId: "txt-gen", startTime: 0, duration: 15_000_000, mediaOffset: 0, fxParams: { text: title } }] },
    ] as Track[],
    duration: 60_000_000,
    projectSettings: ps,
  };
}

// ── Static mock posts ─────────────────────────────────────────────────────────
const MOCK_POSTS: FeedPost[] = [
  { id: "1", user: { handle: "aurora_vj",    initial: "A", hue: 270 }, title: "Strobing Bass Drop Edit",   tags: ["#techno","#hypnotic"],    bg: "#1a0a2e", accent: "#7c3aed", duration: "0:42", likes: 2847, comments: 142, featured: true  },
  { id: "2", user: { handle: "neon_cut",     initial: "N", hue: 340 }, title: "RGB Glitch Cascade",        tags: ["#glitch","#edm"],         bg: "#1a0818", accent: "#ec4899", duration: "0:30", likes: 1923, comments: 88,  featured: false },
  { id: "3", user: { handle: "spectral_x",  initial: "S", hue: 200 }, title: "Hypno Tunnel Loop",         tags: ["#psy","#loop"],           bg: "#071a1a", accent: "#06b6d4", duration: "1:04", likes: 3410, comments: 211, featured: false },
  { id: "4", user: { handle: "hue.shift",   initial: "H", hue: 30  }, title: "Chromatic Aberration Pack", tags: ["#vfx","#bass"],           bg: "#1a1100", accent: "#f59e0b", duration: "0:55", likes: 891,  comments: 47,  featured: false },
  { id: "5", user: { handle: "deep.freq",   initial: "D", hue: 150 }, title: "Pixel Sort Waveform",       tags: ["#experimental","#lo-fi"], bg: "#051a0a", accent: "#22c55e", duration: "0:37", likes: 2104, comments: 93,  featured: false },
  { id: "6", user: { handle: "void_signal", initial: "V", hue: 0   }, title: "Infrared Strobe Cut",       tags: ["#industrial","#harsh"],   bg: "#1a0500", accent: "#ef4444", duration: "0:28", likes: 1650, comments: 72,  featured: false },
  { id: "7", user: { handle: "prismatic",   initial: "P", hue: 300 }, title: "Kaleidoscope Crossfade",    tags: ["#ambient","#visual"],     bg: "#160a1a", accent: "#a855f7", duration: "2:10", likes: 4201, comments: 317, featured: true  },
  { id: "8", user: { handle: "lo.form",     initial: "L", hue: 185 }, title: "Scan Line Retro Mix",       tags: ["#retrowave","#vhs"],      bg: "#071018", accent: "#38bdf8", duration: "1:20", likes: 1389, comments: 61,  featured: false },
  { id: "9", user: { handle: "bpmviz",      initial: "B", hue: 45  }, title: "Beat-Sync Flash Grid",      tags: ["#dnb","#reactive"],       bg: "#180e00", accent: "#fb923c", duration: "0:48", likes: 3027, comments: 184, featured: false },
];

// ── Deterministic infinite-scroll generator ───────────────────────────────────
function generateMorePosts(pageNum: number): FeedPost[] {
  return Array.from({ length: 10 }, (_, i) => {
    const src = MOCK_POSTS[(pageNum * 10 + i) % MOCK_POSTS.length];
    const v   = pageNum * 10 + i + 10;
    return { ...src, id: `gen-${pageNum}-${i}`, title: `${src.title} • Vol. ${pageNum + 1}`, likes: src.likes + v * 37, comments: src.comments + v * 7, featured: false };
  });
}

// ── Niche chip ────────────────────────────────────────────────────────────────
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-semibold transition-colors ${
        active ? "bg-brand/28 text-brand-muted ring-1 ring-brand/40" : "bg-white/6 text-white/40 hover:bg-white/12 hover:text-white/65"
      }`}
    >{label}</button>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/14 bg-[#1c1c1c]/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-accent" /><span className="text-xs font-semibold text-white/90">{msg}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DiscoveryFeedPage() {
  const router = useRouter();
  const [theaterPostId, setTheaterPostId] = useState<string | null>(null);
  const [activeTag, setActiveTag]     = useState<string | null>(null);
  const [feedSort, setFeedSort]       = useState<"latest" | "popular" | "trending">("latest");
  const [timeWindow, setTimeWindow]   = useState<TimeWindow>(DEFAULT_WINDOW_FOR_SORT.latest);
  // Track which sort modes the user has explicitly tuned so we don't clobber
  // their window choice when they pill-hop between sorts.
  const windowTouchedRef = useRef<Set<"latest" | "popular" | "trending">>(new Set());
  const handleSortChange = useCallback((s: "latest" | "popular" | "trending") => {
    setFeedSort(s);
    if (!windowTouchedRef.current.has(s)) {
      setTimeWindow(DEFAULT_WINDOW_FOR_SORT[s]);
    }
  }, []);
  const handleWindowChange = useCallback((w: TimeWindow) => {
    setTimeWindow(w);
    windowTouchedRef.current.add(feedSort);
  }, [feedSort]);
  const [toast, setToast]             = useState<string | null>(null);

  const [loadedPages, setLoadedPages]     = useState(1);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef        = useRef<HTMLDivElement>(null);

  const userPosts      = useFeedStore((s) => s.userPosts);
  const removePost     = useFeedStore((s) => s.removePost);
  const likedPostIds   = useFeedStore((s) => s.likedPostIds);
  const offlineCount   = useFeedStore((s) => s.userPosts.filter((p) => isBlobUrl(p.videoUrl)).length);
  const searchQuery    = useSearchStore((s) => s.searchQuery);
  const setSearchQuery = useSearchStore((s) => s.setSearchQuery);
  const currentProfile = useUserStore((s) => s.profile);
  const followingList  = useUserStore((s) => s.following);
  const cleanupOffline = useCallback(() => {
    const { userPosts: posts, removePost: rp } = useFeedStore.getState();
    posts.filter((p) => isBlobUrl(p.videoUrl)).forEach((p) => rp(p.id));
  }, []);
  const openProjectInTab = useProjectStore((s) => s.openProjectInTab);
  const addMediaItem = useProjectStore((s) => s.addMediaItem);
  const addClip      = useProjectStore((s) => s.addClip);
  const loadProject  = useProjectStore((s) => s.loadProject);
  const tracks       = useProjectStore((s) => s.tracks);

  // Merge user posts + infinite mock pages; deduplicate tags for filter bar
  const allMockPosts = useMemo(() => {
    const extra: FeedPost[] = [];
    for (let p = 1; p < loadedPages; p++) extra.push(...generateMorePosts(p));
    return [...MOCK_POSTS, ...extra];
  }, [loadedPages]);
  // Exclude preset posts — they have no video and show as "Media Offline" on the home feed
  const videoUserPosts = useMemo(() => userPosts.filter((p) => !p.type || p.type === "video"), [userPosts]);
  const allPosts = useMemo(() => [...videoUserPosts, ...allMockPosts], [videoUserPosts, allMockPosts]);
  // Derive reactively so TheaterMode always gets fresh URLs after GlobalHydrator finishes
  const theaterPost = useMemo(
    () => (theaterPostId ? allPosts.find((p) => p.id === theaterPostId) ?? null : null),
    [theaterPostId, allPosts],
  );
  // Stable Set for O(1) membership checks in scoring + re-ordering.
  const followedSet = useMemo(() => new Set(followingList), [followingList]);

  const displayPosts = useMemo(() => {
    // Tag filter: compare on normalized form so "#Glitch" and "glitch" match.
    const nActive = activeTag ? normalizeTag(activeTag) : null;
    const base = nActive
      ? allPosts.filter((p) => p.tags.some((t) => normalizeTag(t) === nActive))
      : allPosts;
    // Latest in "all" window preserves the upstream chronological order so
    // newly-uploaded posts stay on top without needing createdAt on mocks.
    if (feedSort === "latest" && timeWindow === "all") return base;
    return rankByWindow(base, feedSort, timeWindow, { likeBoostIds: likedPostIds });
  }, [activeTag, allPosts, feedSort, timeWindow, likedPostIds]);

  // Search filter — deterministic tiered ranking (exact title > prefix > substring
  // > tags > description > creator). Within a tier, engagement + follow-boost
  // decide order. rankPosts bounds the output so the feed stays responsive
  // under simulated large datasets.
  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) {
      // No query: apply a stable follow-boost re-ordering on top of the sort
      // mode. Followed creators float up; non-followed posts are NOT filtered
      // out — just pushed down. JS Array.sort is stable (V8), so within each
      // group the upstream sort order (latest/popular/trending) is preserved.
      if (followedSet.size === 0) return displayPosts;
      return [...displayPosts].sort((a, b) => {
        const aF = followedSet.has(a.user.handle) ? 1 : 0;
        const bF = followedSet.has(b.user.handle) ? 1 : 0;
        return bF - aF;
      });
    }
    // Feed the active sort mode as an intra-tier tiebreaker so the pill
    // selection (Latest / Popular / Trending) decides order within each
    // relevance tier without ever crossing a tier boundary.
    return rankPosts(displayPosts, q, 200, {
      followedHandles: followedSet,
      sortMode: feedSort,
    });
  }, [displayPosts, searchQuery, followedSet, feedSort]);

  // Hydrate search/tag filter from URL on mount — so external links
  // (e.g. from global search tag results, or a refresh) restore the filter state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("search");
    const t = params.get("tag");
    if (t) {
      const norm = t.startsWith("#") ? t : `#${t}`;
      setActiveTag(norm);
      setSearchQuery(t.replace(/^#/, ""));
    } else if (s) {
      setSearchQuery(s);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll — load more when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setLoadedPages((p) => p + 1); },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Back-to-top visibility
  const handleScroll = useCallback(() => {
    setShowBackToTop((scrollContainerRef.current?.scrollTop ?? 0) > 2000);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const showToast = (msg: string, delay = 700) => {
    setToast(msg);
    setTimeout(() => router.push("/studio"), delay);
    setTimeout(() => setToast(null), delay + 900);
  };

  const handleRemix = (post: FeedPost) => {
    const remixMeta = {
      parentProjectId: post.id,
      remixedFromHandle: post.user.handle,
      rootParentId: post.rootParentId ?? post.id,
      rootParentHandle: post.rootParentHandle ?? post.user.handle,
    };
    const snap = post.projectSnapshot;
    const duration = snap?.duration ?? 30_000_000;
    const settings = snap?.projectSettings ?? { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1.0, gammaTag: "sRGB" };

    // Preserve all media pool items so IDB hydration (keyed by original ID) works.
    // Retain each blob in IDB so deleting the source post doesn't evict shared assets.
    const flatMedia: MediaPoolItem[] = snap?.mediaPool
      ? [...snap.mediaPool]
      : post.videoUrl
        ? [{ id: crypto.randomUUID(), name: post.title, type: "video" as const, duration, previewUrl: post.videoUrl }]
        : [];
    if (snap?.mediaPool) snap.mediaPool.forEach((m) => retainMedia(m.id).catch(console.warn));

    const trackId = crypto.randomUUID();
    const audioId = crypto.randomUUID();

    // Global effect + text pools for per-clip baking
    const allEffectClips = snap ? snap.tracks.filter((t) => t.type === "effect").flatMap((t) => t.clips) : [];
    const allTextClips   = snap ? snap.tracks.filter((t) => t.type === "text").flatMap((t) => t.clips)   : [];
    const overlapping = <T extends { startTime: number; duration: number }>(pool: T[], target: T) =>
      pool.filter((e) => e.startTime < target.startTime + target.duration && e.startTime + e.duration > target.startTime);

    // Flatten ALL video clips onto Video 1, baking overlapping effects + text per-clip
    const allVideoClips = snap
      ? snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime)
      : [];
    const flatVideoClips = allVideoClips.length > 0
      ? allVideoClips.map((c) => {
          const efx = overlapping(allEffectClips, c);
          const txt = overlapping(allTextClips, c);
          return { ...c, id: crypto.randomUUID(), trackId, ...(efx.length ? { embeddedEffectClips: efx } : {}), ...(txt.length ? { embeddedTextClips: txt } : {}) };
        })
      : flatMedia[0]
        ? [{ id: crypto.randomUUID(), trackId, sourceId: flatMedia[0].id, startTime: 0, duration, mediaOffset: 0 }]
        : [];

    // Flatten ALL audio clips onto Audio 1 (preserves multi-clip audio sync)
    const flatAudioClips = snap
      ? snap.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime)
          .map((c) => ({ ...c, id: crypto.randomUUID(), trackId: audioId }))
      : [];

    const flatTracks: Track[] = [
      { id: trackId, type: "video", name: "Video 1", color: "#3b82f6", height: 60, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: flatVideoClips },
      { id: audioId, type: "audio", name: "Audio 1", color: "#22c55e", height: 48, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: flatAudioClips },
    ];

    openProjectInTab({ tracks: flatTracks, mediaPool: flatMedia, duration: duration + 5_000_000, projectSettings: settings, name: `Remix: ${post.title}`, ...remixMeta });
    showToast("Opening remix in Studio…");
  };

  const showImportToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleImport = (post: FeedPost) => {
    const snap = post.projectSnapshot;
    const origMedia = snap?.mediaPool?.find((m) => m.type === "video");
    const videoUrl = post.videoUrl ?? origMedia?.previewUrl;
    if (!videoUrl) { showImportToast("No video to import"); return; }
    const item: MediaPoolItem = {
      id: origMedia?.id ?? crypto.randomUUID(),
      name: origMedia?.name ?? post.title,
      type: "video",
      duration: origMedia?.duration ?? snap?.duration ?? 30_000_000,
      previewUrl: videoUrl,
    };
    addMediaItem(item);
    showImportToast("Saved to Media Pool");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      {/* Header */}
      <div className="z-10 shrink-0 flex items-center justify-between border-b border-white/10 bg-[#141414]/95 px-5 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <TrendingUp size={13} className="text-white/35" />
          <h1 className="text-sm font-bold text-white">Discovery</h1>
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/35">Trending</span>
        </div>
        <div className="flex items-center gap-2">
          {offlineCount > 0 && (
            <button onClick={cleanupOffline}
              className="flex items-center gap-1.5 rounded-lg bg-orange-500/14 px-2.5 py-1.5 text-[11px] font-semibold text-orange-300/80 transition-colors hover:bg-orange-500/24 hover:text-orange-200">
              <Trash2 size={10} />Clean Up ({offlineCount})
            </button>
          )}
          <button onClick={() => router.push("/upload")} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/14 hover:text-white">
            <Upload size={11} />Upload
          </button>
          <button onClick={() => router.push("/profile/you")} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/14 hover:text-white">
            <User size={11} />Profile
          </button>
          <button onClick={() => router.push("/studio")} className="flex items-center gap-1.5 rounded-lg bg-brand/20 px-2.5 py-1.5 text-[11px] font-bold text-brand-text transition-colors hover:bg-brand/30">
            <Zap size={11} />Studio
          </button>
        </div>
      </div>

      {/* Search bar */}
      <GlobalSearch posts={allPosts} />

      {/* Sort + Niche filter bar */}
      <div className="shrink-0 overflow-x-auto border-b border-white/8 px-4 py-2 scrollbar-none">
        <div className="flex gap-1.5" style={{ width: "max-content" }}>
          {/* Sort pills — always visible at start */}
          {(["latest", "popular", "trending"] as const).map((s) => (
            <button key={s} onClick={() => handleSortChange(s)}
              className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-bold uppercase tracking-widest transition-colors ${
                feedSort === s
                  ? s === "trending" ? "bg-orange-500/25 text-orange-200 ring-1 ring-orange-500/40"
                    : s === "popular" ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/35"
                    : "bg-brand/28 text-brand-muted ring-1 ring-brand/40"
                  : "bg-white/5 text-white/40 hover:bg-white/12 hover:text-white/65"
              }`}
            >{s === "trending" ? "🔥 Trending" : s === "popular" ? "❤️ Popular" : "Latest"}</button>
          ))}
          {/* Time-window selector — only meaningful for popular/trending, but
              always shown so users can scope latest too. */}
          <div className="mx-1 w-px self-stretch bg-white/10" />
          {TIME_WINDOWS.map((w) => (
            <button key={w} onClick={() => handleWindowChange(w)}
              aria-pressed={timeWindow === w}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                timeWindow === w
                  ? "bg-white/18 text-white ring-1 ring-white/25"
                  : "bg-white/[0.04] text-white/40 hover:bg-white/10 hover:text-white/70"
              }`}
            >{TIME_WINDOW_LABEL[w]}</button>
          ))}
          <div className="mx-1 w-px self-stretch bg-white/10" />
          <Chip label="All" active={!activeTag} onClick={() => {
            setActiveTag(null);
            setSearchQuery("");
            window.history.replaceState(null, "", "/");
          }} />
          {OFFICIAL_CATEGORIES.map((tag) => (
            <Chip key={tag} label={tag} active={activeTag === tag} onClick={() => {
              const next = activeTag === tag ? null : tag;
              setActiveTag(next);
              if (next) {
                const term = next.replace(/^#/, "");
                setSearchQuery(term);
                window.history.replaceState(null, "", `/?search=${encodeURIComponent(term)}`);
              } else {
                setSearchQuery("");
                window.history.replaceState(null, "", "/");
              }
            }} />
          ))}
        </div>
      </div>

      {/* Scrollable grid */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        <div className="px-6 py-5">
          {activeTag && <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/25">{filteredPosts.length} result{filteredPosts.length !== 1 ? "s" : ""} for <span className="text-brand-text/80">{activeTag}</span></p>}
          {!activeTag && !searchQuery && <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/25">Community Edits</p>}
          {!activeTag && searchQuery && (
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/25">
              {filteredPosts.length} result{filteredPosts.length !== 1 ? "s" : ""} for <span className="text-brand-text/80">{searchQuery}</span>
              {/* Dev badge — verifies the ranking engine is receiving the
                  active sortMode. Remove once search sort is fully trusted. */}
              <span className="ml-2 rounded-full bg-brand/20 px-1.5 py-0.5 text-[9px] font-bold text-brand-text ring-1 ring-brand/40">
                Sort: {feedSort.charAt(0).toUpperCase() + feedSort.slice(1)}
              </span>
            </p>
          )}
          {filteredPosts.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredPosts.map((post) => (
                <FeedPostCard
                  key={post.id} post={post}
                  pool={filteredPosts}
                  onOpen={() => { primeTheaterGesture(post.id); setTheaterPostId(post.id); }}
                  onRemix={() => handleRemix(post)}
                  onImport={() => handleImport(post)}
                  onCreator={() => router.push(`/profile/${post.user.handle}`)}
                  onDelete={post.authorUsername && post.authorUsername === currentProfile?.username
                    ? () => removePost(post.id)
                    : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm font-semibold text-white/25">No results for {searchQuery || activeTag}</p>
              <button onClick={() => { setActiveTag(null); }} className="mt-3 text-[11px] text-brand-accent/70 hover:text-brand-text">Clear filter</button>
            </div>
          )}
        </div>
        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-1" />
        <p className="pb-8 text-center text-[10px] text-white/18">Loading more…</p>
      </div>

      {/* Overlays */}
      {theaterPost && (
        <TheaterMode
          post={theaterPost!}
          onClose={() => setTheaterPostId(null)}
          onRemix={(p) => { handleRemix(p); setTheaterPostId(null); }}
          onCreator={(activePost) => navigateToCreator(router, activePost, () => setTheaterPostId(null))}
          onHashtagClick={(tag) => {
            const normalised = tag.startsWith("#") ? tag : `#${tag}`;
            setTheaterPostId(null);
            setActiveTag(normalised);
            scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
          allPosts={allPosts}
          lockedQueue={filteredPosts}
          onNavigate={(p) => setTheaterPostId(p.id)}
        />
      )}
      {toast && <Toast msg={toast} />}

      {/* Back to top */}
      {showBackToTop && (
        <button onClick={scrollToTop} className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#1c1c1c]/90 text-white/60 shadow-xl backdrop-blur-sm transition-colors hover:bg-white/12 hover:text-white">
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
