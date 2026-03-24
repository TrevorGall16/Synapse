"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, GitBranch, Flame, Sparkles, Download } from "lucide-react";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { useProjectStore } from "@/lib/store/project-store";
import { retainMedia } from "@/lib/store/media-pool-db";
import type { MediaPoolItem } from "@/lib/store/types";

// ── Static community posts — shown alongside (or instead of) user posts ────────
const COMMUNITY_POSTS: FeedPost[] = [
  { id: "cx1", user: { handle: "aurora_vj",   initial: "A", hue: 270 }, title: "Strobing Bass Drop Edit",   tags: ["#techno","#hypnotic"],    bg: "#1a0a2e", accent: "#7c3aed", duration: "0:42", likes: 2847, comments: 142, featured: true,  allowRemix: true },
  { id: "cx2", user: { handle: "neon_cut",    initial: "N", hue: 340 }, title: "RGB Glitch Cascade",        tags: ["#glitch","#edm"],         bg: "#1a0818", accent: "#ec4899", duration: "0:30", likes: 1923, comments: 88,  featured: false, allowRemix: true },
  { id: "cx3", user: { handle: "spectral_x",  initial: "S", hue: 200 }, title: "Hypno Tunnel Loop",         tags: ["#psy","#loop"],           bg: "#071a1a", accent: "#06b6d4", duration: "1:04", likes: 3410, comments: 211, featured: false, allowRemix: true },
  { id: "cx4", user: { handle: "hue.shift",   initial: "H", hue: 30  }, title: "Chromatic Aberration Pack", tags: ["#vfx","#bass"],           bg: "#1a1100", accent: "#f59e0b", duration: "0:55", likes: 891,  comments: 47,  featured: false, allowRemix: true },
  { id: "cx5", user: { handle: "deep.freq",   initial: "D", hue: 150 }, title: "Pixel Sort Waveform",       tags: ["#experimental","#lo-fi"], bg: "#051a0a", accent: "#22c55e", duration: "0:37", likes: 2104, comments: 93,  featured: false, allowRemix: true },
  { id: "cx6", user: { handle: "void_signal", initial: "V", hue: 0   }, title: "Infrared Strobe Cut",       tags: ["#industrial","#harsh"],   bg: "#1a0500", accent: "#ef4444", duration: "0:28", likes: 1650, comments: 72,  featured: false, allowRemix: true },
  { id: "cx7", user: { handle: "prismatic",   initial: "P", hue: 300 }, title: "Kaleidoscope Crossfade",    tags: ["#ambient","#visual"],     bg: "#160a1a", accent: "#a855f7", duration: "2:10", likes: 4201, comments: 317, featured: true,  allowRemix: true },
  { id: "cx8", user: { handle: "bpmviz",      initial: "B", hue: 45  }, title: "Beat-Sync Flash Grid",      tags: ["#dnb","#reactive"],       bg: "#180e00", accent: "#fb923c", duration: "0:48", likes: 3027, comments: 184, featured: false, allowRemix: true },
];

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
function TemplateCard({ post, onRemix, onImport }: { post: FeedPost; onRemix: () => void; onImport: () => void }) {
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
          <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onImport}
              className="flex items-center justify-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-semibold text-white/60 transition-all hover:bg-white/8 active:scale-95">
              <Download size={9} />Import
            </button>
            <button onClick={onRemix}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] font-bold text-white transition-all active:scale-95"
              style={{ background: `${post.accent}cc`, boxShadow: `0 0 12px ${post.accent}50` }}>
              <Zap size={9} />Remix This
            </button>
          </div>
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
  const openProjectInTab = useProjectStore((s) => s.openProjectInTab);
  const addMediaItem = useProjectStore((s) => s.addMediaItem);
  const [toast, setToast] = useState<string | null>(null);

  // Merge all published user posts with community posts (no allowRemix filter)
  const templates = useMemo(() => {
    const userIds = new Set(userPosts.map((p) => p.id));
    return [...userPosts, ...COMMUNITY_POSTS.filter((p) => !userIds.has(p.id))];
  }, [userPosts]);

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

    // Preserve all media pool items so IDB hydration (keyed by original ID) works for all clips.
    // Retain each blob so deleting the source post doesn't evict shared assets.
    const flatMedia: MediaPoolItem[] = snap?.mediaPool
      ? [...snap.mediaPool]
      : post.videoUrl
        ? [{ id: crypto.randomUUID(), name: post.title, type: "video" as const, duration, previewUrl: post.videoUrl }]
        : [];
    if (snap?.mediaPool) snap.mediaPool.forEach((m) => retainMedia(m.id).catch(console.warn));

    const trackId = crypto.randomUUID();
    const audioId = crypto.randomUUID();

    const allEffectClips = snap ? snap.tracks.filter((t) => t.type === "effect").flatMap((t) => t.clips) : [];
    const allTextClips   = snap ? snap.tracks.filter((t) => t.type === "text").flatMap((t) => t.clips)   : [];
    const overlapping = <T extends { startTime: number; duration: number }>(pool: T[], target: T) =>
      pool.filter((e) => e.startTime < target.startTime + target.duration && e.startTime + e.duration > target.startTime);

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

    const flatAudioClips = snap
      ? snap.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime)
          .map((c) => ({ ...c, id: crypto.randomUUID(), trackId: audioId }))
      : [];

    const flatTracks = [
      { id: trackId, type: "video" as const, name: "Video 1", color: "#3b82f6", height: 60, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: flatVideoClips },
      { id: audioId, type: "audio" as const, name: "Audio 1", color: "#22c55e", height: 48, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: flatAudioClips },
    ];

    // Privacy scrub: hide original filenames so remixers never see "IMG_123.mp4" etc.
    const scrubbedMedia  = flatMedia.map((m) => ({ ...m, name: "Remixed Media" }));
    const scrubbedTracks = flatTracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => ({ ...c, name: undefined })),
    }));

    openProjectInTab({ tracks: scrubbedTracks, mediaPool: scrubbedMedia, duration: duration + 5_000_000, projectSettings: settings, name: `Remix: ${post.title}`, ...remixMeta });
    router.push("/studio");
  };

  const handleImport = (post: FeedPost) => {
    const snap = post.projectSnapshot;
    const origMedia = snap?.mediaPool?.find((m) => m.type === "video");
    const videoUrl = post.videoUrl ?? origMedia?.previewUrl;
    if (!videoUrl) { setToast("No video to import"); setTimeout(() => setToast(null), 2500); return; }
    addMediaItem({
      id: origMedia?.id ?? crypto.randomUUID(),
      name: origMedia?.name ?? post.title,
      type: "video",
      duration: origMedia?.duration ?? snap?.duration ?? 30_000_000,
      previewUrl: videoUrl,
    });
    setToast("Saved to Media Pool");
    setTimeout(() => setToast(null), 2500);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#141414]">
      {/* Header */}
      <div className="z-10 shrink-0 flex items-center gap-2 border-b border-white/10 bg-[#141414]/95 px-5 py-3 backdrop-blur-sm">
        <GitBranch size={13} className="text-purple-400" />
        <h1 className="text-sm font-bold text-white">Explore</h1>
        <span className="rounded-full bg-purple-500/18 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-purple-300">Community</span>
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
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Community Edits</p>
          <span className="ml-auto text-[9px] text-white/25">{templates.length} posts</span>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {templates.map((post) => (
            <TemplateCard key={post.id} post={post} onRemix={() => handleRemix(post)} onImport={() => handleImport(post)} />
          ))}
        </div>
      </div>

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/14 bg-[#1c1c1c]/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-400" /><span className="text-xs font-semibold text-white/90">{toast}</span>
        </div>
      )}
    </div>
  );
}
