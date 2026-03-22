"use client";

import { useRouter } from "next/navigation";
import { Heart, MessageCircle, Share2, Zap, TrendingUp, Play, Flame, Globe } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { useProjectsRegistry } from "@/lib/store/projects-registry";
import type { Track, ProjectSettings } from "@/lib/store/types";

// ── Demo project snapshot builder ────────────────────────────────────────────
// Each mock post ships a minimal project JSON so "Remix in Studio" actually loads something.
function buildDemoSnapshot(id: string): { tracks: Track[]; duration: number; projectSettings: ProjectSettings } {
  const ps: ProjectSettings = { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1.0, gammaTag: "sRGB" };
  const effectTrack: Track = {
    id: `${id}-fx`,
    type: "effect",
    name: "FX Layer",
    color: "#7c3aed",
    height: 48,
    collapsed: false,
    locked: false,
    isMuted: false,
    isSolo: false,
    opacityOrVolume: 100,
    clips: [
      { id: `${id}-fx-clip`, trackId: `${id}-fx`, sourceId: "fx-generator", startTime: 0, duration: 30_000_000, mediaOffset: 0 },
    ],
  };
  const textTrack: Track = {
    id: `${id}-txt`,
    type: "text",
    name: "Text",
    color: "#f59e0b",
    height: 40,
    collapsed: false,
    locked: false,
    isMuted: false,
    isSolo: false,
    opacityOrVolume: 100,
    clips: [
      { id: `${id}-txt-clip`, trackId: `${id}-txt`, sourceId: "text-generator", startTime: 0, duration: 15_000_000, mediaOffset: 0 },
    ],
  };
  return { tracks: [effectTrack, textTrack], duration: 60_000_000, projectSettings: ps };
}

// ── Mock discovery feed data ──────────────────────────────────────────────────
const MOCK_POSTS = [
  { id: "1", user: { handle: "aurora_vj", initial: "A", hue: 270 }, title: "Strobing Bass Drop Edit", tags: ["#techno", "#hypnotic"], bg: "#1a0a2e", accent: "#7c3aed", duration: "0:42", likes: 2847, comments: 142, featured: true },
  { id: "2", user: { handle: "neon_cut", initial: "N", hue: 340 }, title: "RGB Glitch Cascade", tags: ["#glitch", "#edm"], bg: "#1a0818", accent: "#ec4899", duration: "0:30", likes: 1923, comments: 88, featured: false },
  { id: "3", user: { handle: "spectral_x", initial: "S", hue: 200 }, title: "Hypno Tunnel Loop", tags: ["#psy", "#loop"], bg: "#071a1a", accent: "#06b6d4", duration: "1:04", likes: 3410, comments: 211, featured: false },
  { id: "4", user: { handle: "hue.shift", initial: "H", hue: 30 }, title: "Chromatic Aberration Pack", tags: ["#vfx", "#bass"], bg: "#1a1100", accent: "#f59e0b", duration: "0:55", likes: 891, comments: 47, featured: false },
  { id: "5", user: { handle: "deep.freq", initial: "D", hue: 150 }, title: "Pixel Sort Waveform", tags: ["#experimental", "#lo-fi"], bg: "#051a0a", accent: "#22c55e", duration: "0:37", likes: 2104, comments: 93, featured: false },
  { id: "6", user: { handle: "void_signal", initial: "V", hue: 0 }, title: "Infrared Strobe Cut", tags: ["#industrial", "#harsh"], bg: "#1a0500", accent: "#ef4444", duration: "0:28", likes: 1650, comments: 72, featured: false },
  { id: "7", user: { handle: "prismatic", initial: "P", hue: 300 }, title: "Kaleidoscope Crossfade", tags: ["#ambient", "#visual"], bg: "#160a1a", accent: "#a855f7", duration: "2:10", likes: 4201, comments: 317, featured: true },
  { id: "8", user: { handle: "lo.form", initial: "L", hue: 185 }, title: "Scan Line Retro Mix", tags: ["#retrowave", "#vhs"], bg: "#071018", accent: "#38bdf8", duration: "1:20", likes: 1389, comments: 61, featured: false },
  { id: "9", user: { handle: "bpmviz", initial: "B", hue: 45 }, title: "Beat-Sync Flash Grid", tags: ["#dnb", "#reactive"], bg: "#180e00", accent: "#fb923c", duration: "0:48", likes: 3027, comments: 184, featured: false },
] as const;

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

type Post = typeof MOCK_POSTS[number];

function PostCard({ post, onRemix }: { post: Post; onRemix: () => void }) {
  return (
    <article className="group relative flex flex-col rounded-xl border border-white/10 bg-[#1a1a1a] overflow-hidden hover:border-white/20 transition-all hover:translate-y-[-1px]">
      {/* Thumbnail */}
      <div className="relative overflow-hidden" style={{ aspectRatio: "9/16", background: post.bg }}>
        {/* Animated gradient bars — visual placeholder for video content */}
        <div className="absolute inset-0 flex flex-col gap-[2px] p-1 opacity-30">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ background: post.accent, opacity: 0.3 + (i % 3) * 0.2 }} />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80" />

        {/* Play button on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex h-10 w-10 items-center justify-center rounded-full backdrop-blur-sm border border-white/20 bg-white/10">
            <Play size={16} className="text-white ml-0.5" fill="white" />
          </div>
        </div>

        {/* Duration badge */}
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white/70">
          {post.duration}
        </span>

        {/* Featured badge */}
        {post.featured && (
          <span className="absolute left-2 top-2 flex items-center gap-0.5 rounded bg-yellow-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
            <Flame size={8} />
            Hot
          </span>
        )}
      </div>

      {/* Card body */}
      <div className="flex flex-col gap-2 p-3">
        {/* User row */}
        <div className="flex items-center gap-2">
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ background: `hsl(${post.user.hue} 55% 38%)` }}
          >
            {post.user.initial}
          </div>
          <span className="truncate text-[11px] font-medium text-white/50">@{post.user.handle}</span>
        </div>

        {/* Title */}
        <p className="text-xs font-semibold leading-snug text-white/90">{post.title}</p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {post.tags.map((tag) => (
            <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/35">{tag}</span>
          ))}
        </div>

        {/* Actions row */}
        <div className="mt-0.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-1 text-[10px] text-white/35 transition-colors hover:text-red-400">
              <Heart size={11} />
              <span>{formatCount(post.likes)}</span>
            </button>
            <button className="flex items-center gap-1 text-[10px] text-white/35 transition-colors hover:text-white/60">
              <MessageCircle size={11} />
              <span>{formatCount(post.comments)}</span>
            </button>
            <button className="text-[10px] text-white/35 transition-colors hover:text-white/60">
              <Share2 size={11} />
            </button>
          </div>
          <button
            onClick={onRemix}
            className="flex items-center gap-1 rounded bg-purple-500/15 px-2 py-1 text-[10px] font-semibold text-purple-300 transition-colors hover:bg-purple-500/25 hover:text-purple-200"
          >
            <Zap size={10} />
            Remix
          </button>
        </div>
      </div>
    </article>
  );
}

// ── Published project card (from registry) ────────────────────────────────────
function PublishedCard({ name, id, onRemix }: { name: string; id: string; onRemix: () => void }) {
  return (
    <article className="group relative flex flex-col rounded-xl border border-purple-500/20 bg-[#1a1a1a] overflow-hidden hover:border-purple-500/40 transition-all">
      <div className="relative overflow-hidden bg-gradient-to-br from-purple-900/30 to-[#1a1a1a]" style={{ aspectRatio: "9/16" }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <Globe size={24} className="text-purple-400/30" />
        </div>
        <span className="absolute left-2 top-2 flex items-center gap-0.5 rounded bg-purple-500/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
          <Globe size={8} />
          Published
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="truncate text-xs font-semibold text-white/80">{name}</p>
        <button
          onClick={onRemix}
          className="flex items-center gap-1 self-end rounded bg-purple-500/15 px-2 py-1 text-[10px] font-semibold text-purple-300 transition-colors hover:bg-purple-500/25"
        >
          <Zap size={10} />
          Open
        </button>
      </div>
    </article>
  );
}

export default function DiscoveryFeedPage() {
  const router = useRouter();
  const publishedProjects = useProjectsRegistry((s) => s.projects);
  const loadProject = useProjectStore((s) => s.loadProject);

  const handleRemixMock = (postId: string) => {
    const snapshot = buildDemoSnapshot(postId);
    loadProject(snapshot);
    router.push("/studio");
  };

  const handleRemixPublished = (projectId: string) => {
    try {
      const raw = localStorage.getItem(`synapse-remix-${projectId}`);
      if (raw) {
        const snapshot = JSON.parse(raw) as { tracks: Track[]; duration: number; projectSettings: ProjectSettings };
        loadProject(snapshot);
      }
    } catch {
      // Fallback: just open studio with current state
    }
    router.push("/studio");
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#141414]">
      {/* Feed header */}
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#141414]/90 px-5 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-white/40" />
            <h1 className="text-sm font-bold text-white">Discovery</h1>
            <span className="rounded bg-white/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/40">
              Trending
            </span>
          </div>
          <button
            onClick={() => router.push("/studio")}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            <Zap size={12} />
            Open Studio
          </button>
        </div>
      </div>

      {/* Published projects section (only if any exist) */}
      {publishedProjects.length > 0 && (
        <div className="px-4 pt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-purple-400/60">Your Published</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {publishedProjects.map((p) => (
              <PublishedCard key={p.id} name={p.name} id={p.id} onRemix={() => handleRemixPublished(p.id)} />
            ))}
          </div>
          <div className="my-4 h-px bg-white/8" />
        </div>
      )}

      {/* Responsive grid feed */}
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {MOCK_POSTS.map((post) => (
          <PostCard key={post.id} post={post} onRemix={() => handleRemixMock(post.id)} />
        ))}
      </div>

      <p className="pb-8 text-center text-[10px] text-white/20">
        Community edits · More loading soon
      </p>
    </div>
  );
}
