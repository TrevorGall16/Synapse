"use client";

import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Heart, MessageCircle, Share2, Zap, TrendingUp, Play, Pause, Flame, Upload, Globe, User, ArrowUp } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { useProjectsRegistry } from "@/lib/store/projects-registry";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { TheaterMode } from "@/components/feed/theater-mode";
import { UploadModal } from "@/components/feed/upload-modal";
import type { Track, ProjectSettings, MediaPoolItem } from "@/lib/store/types";

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

const STATIC_TAGS = Array.from(new Set(MOCK_POSTS.flatMap((p) => p.tags)));
function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

// ── Deterministic infinite-scroll generator ───────────────────────────────────
function generateMorePosts(pageNum: number): FeedPost[] {
  return Array.from({ length: 10 }, (_, i) => {
    const src     = MOCK_POSTS[(pageNum * 10 + i) % MOCK_POSTS.length];
    const variant = pageNum * 10 + i + 10;
    return {
      ...src,
      id:       `gen-${pageNum}-${i}`,
      title:    `${src.title} • Vol. ${pageNum + 1}`,
      likes:    src.likes    + variant * 37,
      comments: src.comments + variant * 7,
      featured: false,
    };
  });
}

// ── Niche chip ────────────────────────────────────────────────────────────────
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-semibold transition-colors ${
        active ? "bg-purple-500/28 text-purple-200 ring-1 ring-purple-500/40" : "bg-white/6 text-white/40 hover:bg-white/12 hover:text-white/65"
      }`}
    >{label}</button>
  );
}

// ── Tall grid card ────────────────────────────────────────────────────────────
function PostCard({ post, onOpen, onRemix, onCreator }: { post: FeedPost; onOpen: () => void; onRemix: () => void; onCreator: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [liked, setLiked] = useState(false);

  // Seek to first frame as soon as metadata loads — gives static poster with no hover
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !post.videoUrl) return;
    const onMeta = () => { v.currentTime = 0.001; };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [post.videoUrl]);

  const handleMouseEnter = () => {
    setHovered(true);
    if (videoRef.current && post.videoUrl) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  };
  const handleMouseLeave = () => {
    setHovered(false);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0.001; }
  };

  return (
    <article
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-all duration-200 hover:border-white/20 hover:shadow-2xl hover:-translate-y-0.5"
      onClick={onOpen}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="relative" style={{ aspectRatio: "9/16", background: post.bg }}>
        {/* Waveform bars — hidden when video is present */}
        <div className={`absolute inset-0 flex items-end gap-[2px] px-2 pb-28 transition-opacity duration-500 ${post.videoUrl ? "opacity-0" : "opacity-20"}`} aria-hidden>
          {Array.from({ length: 32 }).map((_, i) => (
            <div key={i} className="flex-1 animate-pulse rounded-t-[2px]"
              style={{ background: post.accent, height: `${18 + Math.sin(i * 0.75) * 38 + (i % 5) * 8}%`, animationDelay: `${(i * 60) % 1000}ms` }}
            />
          ))}
        </div>

        {/* Video — shows first frame always; plays on hover */}
        <video
          ref={videoRef}
          src={post.videoUrl}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${post.videoUrl ? "opacity-100" : "opacity-0"}`}
          muted loop playsInline preload="metadata"
        />

        {/* Glow + base gradient */}
        <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse 70% 45% at 50% 25%, ${post.accent}25, transparent 65%)` }} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />

        {/* Top badges */}
        {post.featured && (
          <span className="absolute left-2.5 top-2.5 flex items-center gap-0.5 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[8px] font-bold uppercase text-black">
            <Flame size={7} />Hot
          </span>
        )}
        <span className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">{post.duration}</span>

        {/* Play icon (fades out on hover) */}
        <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${hovered ? "opacity-0" : ""}`}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/30 backdrop-blur-sm">
            <Play size={14} className="ml-0.5 text-white" fill="white" />
          </div>
        </div>

        {/* Default bottom info (fades on hover) */}
        <div className={`absolute bottom-0 left-0 right-0 p-3 transition-all duration-200 ${hovered ? "opacity-0 translate-y-1" : ""}`}>
          <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="mb-1 flex items-center gap-1.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: `hsl(${post.user.hue} 55% 30%)` }}>{post.user.initial}</div>
            <span className="text-[10px] font-medium text-white/70">@{post.user.handle}</span>
          </button>
          <p className="line-clamp-2 text-[11px] font-bold leading-snug text-white">{post.title}</p>
        </div>

        {/* Hover overlay — actions slide up */}
        <div className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/30 to-transparent p-3 transition-all duration-200 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}>
          <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="mb-1.5 flex items-center gap-1.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ring-1 ring-white/20" style={{ background: `hsl(${post.user.hue} 55% 30%)` }}>{post.user.initial}</div>
            <span className="text-[10px] font-semibold text-white/80">@{post.user.handle}</span>
          </button>
          <p className="mb-1.5 text-xs font-bold leading-snug text-white">{post.title}</p>
          <div className="mb-3 flex flex-wrap gap-1">
            {post.tags.map((t) => <span key={t} className="rounded bg-white/10 px-1 py-px text-[8px] text-white/50">{t}</span>)}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); setLiked((v) => !v); }} className="flex items-center gap-0.5 text-[10px] text-white/60 transition-colors hover:text-red-400">
                <Heart size={11} className={liked ? "fill-red-400 text-red-400" : ""} /><span>{fmtK(post.likes + (liked ? 1 : 0))}</span>
              </button>
              <button onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 text-[10px] text-white/60 hover:text-white/90">
                <MessageCircle size={11} /><span>{fmtK(post.comments)}</span>
              </button>
              <button onClick={(e) => e.stopPropagation()} className="text-white/60 hover:text-white/90"><Share2 size={11} /></button>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onRemix(); }}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white transition-all active:scale-95"
              style={{ background: `${post.accent}dd`, boxShadow: `0 0 10px ${post.accent}50` }}
            ><Zap size={9} />Remix</button>
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Published card ────────────────────────────────────────────────────────────
function PublishedCard({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <article className="group relative cursor-pointer overflow-hidden rounded-xl border border-purple-500/18 bg-[#1a1a1a] transition-all hover:border-purple-500/38 hover:-translate-y-0.5">
      <div className="relative flex flex-col" style={{ aspectRatio: "9/16" }}>
        <div className="flex flex-1 items-center justify-center bg-gradient-to-b from-purple-900/22 to-[#141414]"><Globe size={20} className="text-purple-400/28" /></div>
        <div className="absolute left-2 top-2"><span className="flex items-center gap-0.5 rounded-full bg-purple-500/75 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white"><Globe size={7} />Live</span></div>
        <div className="absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <p className="mb-2 truncate text-[11px] font-semibold text-white">{name}</p>
          <button onClick={onOpen} className="flex w-full items-center justify-center gap-1 rounded-lg bg-purple-500/28 py-1.5 text-[10px] font-bold text-purple-200 hover:bg-purple-500/42"><Zap size={9} />Open in Studio</button>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3 transition-opacity group-hover:opacity-0"><p className="truncate text-[10px] font-semibold text-white/55">{name}</p></div>
      </div>
    </article>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/14 bg-[#1c1c1c]/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-400" /><span className="text-xs font-semibold text-white/90">{msg}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DiscoveryFeedPage() {
  const router = useRouter();
  const [theaterPost, setTheaterPost] = useState<FeedPost | null>(null);
  const [showUpload, setShowUpload]   = useState(false);
  const [activeTag, setActiveTag]     = useState<string | null>(null);
  const [toast, setToast]             = useState<string | null>(null);

  const [loadedPages, setLoadedPages]   = useState(1);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef        = useRef<HTMLDivElement>(null);

  const publishedProjects = useProjectsRegistry((s) => s.projects);
  const userPosts  = useFeedStore((s) => s.userPosts);
  const forkProject  = useProjectStore((s) => s.forkProject);
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
  const allPosts = useMemo(() => [...userPosts, ...allMockPosts], [userPosts, allMockPosts]);
  const allTags  = useMemo(() => {
    const seen = new Set(STATIC_TAGS);
    userPosts.flatMap((p) => p.tags).forEach((t) => seen.add(t));
    return Array.from(seen);
  }, [userPosts]);
  const displayPosts = activeTag ? allPosts.filter((p) => p.tags.includes(activeTag)) : allPosts;

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
    forkProject(buildDemoSnapshot(post.id, post.title));
    showToast("Forking project…");
  };

  const handleOpenPublished = (projectId: string) => {
    try {
      const raw = localStorage.getItem(`synapse-remix-${projectId}`);
      if (raw) loadProject(JSON.parse(raw) as { tracks: Track[]; duration: number; projectSettings: ProjectSettings });
    } catch { /* fallback */ }
    router.push("/studio");
  };

  const handleStudioFile = (file: File) => {
    setShowUpload(false);
    const url = URL.createObjectURL(file);
    const mediaId = crypto.randomUUID();
    const media: MediaPoolItem = { id: mediaId, name: file.name, type: "video", duration: 30_000_000, previewUrl: url };
    const vTrack = tracks.find((t) => t.type === "video");
    if (vTrack) { addMediaItem(media); addClip(vTrack.id, { id: crypto.randomUUID(), trackId: vTrack.id, sourceId: mediaId, startTime: 0, duration: media.duration, mediaOffset: 0 }); }
    else {
      loadProject({ tracks: [{ id: "v1", type: "video", name: "Video 1", color: "#3b82f6", height: 60, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: [{ id: crypto.randomUUID(), trackId: "v1", sourceId: mediaId, startTime: 0, duration: media.duration, mediaOffset: 0 }] }], duration: media.duration + 5_000_000, projectSettings: { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1.0, gammaTag: "sRGB" } });
      addMediaItem(media);
    }
    router.push("/studio");
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
          <button onClick={() => setShowUpload(true)} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/14 hover:text-white">
            <Upload size={11} />Upload
          </button>
          <button onClick={() => router.push("/profile/you")} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/14 hover:text-white">
            <User size={11} />Profile
          </button>
          <button onClick={() => router.push("/studio")} className="flex items-center gap-1.5 rounded-lg bg-purple-500/20 px-2.5 py-1.5 text-[11px] font-bold text-purple-300 transition-colors hover:bg-purple-500/30">
            <Zap size={11} />Studio
          </button>
        </div>
      </div>

      {/* Niche filter bar */}
      <div className="shrink-0 overflow-x-auto border-b border-white/8 px-4 py-2 scrollbar-none">
        <div className="flex gap-1.5" style={{ width: "max-content" }}>
          <Chip label="All" active={!activeTag} onClick={() => setActiveTag(null)} />
          {allTags.map((tag) => (
            <Chip key={tag} label={tag} active={activeTag === tag} onClick={() => setActiveTag(activeTag === tag ? null : tag)} />
          ))}
        </div>
      </div>

      {/* Scrollable grid */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        {publishedProjects.length > 0 && (
          <div className="border-b border-white/8 px-6 py-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-purple-400/60">Your Published</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {publishedProjects.map((p) => (
                <PublishedCard key={p.id} name={p.name} onOpen={() => handleOpenPublished(p.id)} />
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-5">
          {activeTag && (
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/25">
              {displayPosts.length} result{displayPosts.length !== 1 ? "s" : ""} for <span className="text-purple-300/80">{activeTag}</span>
            </p>
          )}
          {!activeTag && <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/25">Community Edits</p>}
          {displayPosts.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {displayPosts.map((post) => (
                <PostCard
                  key={post.id} post={post}
                  onOpen={() => setTheaterPost(post)}
                  onRemix={() => handleRemix(post)}
                  onCreator={() => router.push(`/profile/${post.user.handle}`)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-sm font-semibold text-white/25">No results for {activeTag}</p>
              <button onClick={() => setActiveTag(null)} className="mt-3 text-[11px] text-purple-400/70 hover:text-purple-300">Clear filter</button>
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
          post={theaterPost}
          onClose={() => setTheaterPost(null)}
          onRemix={() => { handleRemix(theaterPost); setTheaterPost(null); }}
          onCreator={() => { router.push(`/profile/${theaterPost.user.handle}`); setTheaterPost(null); }}
          allPosts={allPosts}
          onNavigate={(p) => setTheaterPost(p)}
        />
      )}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onStudioFile={handleStudioFile} />}
      {toast && <Toast msg={toast} />}

      {/* Back to top */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#1c1c1c]/90 text-white/60 shadow-xl backdrop-blur-sm transition-colors hover:bg-white/12 hover:text-white"
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
