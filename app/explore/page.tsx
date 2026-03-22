"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Zap, GitBranch, TrendingUp, Flame, Sparkles } from "lucide-react";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { useProjectStore } from "@/lib/store/project-store";
import type { MediaPoolItem } from "@/lib/store/types";

// ── Trending FX (mock — represents last-24h usage counts) ─────────────────────
const TRENDING_FX = [
  { name: "Glitch",          count: 47, color: "#ec4899" },
  { name: "Blur",            count: 38, color: "#06b6d4" },
  { name: "Color Shift",     count: 29, color: "#a855f7" },
  { name: "Strobe",          count: 22, color: "#f59e0b" },
  { name: "Pixel Sort",      count: 18, color: "#22c55e" },
  { name: "Scan Lines",      count: 14, color: "#38bdf8" },
  { name: "Chromatic Aber.", count: 11, color: "#fb923c" },
  { name: "VHS Grain",       count:  9, color: "#ef4444" },
];

// ── Template card ──────────────────────────────────────────────────────────────
function TemplateCard({ post, onRemix }: { post: FeedPost; onRemix: () => void }) {
  return (
    <article className="group relative overflow-hidden rounded-xl border border-white/8 transition-all hover:border-white/20 hover:-translate-y-0.5"
      style={{ background: post.bg }}>
      <div className="relative" style={{ aspectRatio: "9/16" }}>
        {post.videoUrl ? (
          <video src={post.videoUrl} muted loop playsInline preload="metadata"
            className="absolute inset-0 h-full w-full object-cover opacity-70" />
        ) : (
          <div className="absolute inset-0 flex items-end gap-[2px] px-2 pb-20 opacity-15" aria-hidden>
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-t-[2px]"
                style={{ background: post.accent, height: `${20 + Math.sin(i * 0.9) * 35 + (i % 4) * 9}%` }} />
            ))}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/90" />

        {/* Remix badge */}
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 backdrop-blur-sm">
          <GitBranch size={8} className="text-purple-300" />
          <span className="text-[9px] font-semibold text-purple-300">Remixable</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ background: `hsl(${post.user.hue} 55% 30%)` }}>{post.user.initial}</div>
            <span className="text-[9px] text-white/60">@{post.user.handle}</span>
          </div>
          <p className="mb-2 line-clamp-2 text-[11px] font-bold leading-snug text-white">{post.title}</p>
          <div className="mb-2 flex flex-wrap gap-1">
            {post.tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded bg-white/10 px-1 py-px text-[8px] text-white/50">{t}</span>
            ))}
          </div>
          <button onClick={onRemix}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] font-bold text-white transition-all active:scale-95 opacity-0 group-hover:opacity-100"
            style={{ background: `${post.accent}cc`, boxShadow: `0 0 12px ${post.accent}50` }}>
            <Zap size={9} />Remix This
          </button>
        </div>
      </div>
    </article>
  );
}

// ── FX chip ────────────────────────────────────────────────────────────────────
function FxChip({ name, count, color }: { name: string; count: number; color: string }) {
  const maxCount = TRENDING_FX[0].count;
  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-xl border border-white/8 bg-white/4 px-4 py-3 min-w-[96px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-white">{name}</span>
        <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{count}</span>
      </div>
      <div className="h-1 rounded-full bg-white/8">
        <div className="h-full rounded-full transition-all" style={{ width: `${(count / maxCount) * 100}%`, background: color }} />
      </div>
      <span className="text-[9px] text-white/30">uses · last 24h</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ExplorePage() {
  const router    = useRouter();
  const userPosts = useFeedStore((s) => s.userPosts);
  const forkProject  = useProjectStore((s) => s.forkProject);
  const loadProject  = useProjectStore((s) => s.loadProject);
  const addMediaItem = useProjectStore((s) => s.addMediaItem);

  // Only show posts with allowRemix enabled
  const templates = useMemo(
    () => userPosts.filter((p) => p.allowRemix === true),
    [userPosts]
  );

  const handleRemix = (post: FeedPost) => {
    if (post.projectSnapshot) {
      forkProject({ ...post.projectSnapshot, projectId: post.id });
    } else if (post.videoUrl) {
      const mediaId = crypto.randomUUID();
      const media: MediaPoolItem = { id: mediaId, name: post.title, type: "video", duration: 30_000_000, previewUrl: post.videoUrl };
      loadProject({
        tracks: [{ id: "v1", type: "video", name: "Video 1", color: "#3b82f6", height: 60, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: [{ id: crypto.randomUUID(), trackId: "v1", sourceId: mediaId, startTime: 0, duration: media.duration, mediaOffset: 0 }] }],
        duration: media.duration + 5_000_000,
        projectSettings: { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1.0, gammaTag: "sRGB" },
      });
      addMediaItem(media);
    }
    router.push("/studio");
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#141414]">
      {/* Header */}
      <div className="z-10 shrink-0 flex items-center gap-2 border-b border-white/10 bg-[#141414]/95 px-5 py-3 backdrop-blur-sm">
        <GitBranch size={13} className="text-purple-400" />
        <h1 className="text-sm font-bold text-white">Template Library</h1>
        <span className="rounded-full bg-purple-500/18 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-purple-300">Remixable</span>
      </div>

      <div className="px-5 py-5">
        {/* Trending FX section */}
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <Flame size={11} className="text-orange-400" />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Trending FX · Last 24 Hours</p>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
            {TRENDING_FX.map((fx) => (
              <FxChip key={fx.name} name={fx.name} count={fx.count} color={fx.color} />
            ))}
          </div>
        </div>

        {/* Template grid */}
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={11} className="text-white/35" />
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Community Templates</p>
          {templates.length > 0 && (
            <span className="ml-auto text-[9px] text-white/25">{templates.length} available</span>
          )}
        </div>

        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 py-20 text-center">
            <TrendingUp size={32} className="mb-3 text-white/15" />
            <p className="text-sm font-semibold text-white/30">No templates yet</p>
            <p className="mt-1 text-[11px] text-white/20">Publish a project with "Allow Remix" to share it here.</p>
            <button onClick={() => router.push("/studio")}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-purple-500/20 px-3 py-2 text-xs font-bold text-purple-300 transition-colors hover:bg-purple-500/30">
              <Zap size={11} />Open Studio
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {templates.map((post) => (
              <TemplateCard key={post.id} post={post} onRemix={() => handleRemix(post)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
