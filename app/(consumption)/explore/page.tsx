"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Zap, GitBranch, Sparkles, Download, BookMarked } from "lucide-react";
import { PresetShowcase } from "@/components/explore/PresetShowcase";
import { StatsGrid } from "@/components/explore/stats-grid";
import { getTrendingData } from "@/lib/stats";
import { TheaterMode } from "@/components/feed/theater-mode";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { useProjectStore } from "@/lib/store/project-store";
import { canRemix, getRemixMode } from "@/lib/policy";
import { retainMedia } from "@/lib/store/media-pool-db";
import { clipCssFilter, clipCssTransform } from "@/lib/utils/svg-filters";
import { saveCustomPreset } from "@/lib/store/custom-presets-idb";
import type { MediaPoolItem } from "@/lib/store/types";
import { navigateToCreator } from "@/lib/nav/theater-nav";

// ── Community preset library (mirrors preset-panel.tsx) ────────────────────────
type PresetCategory = "blur" | "distortion" | "color" | "glitch";
interface CommunityPreset { id: string; label: string; category: PresetCategory; fxParams: Record<string, unknown> }
const COMMUNITY_PRESETS: CommunityPreset[] = [
  { id: "cp-blur-soft",      label: "Soft Focus",       category: "blur",        fxParams: { effectType: "blur", blurAmount: 4, intensity: 60 } },
  { id: "cp-blur-heavy",     label: "Heavy Blur",       category: "blur",        fxParams: { effectType: "blur", blurAmount: 12, intensity: 80 } },
  { id: "cp-glitch-fast",    label: "Fast Glitch",      category: "glitch",      fxParams: { effectType: "glitch", speed: 80, intensity: 70 } },
  { id: "cp-glitch-slow",    label: "Slow Glitch",      category: "glitch",      fxParams: { effectType: "glitch", speed: 25, intensity: 55 } },
  { id: "cp-strobe-4hz",     label: "Strobe 4hz",       category: "glitch",      fxParams: { effectType: "strobe", speed: 40, intensity: 100 } },
  { id: "cp-strobe-10hz",    label: "Strobe 10hz",      category: "glitch",      fxParams: { effectType: "strobe", speed: 100, intensity: 100 } },
  { id: "cp-tunnel",         label: "Hypno Tunnel",     category: "distortion",  fxParams: { effectType: "hypno-tunnel", intensity: 65 } },
  { id: "cp-ca-light",       label: "Chromatic Lite",   category: "distortion",  fxParams: { effectType: "chromatic-aberration", caOffset: 3, intensity: 50 } },
  { id: "cp-ca-heavy",       label: "Chromatic Heavy",  category: "distortion",  fxParams: { effectType: "chromatic-aberration", caOffset: 8, intensity: 80 } },
  { id: "cp-hue-90",         label: "Hue +90°",         category: "color",       fxParams: { effectType: "hue-rotate", hueRotate: 90, intensity: 100 } },
  { id: "cp-hue-180",        label: "Hue +180°",        category: "color",       fxParams: { effectType: "hue-rotate", hueRotate: 180, intensity: 100 } },
  { id: "cp-invert",         label: "Invert",           category: "color",       fxParams: { effectType: "invert", intensity: 100 } },
  { id: "cp-hyper-saturate", label: "Hyper Saturate",   category: "color",       fxParams: { effectType: "none", saturate: 250, contrast: 120 } },
  { id: "cp-warm",           label: "Warm Tone",        category: "color",       fxParams: { effectType: "none", hueRotate: -15, saturate: 140, brightness: 108 } },
  { id: "cp-cold",           label: "Cold Tone",        category: "color",       fxParams: { effectType: "none", hueRotate: 20, saturate: 80, brightness: 95 } },
  { id: "cp-pixelate",       label: "Pixelate",         category: "distortion",  fxParams: { effectType: "pixelate", blockSize: 8, intensity: 70 } },
];

const PRESET_CATS: { id: "all" | PresetCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "blur", label: "Blurs" },
  { id: "glitch", label: "Glitch" },
  { id: "distortion", label: "Distortion" },
  { id: "color", label: "Color" },
];

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


// ── Template card ──────────────────────────────────────────────────────────────
function TemplateCard({ post, onRemix, onImport, onOpen }: { post: FeedPost; onRemix: () => void; onImport: () => void; onOpen: () => void }) {
  const remixAllowed = canRemix(post);
  return (
    <article className="group relative cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-all duration-300 ease-out hover:border-white/20 hover:-translate-y-0.5 hover:scale-[1.02]"
      style={{ background: post.bg }}
      onClick={onOpen}>
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

        {/* Remix badge — only shown when remixing is permitted */}
        {remixAllowed && (
          <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-[#0a0a0a]/60 px-2 py-0.5 backdrop-blur-sm">
            <GitBranch size={8} className="text-purple-300" />
            <span className="text-[9px] font-semibold text-purple-300">Remixable</span>
          </div>
        )}

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
            <button onClick={(e) => { e.stopPropagation(); onImport(); }}
              className="flex items-center justify-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[10px] font-semibold text-white/60 transition-all hover:bg-white/8 active:scale-95">
              <Download size={9} />Import
            </button>
            {remixAllowed && (
              <button onClick={(e) => { e.stopPropagation(); onRemix(); }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] font-bold text-white transition-all active:scale-95"
                style={{ background: `${post.accent}cc`, boxShadow: `0 0 12px ${post.accent}50` }}>
                <Zap size={9} />Remix This
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// Keyframes injected into explore page for animated swatches
const SWATCH_KF = `
@keyframes ep-pulse-blur { 0%,100%{filter:blur(0) brightness(1)} 50%{filter:blur(6px) brightness(1.2)} }
@keyframes ep-jitter { 0%,100%{transform:none} 25%{transform:translateX(-4px) skewX(-5deg)} 75%{transform:translateX(4px) skewX(5deg)} }
@keyframes ep-warp { 0%,100%{transform:scaleX(1) scaleY(1)} 50%{transform:scaleX(1.07) scaleY(0.94)} }
@keyframes ep-hue { 0%{filter:hue-rotate(0deg) saturate(1.5)} 100%{filter:hue-rotate(360deg) saturate(1.5)} }
@keyframes ep-showcase-in { from{opacity:0;transform:scale(1.04)} to{opacity:1;transform:scale(1)} }
@keyframes ep-theater-in  { from{opacity:0;transform:scale(1.06)} to{opacity:1;transform:scale(1)} }
`;
function explorerSwatchAnim(category: string): string {
  switch (category) {
    case "blur":       return "ep-pulse-blur 2s ease-in-out infinite";
    case "glitch":     return "ep-jitter 0.4s steps(4) infinite";
    case "distortion": return "ep-warp 1.8s ease-in-out infinite";
    case "color":      return "ep-hue 3s linear infinite";
    default:           return "";
  }
}

// ── Preset explore card ────────────────────────────────────────────────────────
interface PresetExploreCardProps {
  preset: CommunityPreset;
  accent?: string;
  authorHandle?: string;
  authorHue?: number;
  authorInitial?: string;
  description?: string;
  /** Feed post — when present, use its videoUrl as thumbnail */
  post?: FeedPost | null;
  onSave: () => void;
  onShowcase: () => void;
}

function PresetExploreCard({
  preset, accent = "#7c3aed", authorHandle, authorHue = 270, authorInitial, description, post, onSave, onShowcase,
}: PresetExploreCardProps) {
  const cssFilter    = clipCssFilter(preset.fxParams);
  const cssTransform = clipCssTransform(preset.fxParams);
  const anim         = explorerSwatchAnim(preset.category);
  const thumbRef     = useRef<HTMLVideoElement>(null);

  const handleThumbMeta = useCallback(() => {
    // no-op: let the thumbnail play from the natural start
  }, []);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-synapse-preset", JSON.stringify(preset.fxParams));
  };

  return (
    <div
      className="group relative flex cursor-pointer flex-col gap-2 rounded-xl border border-white/8 bg-white/3 p-3 transition-all duration-300 ease-out hover:border-white/20 hover:bg-white/6 hover:scale-[1.02]"
      onClick={onShowcase}
    >
      {/* Thumbnail: video frame if available, else animated swatch */}
      <div
        draggable
        onDragStart={handleDragStart}
        className="relative h-16 w-full cursor-grab overflow-hidden rounded-lg active:cursor-grabbing"
        style={{ background: "#111" }}
        onClick={(e) => e.stopPropagation()}
      >
        {post?.videoUrl ? (
          <>
            <video
              ref={thumbRef}
              src={post.videoUrl}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={handleThumbMeta}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* Overlay so text stays readable */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${accent}60, ${accent}20)`,
              filter: cssFilter || undefined,
              transform: cssTransform || undefined,
              animation: anim || undefined,
            }}
          />
        )}
        <div className="pointer-events-none absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="text-[7px] text-white/30">drag</span>
        </div>
      </div>

      {/* Author row */}
      {authorHandle && (
        <div className="flex items-center gap-1.5">
          <div
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
            style={{ background: `hsl(${authorHue} 55% 30%)` }}
          >
            {authorInitial ?? authorHandle[0]?.toUpperCase()}
          </div>
          <span className="text-[9px] text-purple-300/70">@{authorHandle}</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-white/80">{preset.label}</p>
          <p className="text-[9px] capitalize text-white/30">{preset.category}</p>
          {description && (
            <p className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-white/35">{description}</p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onSave(); }}
          title="Save to Library"
          className="shrink-0 rounded-lg bg-white/8 p-1.5 text-white/40 transition-colors hover:bg-purple-500/25 hover:text-purple-300"
        >
          <BookMarked size={10} />
        </button>
      </div>
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
  const [view, setView] = useState<"videos" | "presets">("videos");
  const [presetCat, setPresetCat] = useState<"all" | PresetCategory>("all");
  const [showcase, setShowcase] = useState<{
    preset: CommunityPreset;
    post: FeedPost | null;
    accent?: string;
  } | null>(null);
  const [theaterPost, setTheaterPost] = useState<FeedPost | null>(null);

  // Video posts only — exclude preset-type posts from the video grid
  const videoUserPosts = useMemo(() => userPosts.filter((p) => !p.type || p.type === "video"), [userPosts]);

  // Live stats derived from all posts (user + community mock)
  const stats = useMemo(
    () => getTrendingData([...videoUserPosts, ...userPosts.filter((p) => p.type === "preset"), ...COMMUNITY_POSTS]),
    [videoUserPosts, userPosts],
  );

  // Merge all published user video posts with community posts (no allowRemix filter)
  const templates = useMemo(() => {
    const userIds = new Set(videoUserPosts.map((p) => p.id));
    return [...videoUserPosts, ...COMMUNITY_POSTS.filter((p) => !userIds.has(p.id))];
  }, [videoUserPosts]);

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

    openProjectInTab({ tracks: scrubbedTracks, mediaPool: scrubbedMedia, duration: duration + 5_000_000, projectSettings: settings, name: `Remix of @${post.user.handle}`, ...remixMeta });
    router.push("/studio");
  };

  const handleSavePreset = useCallback(async (preset: CommunityPreset, authorHandle?: string) => {
    await saveCustomPreset({
      id: crypto.randomUUID(),
      label: preset.label,
      category: preset.category,
      effectType: (preset.fxParams.effectType as string) ?? "none",
      fxParams: preset.fxParams,
      savedAt: Date.now(),
      authorHandle,
    }).catch(console.warn);
    setToast("Saved to Library");
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleShowcaseSave = useCallback(async () => {
    if (!showcase) return;
    await handleSavePreset(showcase.preset, showcase.post?.user.handle);
    setShowcase(null);
  }, [showcase, handleSavePreset]);

  const filteredPresets = presetCat === "all"
    ? COMMUNITY_PRESETS
    : COMMUNITY_PRESETS.filter((p) => p.category === presetCat);

  // Feed posts that are presets
  const feedPresets = userPosts.filter((p) => p.type === "preset" && p.presetData);

  // Canonical remix entry point — all entry points (Theater, TemplateCard, handleStudioLoad)
  // must go through here. Routing is determined by policy.getRemixMode().
  const launchRemix = (p: FeedPost) => {
    if (getRemixMode(p) === "snapshot") {
      usePlaybackStore.getState().loadSnapshot(p.projectSnapshot!, {
        remixedFromHandle: p.user.handle,
        parentPostId:      p.id,
        rootParentId:      p.rootParentId,
        rootParentHandle:  p.rootParentHandle,
        demoStartTime:     p.demoStartTime,
        demoDuration:      p.demoDuration,
        post:              p,
      });
      router.push("/studio");
    } else {
      handleRemix(p);
    }
  };

  const handleStudioLoad = (p: FeedPost) => {
    launchRemix(p);
    setTheaterPost(null);
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
    <div className="flex h-full flex-col overflow-y-auto bg-[#121014]">
      {/* Header */}
      <div className="z-10 shrink-0 flex items-center gap-2 border-b border-white/10 bg-[#121014]/95 px-5 py-3 backdrop-blur-sm">
        <GitBranch size={13} className="text-purple-400" />
        <h1 className="text-sm font-bold text-white">Explore</h1>
        <span className="rounded-full bg-purple-500/18 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-purple-300">Community</span>
        {/* View toggle */}
        <div className="ml-auto flex gap-1 rounded-lg bg-white/6 p-0.5">
          <button
            onClick={() => setView("videos")}
            className={`rounded px-3 py-1 text-[10px] font-semibold transition-colors ${view === "videos" ? "bg-white/12 text-white" : "text-white/40 hover:text-white/70"}`}
          >
            Videos
          </button>
          <button
            onClick={() => setView("presets")}
            className={`rounded px-3 py-1 text-[10px] font-semibold transition-colors ${view === "presets" ? "bg-white/12 text-white" : "text-white/40 hover:text-white/70"}`}
          >
            Presets
          </button>
        </div>
      </div>

      {/* Keyframes — always rendered so showcase animation works in both views */}
      <style dangerouslySetInnerHTML={{ __html: SWATCH_KF }} />

      <div className="px-5 py-5">
        {view === "videos" ? (
          <>
            {/* Live stats grid */}
            <div className="mb-6">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-white/40">Community Trends</p>
              <StatsGrid data={stats} />
            </div>

            {/* Template grid */}
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={11} className="text-white/35" />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Community Edits</p>
              <span className="ml-auto text-[9px] text-white/25">{templates.length} posts</span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {templates.map((post) => (
                <TemplateCard key={post.id} post={post} onRemix={() => launchRemix(post)} onImport={() => handleImport(post)} onOpen={() => setTheaterPost(post)} />
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Category filter */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1.5">
                {PRESET_CATS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setPresetCat(c.id)}
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold transition-colors ${
                      presetCat === c.id
                        ? "bg-purple-500/28 text-purple-200 ring-1 ring-purple-500/40"
                        : "text-white/40 hover:text-white/70"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[9px] text-white/25">{filteredPresets.length + feedPresets.length} presets · drag onto clips</span>
            </div>

            {/* Community presets from feed (user-published) */}
            {feedPresets.length > 0 && (
              <div className="mb-6">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles size={11} className="text-purple-400" />
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Published by Community</p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {feedPresets.map((post) => {
                    const pd = post.presetData!;
                    const cp: CommunityPreset = {
                      id: post.id,
                      label: post.title,
                      category: (pd.category ?? "other") as PresetCategory,
                      fxParams: pd.fxParams,
                    };
                    return (
                      <PresetExploreCard
                        key={post.id}
                        preset={cp}
                        accent={post.accent}
                        authorHandle={post.user.handle}
                        authorHue={post.user.hue}
                        authorInitial={post.user.initial}
                        description={post.description}
                        post={post}
                        onSave={() => handleSavePreset(cp, post.user.handle)}
                        onShowcase={() => setShowcase({ preset: cp, post, accent: post.accent })}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Built-in community presets */}
            <div className="mb-3 flex items-center gap-2">
              <Sparkles size={11} className="text-white/35" />
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Standard Presets</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filteredPresets.map((p) => (
                <PresetExploreCard
                  key={p.id}
                  preset={p}
                  onSave={() => handleSavePreset(p)}
                  onShowcase={() => setShowcase({ preset: p, post: null })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Preset Showcase Modal — CSS zoom-out fade on entry */}
      {showcase && (
        <div style={{ animation: "ep-showcase-in 0.22s cubic-bezier(0.22,1,0.36,1) both" }}>
        <PresetShowcase
          post={showcase.post}
          preset={showcase.preset}
          accent={showcase.accent}
          onClose={() => setShowcase(null)}
          onSave={handleShowcaseSave}
        />
        </div>
      )}

      {/* ── Theater Mode — zoom-out CSS fade on open ──────────────────────── */}
      {theaterPost && (
        <div
          key={theaterPost.id}
          className="fixed inset-0 z-[100]"
          style={{ animation: "ep-theater-in 0.28s cubic-bezier(0.22,1,0.36,1) both" }}
        >
          <TheaterMode
            post={theaterPost}
            onClose={() => setTheaterPost(null)}
            onRemix={(p) => handleStudioLoad(p)}
            onCreator={(activePost) => navigateToCreator(router, activePost, () => setTheaterPost(null))}
            allPosts={templates}
            lockedQueue={templates}
            onNavigate={(p) => setTheaterPost(p)}
          />
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/14 bg-[#1c1c1c]/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-400" /><span className="text-xs font-semibold text-white/90">{toast}</span>
        </div>
      )}
    </div>
  );
}
