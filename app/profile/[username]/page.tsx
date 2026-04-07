"use client";

import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Zap, Globe, Heart, Edit3, Users, Trash2, X, Check, WifiOff, Share2, Grid3X3, LayoutGrid, Clock, Layers, GitBranch, Instagram, Twitter, Youtube, Eye } from "lucide-react";
import { useUserStore, DEFAULT_PROFILE } from "@/lib/store/user-store";
import { useFeedStore, type FeedPost, isBlobUrl } from "@/lib/store/feed-store";
import { useProjectStore } from "@/lib/store/project-store";
import { useProjectsRegistry } from "@/lib/store/projects-registry";
import { TheaterMode } from "@/components/feed/theater-mode";
import { getTrendingData } from "@/lib/stats";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { canRemix, getRemixMode } from "@/lib/policy";
import { validateSerializedProject, DISPLAY_NAME_MAX, BIO_MAX } from "@/lib/schema";

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
const PostCard = memo(function PostCard({ title, accentColor, bgColor, index, videoUrl, post, onOpen, onDelete, views, createdAt }: {
  title: string; accentColor: string; bgColor: string; index: number; videoUrl?: string;
  post?: FeedPost | null; onOpen: () => void; onDelete?: () => void;
  views?: number; createdAt?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Lazy-mount video only when card enters viewport
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
    <article ref={cardRef} className="group relative cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-transform duration-300 ease-out hover:scale-105 hover:border-white/20"
      onClick={onOpen} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <div className="relative aspect-[9/16]" style={{ background: bgColor }}>
        {/* Delete confirmation overlay */}
        {confirmDelete && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-bold text-white">Delete this post?</p>
            <div className="flex gap-2">
              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-[10px] font-semibold text-white/60 hover:bg-white/8">Cancel</button>
              <button onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
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
        {firstClipSrc && isVisible && (
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
          <p className="mb-1.5 truncate text-[11px] font-bold text-white">{title}</p>
          <div className="mb-2 flex items-center gap-3 text-[9px] font-semibold text-white/70">
            {typeof views === "number" && (
              <span className="flex items-center gap-1"><Eye size={9} />{views >= 1000 ? `${(views / 1000).toFixed(1)}k` : views}</span>
            )}
            {typeof createdAt === "number" && createdAt > 0 && (
              <span className="flex items-center gap-1"><Clock size={9} />{new Date(createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            )}
          </div>
          <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold text-white transition-all"
            style={{ background: `${accentColor}cc` }}><Zap size={9} />Open</button>
        </div>
        <div className={`absolute inset-x-0 bottom-0 p-3 transition-opacity ${hovered ? "opacity-0" : ""}`}>
          <p className="truncate text-[10px] font-medium text-white/55">{title}</p>
        </div>
      </div>
    </article>
  );
});

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
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={DISPLAY_NAME_MAX}
              className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white outline-none focus:border-purple-500/40" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Bio</span>
            <textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={2} maxLength={BIO_MAX}
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

type ViewMode = "grid" | "compact";
type Tab = "published" | "drafts" | "liked";

// ── Helpers for Compact Row metadata ─────────────────────────────────────────

function fmtDurationMicros(micros: number): string {
  const secs = Math.floor(micros / 1_000_000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** Derive remix count for a post by scanning the feed for posts whose remixedFromPostId matches. */
function useRemixCount(postId: string, allPosts: FeedPost[]): number {
  return useMemo(
    () => allPosts.filter((p) => p.remixedFromPostId === postId).length,
    [postId, allPosts]
  );
}

// ── Compact Preview Row (56px, 16:9 static thumbnail + metadata) ─────────────
function PostCompactRow({ item, allPosts, onOpen, onDelete, isMultiSelectMode = false, isSelected = false, onSelect }: {
  item: { type: "feed" | "registry"; id: string; title: string; accent: string; bg: string; date: number; post: FeedPost | null };
  allPosts: FeedPost[];
  onOpen: () => void;
  onDelete?: () => void;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const snap = item.post?.projectSnapshot;
  const trackCount = snap?.tracks.length ?? 0;
  const durationMicros = snap?.duration ?? 0;
  const remixCount = useRemixCount(item.id, allPosts);

  // Thumbnail source from snapshot — same logic as PostCard
  const thumbSrc = useMemo(() => {
    if (!snap) return item.post?.videoUrl;
    const pool = snap.mediaPool ?? [];
    const first = snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips)
      .sort((a, b) => a.startTime - b.startTime)[0];
    return first ? (pool.find((m) => m.id === first.sourceId)?.previewUrl ?? item.post?.videoUrl) : item.post?.videoUrl;
  }, [snap, item.post?.videoUrl]);

  const thumbOffset = useMemo(() => {
    if (!snap) return 0.001;
    const first = snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips)
      .sort((a, b) => a.startTime - b.startTime)[0];
    return first ? Math.max(0.001, (first.mediaOffset ?? 0) / 1_000_000) : 0.001;
  }, [snap]);

  // IntersectionObserver — lazy-mount video
  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { rootMargin: "100px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      onClick={isMultiSelectMode ? () => onSelect?.(item.id) : undefined}
      className={`group flex items-center gap-3 rounded-lg border px-2 py-1.5 transition-colors ${
        isSelected
          ? "border-red-500/30 bg-red-500/8"
          : "border-white/6 bg-white/[0.02] hover:border-white/14 hover:bg-white/[0.04]"
      } ${isMultiSelectMode ? "cursor-pointer" : ""}`}
    >
      {isMultiSelectMode && (
        <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
          isSelected ? "border-red-400 bg-red-500/30" : "border-white/20 bg-transparent"
        }`}>
          {isSelected && <Check size={9} className="text-red-300" />}
        </div>
      )}
      {/* 16:9 thumbnail — 99×56px, static frame, no autoplay */}
      <div ref={thumbRef} className="relative h-[56px] w-[99px] shrink-0 overflow-hidden rounded-md" style={{ background: item.bg }}>
        {thumbSrc && isVisible && (
          <video ref={videoRef} src={thumbSrc} muted playsInline preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
            onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = thumbOffset; }} />
        )}
        {!thumbSrc && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-3 w-3 rounded-sm" style={{ background: item.accent, opacity: 0.3 }} />
          </div>
        )}
      </div>

      {/* Title + meta */}
      <button onClick={onOpen} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate text-[11px] font-bold text-white/85">{item.title}</span>
        <div className="flex items-center gap-3 text-[9px] text-white/35">
          {trackCount > 0 && (
            <span className="flex items-center gap-1"><Layers size={8} />{trackCount} tracks</span>
          )}
          {durationMicros > 0 && (
            <span className="flex items-center gap-1"><Clock size={8} />{fmtDurationMicros(durationMicros)}</span>
          )}
          {remixCount > 0 && (
            <span className="flex items-center gap-1"><GitBranch size={8} />{remixCount} remix{remixCount !== 1 ? "es" : ""}</span>
          )}
          {item.date > 0 && (
            <span>{new Date(item.date).toLocaleDateString()}</span>
          )}
        </div>
      </button>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button onClick={onOpen}
          className="flex items-center gap-1 rounded-md bg-white/6 px-2 py-1 text-[9px] font-semibold text-white/50 opacity-0 transition-all group-hover:opacity-100 hover:bg-white/12 hover:text-white/75">
          <Zap size={8} />Open
        </button>
        {onDelete && !confirmDelete && (
          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-white/25 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-400">
            <Trash2 size={9} />
          </button>
        )}
        {confirmDelete && (
          <div className="flex items-center gap-1">
            <button onClick={() => setConfirmDelete(false)} className="rounded px-1.5 py-0.5 text-[9px] text-white/40 hover:bg-white/8">No</button>
            <button onClick={() => onDelete?.()} className="rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-bold text-red-400 hover:bg-red-500/30">Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Inline Bio Editor (own profile only) ─────────────────────────────────────
function InlineBioEditor() {
  const profile = useUserStore((s) => s.profile);
  const setProfile = useUserStore((s) => s.setProfile);
  const currentBio = profile?.bio ?? DEFAULT_PROFILE.bio;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentBio);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(currentBio);
  }, [currentBio, editing]);

  useEffect(() => {
    if (editing) {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(draft.length, draft.length);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    const trimmed = draft.slice(0, BIO_MAX);
    if (trimmed !== currentBio) setProfile({ bio: trimmed });
    setEditing(false);
  };

  const cancel = () => {
    setDraft(currentBio);
    setEditing(false);
  };

  if (!editing) {
    return (
      <p
        onClick={() => setEditing(true)}
        className="mt-1.5 cursor-text whitespace-pre-wrap rounded px-1 -mx-1 text-[13px] leading-snug text-white/70 transition-colors hover:bg-white/5"
        title="Click to edit bio"
      >
        {currentBio || <span className="italic text-white/30">Add a bio…</span>}
      </p>
    );
  }

  return (
    <div className="mt-1.5">
      <textarea
        ref={taRef}
        value={draft}
        rows={3}
        maxLength={BIO_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        className="w-full resize-none rounded-lg border border-brand-accent/40 bg-white/5 px-2 py-1.5 text-[13px] leading-snug text-white outline-none focus:border-brand-accent"
      />
      <div className="mt-1 flex justify-end text-[10px] tabular-nums text-white/40">
        <span className={draft.length >= BIO_MAX ? "text-red-400" : ""}>{draft.length}/{BIO_MAX}</span>
      </div>
    </div>
  );
}

// ── Secure Social Link row ────────────────────────────────────────────────────
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function SocialLinkRow({ links }: { links?: { instagram?: string; x?: string; youtube?: string; website?: string } }) {
  if (!links) return null;
  const items: Array<{ key: string; icon: typeof Instagram; raw?: string; label: string }> = [
    { key: "instagram", icon: Instagram, raw: links.instagram, label: "Instagram" },
    { key: "x",         icon: Twitter,   raw: links.x,         label: "X" },
    { key: "youtube",   icon: Youtube,   raw: links.youtube,   label: "YouTube" },
    { key: "website",   icon: Globe,     raw: links.website,   label: "Website" },
  ];
  const valid = items
    .map((i) => ({ ...i, href: i.raw ? normalizeUrl(i.raw) : null }))
    .filter((i): i is typeof i & { href: string } => !!i.href);

  if (valid.length === 0) return null;
  return (
    <div className="mt-3 flex items-center gap-2">
      {valid.map(({ key, icon: Icon, href, label }) => (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/8 text-white/55 transition-colors hover:bg-white/15 hover:text-white"
        >
          <Icon size={13} />
        </a>
      ))}
    </div>
  );
}

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
  const removePost   = useFeedStore((s) => s.removePost);
  const removePosts  = useFeedStore((s) => s.removePosts);
  const registryProjects = useProjectsRegistry((s) => s.projects);

  const [tab, setTab]                  = useState<Tab>("published");
  const [viewMode, setViewMode]        = useState<ViewMode>("grid");
  const [showEditProfile, setShowEdit] = useState(false);
  const [forceRender, setForceRender]  = useState(false);
  const [theaterPost, setTheaterPost]  = useState<FeedPost | null>(null);
  const [selectedIds, setSelectedIds]         = useState<Set<string>>(new Set());
  const [isMultiSelect, setIsMultiSelect]     = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [isBatchConfirming, setIsBatchConfirming] = useState(false);

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
  // Public published posts — strictly status === "published" (or legacy posts with no status field).
  // NEVER mix in registry "Project Folders" / drafts here — those are private to the owner.
  const publishedPosts = useMemo(() => {
    return allUserPosts
      .filter((p) => p.authorUsername === currentUser.username || (isOwnProfile && !p.authorUsername))
      .filter((p) => {
        const s = (p as unknown as { status?: string }).status;
        return s === undefined || s === "published";
      })
      .map((p) => ({ type: "feed" as const, id: p.id, title: p.title, accent: p.accent, bg: p.bg, date: p.createdAt ?? 0, post: p }))
      .sort((a, b) => b.date - a.date);
  }, [allUserPosts, currentUser.username, isOwnProfile]);

  // Owner-only: Project Folders / drafts from the local registry. Never exposed to visitors.
  const draftProjects = useMemo(() => {
    if (!isOwnProfile) return [];
    return registryProjects
      .map((p) => ({ type: "registry" as const, id: p.id, title: p.name, accent, bg: bannerBg, date: p.lastEdited, post: null as FeedPost | null }))
      .sort((a, b) => b.date - a.date);
  }, [registryProjects, isOwnProfile, accent, bannerBg]);

  // Compact view still benefits from the union — owner only.
  const unifiedPosts = useMemo(
    () => [...publishedPosts, ...draftProjects].sort((a, b) => b.date - a.date),
    [publishedPosts, draftProjects]
  );

  // Locked queue for Theater Mode — exact filtered/ordered published posts as seen in the grid.
  // When set, TheaterMode disables buildQueue reshuffling/recommendation logic.
  const profileQueue = useMemo(
    () => publishedPosts.map((it) => it.post).filter((p): p is FeedPost => !!p),
    [publishedPosts]
  );

  const mockCount = isOwnProfile ? 0 : (creator?.postCount ?? 0);
  const pubCount  = isOwnProfile ? publishedPosts.length : mockCount;

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

  const handleBatchDelete = useCallback(async () => {
    // Action-path guard — executes even if UI state is tampered via DevTools.
    if (!isOwnProfile) {
      console.warn("[Profile] handleBatchDelete: unauthorized call on non-own profile — ignoring");
      return;
    }
    // Require explicit user confirmation before touching IDB.
    if (!isBatchConfirming) return;
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setIsBatchDeleting(true);
    try {
      await removePosts(ids);
      setSelectedIds(new Set());
      setIsMultiSelect(false);
      setIsBatchConfirming(false);
    } catch (err) {
      console.error("[Profile] batch delete failed:", err);
      // Posts remain in store — IDB and state are consistent (removePosts only
      // updates state after all IDB deletes succeed).
    } finally {
      setIsBatchDeleting(false);
    }
  }, [selectedIds, removePosts, isOwnProfile, isBatchConfirming]);

  const toggleSelect = useCallback((id: string) => {
    setIsBatchConfirming(false); // changing selection dismisses any pending confirm
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const handleOpenPost = (item: typeof unifiedPosts[0]) => {
    if (item.type === "feed" && item.post) {
      setTheaterPost(item.post); // open Theater Mode — "Edit in Studio" button inside handles Studio redirect
    } else if (item.type === "registry") {
      try {
        const r = localStorage.getItem(`synapse-remix-${item.id}`);
        if (r) {
          const validated = validateSerializedProject(JSON.parse(r), `localStorage remix ${item.id}`);
          if (validated) loadProject(validated as Parameters<typeof loadProject>[0]);
        }
      } catch { /* ignore malformed localStorage */ }
      router.push("/studio");
    }
  };

  const handleStudioLoad = (p: FeedPost) => {
    // Routing determined by policy — no component-level remix logic.
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
    }
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
          onRemix={(p) => handleStudioLoad(p)}
          onCreator={() => { setTheaterPost(null); router.push(`/profile/${theaterPost.user.handle}`); }}
          allPosts={profileQueue}
          lockedQueue={profileQueue}
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
        {/* ── Cinematic 21:9 banner ──────────────────────────────────────────── */}
        <div className="relative h-[180px] w-full shrink-0 overflow-hidden"
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
          {/* Bottom-to-top readability gradient */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/40 to-transparent" />
        </div>

        {/* ── Avatar + info ──────────────────────────────────────────────────── */}
        <div className="relative px-6 pb-5" style={{ animation: "profile-card-in 0.34s cubic-bezier(0.22,1,0.36,1) both" }}>
          <div className="relative -mt-12 mb-3 flex items-end justify-between">
            {/* Avatar — glassmorphic border overlapping banner */}
            <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full border-2 border-white/25 bg-white/10 text-3xl font-bold text-white backdrop-blur-md"
              style={{ background: `hsl(${profile.hue} 55% 32%)`, boxShadow: `0 8px 32px ${accent}55, 0 0 0 4px rgba(20,20,20,0.6)` }}>
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
                  className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-bold text-white transition-all duration-200 hover:scale-[1.02] hover:bg-brand-accent">
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
          {isOwnProfile ? (
            <InlineBioEditor />
          ) : (
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-snug text-white/70">{profile.bio}</p>
          )}
          <SocialLinkRow links={isOwnProfile ? currentUser.socialLinks : undefined} />

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

        {/* Tabs + View Mode Toggle */}
        <div className="flex items-center justify-between border-b border-white/8 px-6">
          <div className="flex">
            {((isOwnProfile ? ["published", "drafts", "liked"] : ["published", "liked"]) as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`mr-4 border-b-2 pb-2.5 pt-1 text-[11px] font-semibold capitalize transition-colors ${tab === t ? "border-brand-accent text-white" : "border-transparent text-white/35 hover:text-white/60"}`}
              >{t}</button>
            ))}
          </div>
          {tab === "published" && (
            <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-white/[0.03] p-0.5">
              <button onClick={() => setViewMode("grid")} title="Grid"
                className={`rounded-md p-1.5 transition-colors ${viewMode === "grid" ? "bg-white/10 text-white/80" : "text-white/30 hover:text-white/55"}`}>
                <Grid3X3 size={11} />
              </button>
              <button onClick={() => setViewMode("compact")} title="Compact"
                className={`rounded-md p-1.5 transition-colors ${viewMode === "compact" ? "bg-white/10 text-white/80" : "text-white/30 hover:text-white/55"}`}>
                <LayoutGrid size={11} />
              </button>
            </div>
          )}
        </div>
        {tab === "published" && isOwnProfile && viewMode === "compact" && (
          <div className="flex items-center gap-2 border-t border-white/6 bg-[#141414]/80 px-6 py-2">
            <button
              onClick={() => { setIsMultiSelect((v) => !v); setSelectedIds(new Set()); setIsBatchConfirming(false); }}
              className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                isMultiSelect ? "bg-white/12 text-white/80" : "text-white/35 hover:bg-white/8 hover:text-white/60"
              }`}
            >
              {isMultiSelect ? "Cancel" : "Select"}
            </button>
            {isMultiSelect && selectedIds.size > 0 && !isBatchConfirming && (
              <button
                onClick={() => setIsBatchConfirming(true)}
                disabled={isBatchDeleting}
                className="flex items-center gap-1 rounded-md bg-red-500/20 px-2.5 py-1 text-[10px] font-bold text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
              >
                <Trash2 size={9} />
                Delete {selectedIds.size}
              </button>
            )}
            {isMultiSelect && selectedIds.size > 0 && isBatchConfirming && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-white/50">
                  Permanently delete {selectedIds.size} post{selectedIds.size !== 1 ? "s" : ""}?
                </span>
                <button
                  onClick={() => setIsBatchConfirming(false)}
                  className="rounded px-1.5 py-0.5 text-[9px] text-white/40 hover:bg-white/8"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={isBatchDeleting}
                  className="rounded bg-red-500/25 px-1.5 py-0.5 text-[9px] font-bold text-red-400 hover:bg-red-500/35 disabled:opacity-50"
                >
                  {isBatchDeleting ? "Deleting…" : "Yes, delete"}
                </button>
              </div>
            )}
            {isMultiSelect && selectedIds.size === 0 && (
              <span className="text-[10px] text-white/30">Tap rows to select</span>
            )}
          </div>
        )}

        <div className="px-6 py-5">
          {tab === "published" && (
            <>
              {isOwnProfile && publishedPosts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Globe size={28} className="mb-3 text-white/15" />
                  <p className="text-sm font-semibold text-white/30">No published projects yet</p>
                  <p className="mt-1 text-[11px] text-white/20">Finish an edit in the Studio and hit Publish.</p>
                  <button onClick={() => router.push("/studio")} className="mt-4 flex items-center gap-1.5 rounded-lg bg-purple-500/20 px-3 py-2 text-xs font-bold text-purple-300 transition-colors hover:bg-purple-500/30">
                    <Zap size={11} />Open Studio
                  </button>
                </div>
              )}
              {isOwnProfile && publishedPosts.length > 0 && viewMode === "grid" && (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {publishedPosts.map((item, i) => (
                    <PostCard key={item.id} title={item.title} accentColor={item.accent} bgColor={item.bg} index={i}
                      videoUrl={item.post?.videoUrl}
                      post={item.post}
                      views={item.post?.likes}
                      createdAt={item.date}
                      onOpen={() => handleOpenPost(item)}
                      onDelete={item.type === "feed" ? () => removePost(item.id) : undefined}
                    />
                  ))}
                </div>
              )}
              {isOwnProfile && unifiedPosts.length > 0 && viewMode === "compact" && (
                <div className="flex flex-col gap-1.5">
                  {unifiedPosts.map((item) => (
                    <PostCompactRow key={item.id} item={item} allPosts={allUserPosts}
                      onOpen={() => handleOpenPost(item)}
                      onDelete={item.type === "feed" ? () => removePost(item.id) : undefined}
                      isMultiSelectMode={isMultiSelect}
                      isSelected={selectedIds.has(item.id)}
                      onSelect={toggleSelect}
                    />
                  ))}
                </div>
              )}
              {!isOwnProfile && (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {Array.from({ length: Math.min(mockCount, 10) }).map((_, i) => (
                    <PostCard key={i} title={`Edit #${i + 1}`} accentColor={accent} bgColor={bannerBg} index={i} onOpen={() => router.push("/")} />
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "drafts" && isOwnProfile && (
            draftProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Edit3 size={28} className="mb-3 text-white/15" />
                <p className="text-sm font-semibold text-white/30">No drafts</p>
                <p className="mt-1 text-[11px] text-white/20">Saved project folders will appear here — only you can see them.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {draftProjects.map((item, i) => (
                  <PostCard key={item.id} title={item.title} accentColor={item.accent} bgColor={item.bg} index={i}
                    post={item.post}
                    createdAt={item.date}
                    onOpen={() => handleOpenPost(item)}
                  />
                ))}
              </div>
            )
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
