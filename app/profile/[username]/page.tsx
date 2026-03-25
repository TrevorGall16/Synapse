"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Zap, Globe, Heart, Edit3, Users, Trash2, X, Check, WifiOff, Share2 } from "lucide-react";
import { useUserStore, DEFAULT_PROFILE } from "@/lib/store/user-store";
import { useFeedStore, type FeedPost, isBlobUrl } from "@/lib/store/feed-store";
import { useProjectStore } from "@/lib/store/project-store";
import { useProjectsRegistry } from "@/lib/store/projects-registry";
import { TheaterMode } from "@/components/feed/theater-mode";
import { cleanupSnapshotMedia } from "@/lib/store/media-pool-db";
import { getTrendingData } from "@/lib/stats";

// ── Mock creator profiles ─────────────────────────────────────────────────────
const CREATOR_MAP: Record<string, { displayName: string; bio: string; hue: number; followers: number; following: number; postCount: number; totalLikes: number; remixes: number }> = {
  aurora_vj:   { displayName: "Aurora VJ",   bio: "Strobing visuals & hypnotic loops.",              hue: 270, followers: 8420,  following: 312, postCount: 47, totalLikes: 2600,  remixes: 12 },
  neon_cut:    { displayName: "Neon Cut",     bio: "RGB splits and glitch art. EDM edit machine.",    hue: 340, followers: 5130,  following: 198, postCount: 31, totalLikes: 1400,  remixes: 8  },
  spectral_x:  { displayName: "Spectral X",  bio: "Psy visuals, tunnel loops, trippy transitions.",  hue: 200, followers: 11200, following: 427, postCount: 63, totalLikes: 4800,  remixes: 21 },
  "hue.shift": { displayName: "Hue Shift",   bio: "Chromatic aberration and VFX packs.",             hue: 30,  followers: 2980,  following: 155, postCount: 18, totalLikes: 690,   remixes: 4  },
  "deep.freq": { displayName: "Deep Freq",   bio: "Pixel sorting, lo-fi, experimental cuts.",        hue: 150, followers: 6740,  following: 281, postCount: 39, totalLikes: 2100,  remixes: 11 },
  void_signal: { displayName: "Void Signal", bio: "Industrial noise, infrared palette.",             hue: 0,   followers: 4890,  following: 167, postCount: 28, totalLikes: 1350,  remixes: 6  },
  prismatic:   { displayName: "Prismatic",   bio: "Kaleidoscope edits, ambient crossfades.",         hue: 300, followers: 14300, following: 503, postCount: 82, totalLikes: 7800,  remixes: 31 },
  "lo.form":   { displayName: "Lo Form",     bio: "Retrowave, VHS grain, scan-line aesthetics.",     hue: 185, followers: 3720,  following: 224, postCount: 22, totalLikes: 930,   remixes: 5  },
  bpmviz:      { displayName: "BPM Viz",     bio: "Beat-synced flash grids. DnB reactive visuals.",  hue: 45,  followers: 9160,  following: 390, postCount: 54, totalLikes: 3650,  remixes: 17 },
};
const MOCK_ACCENT: Record<string, string> = {
  aurora_vj: "#7c3aed", neon_cut: "#ec4899", spectral_x: "#06b6d4", "hue.shift": "#f59e0b",
  "deep.freq": "#22c55e", void_signal: "#ef4444", prismatic: "#a855f7", "lo.form": "#38bdf8", bpmviz: "#fb923c",
};
const MOCK_BG: Record<string, string> = {
  aurora_vj: "#1a0a2e", neon_cut: "#1a0818", spectral_x: "#071a1a", "hue.shift": "#1a1100",
  "deep.freq": "#051a0a", void_signal: "#1a0500", prismatic: "#160a1a", "lo.form": "#071018", bpmviz: "#180e00",
};

// ── Unified post card ─────────────────────────────────────────────────────────
function PostCard({ title, accentColor, bgColor, index, videoUrl, post, onOpen, onDelete }: {
  title: string; accentColor: string; bgColor: string; index: number; videoUrl?: string;
  post?: FeedPost | null; onOpen: () => void; onDelete?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Find first clip's source URL and frame offset from snapshot
  const firstClipSrc = useMemo(() => {
    const snap = post?.projectSnapshot;
    if (!snap) return videoUrl;
    const pool = snap.mediaPool ?? [];
    const firstClip = snap.tracks
      .filter((t) => t.type === "video").flatMap((t) => t.clips)
      .sort((a, b) => a.startTime - b.startTime)[0];
    return firstClip ? (pool.find((m) => m.id === firstClip.sourceId)?.previewUrl ?? videoUrl) : videoUrl;
  }, [post?.projectSnapshot, videoUrl]);

  const firstClipOffset = useMemo(() => {
    const snap = post?.projectSnapshot;
    if (!snap) return 0.001;
    const firstClip = snap.tracks
      .filter((t) => t.type === "video").flatMap((t) => t.clips)
      .sort((a, b) => a.startTime - b.startTime)[0];
    return firstClip ? Math.max(0.001, (firstClip.mediaOffset ?? 0) / 1_000_000) : 0.001;
  }, [post?.projectSnapshot]);

  const handleEnter = useCallback(() => {
    setHovered(true);
    if (videoRef.current && firstClipSrc) { videoRef.current.currentTime = firstClipOffset; videoRef.current.play().catch(() => {}); }
  }, [firstClipSrc, firstClipOffset]);

  const handleLeave = useCallback(() => {
    setHovered(false);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = firstClipOffset; }
  }, [firstClipOffset]);

  return (
    <article className="group relative cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-all duration-300 ease-out hover:scale-[1.02] hover:border-white/20"
      onClick={onOpen} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <div className="relative" style={{ aspectRatio: "9/16", background: bgColor }}>
        {/* Delete confirmation overlay */}
        {confirmDelete && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-bold text-white">Delete this post?</p>
            <div className="flex gap-2">
              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-[10px] font-semibold text-white/60 hover:bg-white/8">Cancel</button>
              <button onClick={(e) => { e.stopPropagation(); if (post?.projectSnapshot?.mediaPool) cleanupSnapshotMedia(post.projectSnapshot.mediaPool).catch(console.warn); onDelete?.(); }}
                className="rounded-lg bg-red-500/25 px-3 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/35">Delete</button>
            </div>
          </div>
        )}
        {!firstClipSrc && (
          <div className="absolute inset-0 flex items-end gap-[2px] px-2 pb-20 opacity-15" aria-hidden>
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-t-[2px]"
                style={{ background: accentColor, height: `${20 + Math.sin((i + index) * 0.9) * 35 + (i % 4) * 9}%` }} />
            ))}
          </div>
        )}
        {firstClipSrc && (
          <video ref={videoRef} src={firstClipSrc} muted loop playsInline preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
            onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = firstClipOffset; }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80" />

        {/* Delete button — visible on hover when onDelete is provided */}
        {onDelete && (
          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/40 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/30 hover:text-red-400">
            <Trash2 size={10} />
          </button>
        )}

        <div className={`absolute inset-x-0 bottom-0 p-3 transition-all duration-200 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}>
          <p className="mb-2 truncate text-[11px] font-bold text-white">{title}</p>
          <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold text-white transition-all"
            style={{ background: `${accentColor}cc` }}><Zap size={9} />Open</button>
        </div>
        <div className={`absolute inset-x-0 bottom-0 p-3 transition-opacity ${hovered ? "opacity-0" : ""}`}>
          <p className="truncate text-[10px] font-medium text-white/55">{title}</p>
        </div>
      </div>
    </article>
  );
}

// ── Edit Profile Modal ────────────────────────────────────────────────────────
function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, setProfile } = useUserStore();
  const dp = profile ?? DEFAULT_PROFILE;
  const [name, setName] = useState(dp.displayName);
  const [editBio, setEditBio] = useState(dp.bio);
  const [editHue, setEditHue] = useState(dp.hue);
  const save = () => { setProfile({ displayName: name.trim() || dp.displayName, bio: editBio.trim(), hue: editHue }); onClose(); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xs rounded-2xl border border-white/14 bg-[#1c1c1c] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-bold text-white">Edit Profile</span>
          <button onClick={onClose} className="rounded-lg bg-white/8 p-1.5 text-white/40 hover:bg-white/15 hover:text-white"><X size={12} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Display Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
              className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white outline-none focus:border-purple-500/40" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Bio</span>
            <textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={2} maxLength={160}
              className="resize-none rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white outline-none focus:border-purple-500/40" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Accent Hue</span>
            <input type="range" min={0} max={359} value={editHue} onChange={(e) => setEditHue(+e.target.value)} className="w-full" />
            <div className="h-3 w-full rounded-full" style={{ background: "linear-gradient(to right,hsl(0,55%,45%),hsl(60,55%,45%),hsl(120,55%,45%),hsl(180,55%,45%),hsl(240,55%,45%),hsl(300,55%,45%),hsl(359,55%,45%))" }} />
          </label>
          <div className="mt-1 flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-lg border border-white/10 py-2 text-xs text-white/50 hover:bg-white/8">Cancel</button>
            <button onClick={save} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-500/22 py-2 text-xs font-bold text-purple-300 hover:bg-purple-500/32">
              <Check size={11} />Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type Tab = "published" | "drafts" | "liked";

// ── Profile page ──────────────────────────────────────────────────────────────
export default function ProfilePage() {
  // ── ALL HOOKS MUST BE DECLARED FIRST — no early returns above this line ──────
  const params   = useParams();
  const router   = useRouter();
  const username = Array.isArray(params.username) ? params.username[0] : (params.username ?? "you");

  const { profile: storeProfile, hasHydrated } = useUserStore();
  const openProjectInTab = useProjectStore((s) => s.openProjectInTab);
  const loadProject      = useProjectStore((s) => s.loadProject);
  const allUserPosts     = useFeedStore((s) => s.userPosts);
  const removePost       = useFeedStore((s) => s.removePost);
  const registryProjects = useProjectsRegistry((s) => s.projects);

  const [tab, setTab]                  = useState<Tab>("published");
  const [showEditProfile, setShowEdit] = useState(false);
  const [forceRender, setForceRender]  = useState(false);
  const [theaterPost, setTheaterPost]  = useState<FeedPost | null>(null);

  // Timeout fallback: if hydration takes >300ms, unblock render anyway
  useEffect(() => {
    const t = setTimeout(() => setForceRender(true), 300);
    return () => clearTimeout(t);
  }, []);

  // ── Derived values computed before any conditional return ─────────────────
  const currentUser  = storeProfile ?? DEFAULT_PROFILE;
  const isOwnProfile = username === currentUser.username || username === "you";
  const creator      = isOwnProfile ? null : CREATOR_MAP[username];
  const profile      = isOwnProfile
    ? { displayName: currentUser.displayName, bio: currentUser.bio, hue: currentUser.hue, followers: currentUser.followers, following: currentUser.following }
    : (creator ?? { displayName: username, bio: "Synapse creator", hue: 200, followers: 0, following: 0 });

  const accent   = isOwnProfile ? `hsl(${profile.hue} 55% 45%)` : (MOCK_ACCENT[username] ?? "#7c3aed");
  const bannerBg = isOwnProfile ? `hsl(${profile.hue} 30% 8%)`  : (MOCK_BG[username]     ?? "#1a1a1a");

  const offlinePosts = allUserPosts.filter((p) => isBlobUrl(p.videoUrl));

  // ── useMemo MUST come before any conditional return (Rules of Hooks) ────────
  const unifiedPosts = useMemo(() => {
    const feedItems = allUserPosts
      .filter((p) => p.authorUsername === currentUser.username || (isOwnProfile && !p.authorUsername))
      .map((p) => ({ type: "feed" as const, id: p.id, title: p.title, accent: p.accent, bg: p.bg, date: p.createdAt ?? 0, post: p }));
    const regItems = isOwnProfile ? registryProjects.map((p) => ({
      type: "registry" as const, id: p.id, title: p.name, accent, bg: bannerBg, date: p.lastEdited, post: null as FeedPost | null,
    })) : [];
    return [...feedItems, ...regItems].sort((a, b) => b.date - a.date);
  }, [allUserPosts, registryProjects, currentUser.username, isOwnProfile, accent, bannerBg]);

  const mockCount = isOwnProfile ? 0 : (creator?.postCount ?? 0);
  const pubCount  = isOwnProfile ? unifiedPosts.length : mockCount;

  // ── Stats from lib/stats.ts (own profile) or CREATOR_MAP (mock) ──────────
  const profileStats = useMemo(() => getTrendingData(
    isOwnProfile ? allUserPosts : []
  ), [allUserPosts, isOwnProfile]);

  const totalLikes = useMemo(() => {
    if (!isOwnProfile) return CREATOR_MAP[username]?.totalLikes ?? 0;
    return (profileStats.creators[0]?.totalLikes) ?? allUserPosts.reduce((s, p) => s + p.likes, 0);
  }, [profileStats, allUserPosts, isOwnProfile, username]);

  const recipeUses = useMemo(() => {
    if (!isOwnProfile) return CREATOR_MAP[username]?.remixes ?? 0;
    const myHandle = currentUser.username;
    return allUserPosts.filter((p) => p.remixedFromHandle === myHandle || p.remixedFromHandle === "you").length;
  }, [allUserPosts, isOwnProfile, username, currentUser.username]);

  // ── Loading gate — AFTER all hook declarations ────────────────────────────
  if (isOwnProfile && (!storeProfile || !hasHydrated) && !forceRender) return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[11px] text-white/25">Loading profile…</span>
      </div>
    </div>
  );

  // ── Regular functions (not hooks) ─────────────────────────────────────────
  const cleanupOffline = () => {
    const { removePost: rp } = useFeedStore.getState();
    offlinePosts.forEach((p) => rp(p.id));
  };

  const handleOpenPost = (item: typeof unifiedPosts[0]) => {
    if (item.type === "feed" && item.post) {
      setTheaterPost(item.post); // open Theater Mode — "Edit in Studio" button inside handles Studio redirect
    } else if (item.type === "registry") {
      try { const r = localStorage.getItem(`synapse-remix-${item.id}`); if (r) loadProject(JSON.parse(r)); } catch { /* ignore */ }
      router.push("/studio");
    }
  };

  const handleStudioLoad = (p: FeedPost) => {
    if (p.projectSnapshot) openProjectInTab({ ...p.projectSnapshot, name: p.title });
    setTheaterPost(null);
    router.push("/studio");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      {showEditProfile && <EditProfileModal onClose={() => setShowEdit(false)} />}
      {theaterPost && (
        <TheaterMode
          post={theaterPost}
          onClose={() => setTheaterPost(null)}
          onRemix={() => handleStudioLoad(theaterPost)}
          onCreator={() => { setTheaterPost(null); router.push(`/profile/${theaterPost.user.handle}`); }}
          allPosts={allUserPosts}
          onNavigate={(p) => setTheaterPost(p)}
        />
      )}

      {/* Back nav */}
      <div className="z-10 shrink-0 flex items-center gap-2 border-b border-white/8 bg-[#141414]/95 px-4 py-2.5 backdrop-blur-sm">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/14 hover:text-white">
          <ArrowLeft size={11} />Back
        </button>
        <span className="text-[11px] text-white/35">@{username}</span>
        {isOwnProfile && offlinePosts.length > 0 && (
          <button onClick={cleanupOffline}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-orange-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-orange-300/80 transition-colors hover:bg-orange-500/25 hover:text-orange-200">
            <WifiOff size={10} />Clean Up Offline ({offlinePosts.length})
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── High-sensation banner ──────────────────────────────────────────── */}
        <div className="relative h-44 shrink-0 overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${bannerBg} 0%, ${accent}28 55%, ${bannerBg} 100%)` }}>
          {/* diagonal grid */}
          <div className="absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: `repeating-linear-gradient(45deg, ${accent} 0px, ${accent} 1px, transparent 1px, transparent 20px)` }} />
          {/* chromatic aberration blobs */}
          <div className="pointer-events-none absolute inset-0" style={{ mixBlendMode: "screen" }}>
            <div className="absolute h-64 w-64 rounded-full"
              style={{ top: "-15%", right: "10%", background: `radial-gradient(circle, ${accent}55 0%, transparent 70%)`, filter: "blur(52px)", transform: "translate(5px,-3px)" }} />
            <div className="absolute h-72 w-72 rounded-full"
              style={{ bottom: "-25%", left: "8%",  background: `radial-gradient(circle, ${accent}30 0%, transparent 70%)`, filter: "blur(64px)", transform: "translate(-4px,4px)" }} />
          </div>
          {/* SVG fractalNoise grain */}
          <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
            <filter id="pg-grain">
              <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" stitchTiles="stitch" />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#pg-grain)" />
          </svg>
        </div>

        {/* ── Avatar + info ──────────────────────────────────────────────────── */}
        <div className="relative px-6 pb-5" style={{ animation: "profile-card-in 0.34s cubic-bezier(0.22,1,0.36,1) both" }}>
          <div className="relative -mt-9 mb-3 flex items-end justify-between">
            {/* Avatar — larger ring, slight shadow glow */}
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full text-2xl font-bold text-white ring-4 ring-[#141414]"
              style={{ background: `hsl(${profile.hue} 55% 32%)`, boxShadow: `0 0 24px ${accent}44` }}>
              {profile.displayName[0].toUpperCase()}
            </div>
            {/* ── Action buttons ─────────────────────────────────────────── */}
            {isOwnProfile ? (
              <div className="flex gap-2">
                <button onClick={() => setShowEdit(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition-all duration-200 hover:scale-[1.02] hover:bg-white/14">
                  <Edit3 size={11} />Edit Profile
                </button>
                <button onClick={() => setTab("drafts")}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-transparent px-3 py-1.5 text-[11px] font-semibold text-white/40 transition-all duration-200 hover:scale-[1.02] hover:bg-white/8 hover:text-white/60">
                  <Edit3 size={11} />Drafts
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white transition-all duration-200 hover:scale-[1.02]"
                  style={{ background: `${accent}cc` }}>
                  <Users size={11} />Follow
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/60 transition-all duration-200 hover:scale-[1.02] hover:bg-white/14"
                  onClick={() => { if (navigator.share) navigator.share({ title: profile.displayName, url: window.location.href }).catch(() => {}); else navigator.clipboard.writeText(window.location.href).catch(() => {}); }}>
                  <Share2 size={11} />Share
                </button>
              </div>
            )}
          </div>

          <h1 className="text-base font-bold text-white">{profile.displayName}</h1>
          <p className="text-[11px] text-white/45">@{username}</p>
          <p className="mt-1.5 text-xs text-white/65">{profile.bio}</p>

          {/* ── Stats row ────────────────────────────────────────────────── */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">{profile.followers >= 1000 ? `${(profile.followers / 1000).toFixed(1)}k` : profile.followers}</span>
              <span className="text-[11px] text-white/40">Followers</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">{profile.following}</span>
              <span className="text-[11px] text-white/40">Following</span>
            </div>
            <div className="mx-0.5 h-3 w-px self-center bg-white/12" />
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">{pubCount}</span>
              <span className="text-[11px] text-white/40">Posts</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white" style={{ color: `${accent}` }}>
                {totalLikes >= 1000 ? `${(totalLikes / 1000).toFixed(1)}k` : totalLikes}
              </span>
              <span className="text-[11px] text-white/40">Likes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">{recipeUses}</span>
              <span className="text-[11px] text-white/40">Remixes</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/8 px-6">
          {(["published", "drafts", "liked"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`mr-4 border-b-2 pb-2.5 pt-1 text-[11px] font-semibold capitalize transition-colors ${tab === t ? "border-white/80 text-white" : "border-transparent text-white/35 hover:text-white/60"}`}
            >{t}</button>
          ))}
        </div>

        <div className="px-6 py-5">
          {tab === "published" && (
            <>
              {isOwnProfile && unifiedPosts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Globe size={28} className="mb-3 text-white/15" />
                  <p className="text-sm font-semibold text-white/30">No published projects yet</p>
                  <p className="mt-1 text-[11px] text-white/20">Finish an edit in the Studio and hit Publish.</p>
                  <button onClick={() => router.push("/studio")} className="mt-4 flex items-center gap-1.5 rounded-lg bg-purple-500/20 px-3 py-2 text-xs font-bold text-purple-300 transition-colors hover:bg-purple-500/30">
                    <Zap size={11} />Open Studio
                  </button>
                </div>
              )}
              {isOwnProfile && unifiedPosts.length > 0 && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {unifiedPosts.map((item, i) => (
                    <PostCard key={item.id} title={item.title} accentColor={item.accent} bgColor={item.bg} index={i}
                      videoUrl={item.post?.videoUrl}
                      post={item.post}
                      onOpen={() => handleOpenPost(item)}
                      onDelete={item.type === "feed" ? () => removePost(item.id) : undefined}
                    />
                  ))}
                </div>
              )}
              {!isOwnProfile && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {Array.from({ length: Math.min(mockCount, 10) }).map((_, i) => (
                    <PostCard key={i} title={`Edit #${i + 1}`} accentColor={accent} bgColor={bannerBg} index={i} onOpen={() => router.push("/")} />
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "drafts" && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Edit3 size={28} className="mb-3 text-white/15" />
              <p className="text-sm font-semibold text-white/30">No drafts</p>
              <p className="mt-1 text-[11px] text-white/20">Saved drafts will appear here.</p>
            </div>
          )}
          {tab === "liked" && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Heart size={28} className="mb-3 text-white/15" />
              <p className="text-sm font-semibold text-white/30">No liked projects</p>
              <p className="mt-1 text-[11px] text-white/20">Projects you heart will appear here.</p>
            </div>
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes profile-card-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      ` }} />
    </div>
  );
}
