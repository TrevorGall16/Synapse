"use client";

import { useState, useMemo, useRef, useEffect, useCallback, memo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Zap, Globe, Heart, Edit3, Users, Trash2, X, Check, Share2, Grid3X3, LayoutGrid, Clock, Instagram, Twitter, Youtube, Eye, Star } from "lucide-react";
import { useUserStore, DEFAULT_PROFILE } from "@/lib/store/user-store";
import { useFeedStore, type FeedPost, isBlobUrl } from "@/lib/store/feed-store";
import { useProjectStore } from "@/lib/store/project-store";
import { useProjectsRegistry } from "@/lib/store/projects-registry";
import { TheaterMode } from "@/components/feed/theater-mode";
import { ShareSheet } from "@/components/feed/share-sheet";
import { getTrendingData } from "@/lib/stats";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { canRemix, getRemixMode } from "@/lib/policy";
import { validateSerializedProject, DISPLAY_NAME_MAX, BIO_MAX } from "@/lib/schema";
import { navigateToCreator } from "@/lib/nav/theater-nav";
import { formatFollowerCount } from "@/lib/social";
import { loadThumbnailUrl } from "@/lib/store/thumbnail-idb";

// ── Mock creator profiles ─────────────────────────────────────────────────────
// Wiped for launch — only the signed-in user's profile is populated. Lookups
// against an unknown handle return undefined, which the consuming code below
// already handles via `?.` chains and `?? 0` fallbacks.
const CREATOR_MAP: Record<string, { displayName: string; bio: string; hue: number; followers: number; following: number; postCount: number; totalLikes: number; remixes: number }> = {};
const MOCK_ACCENT: Record<string, string> = {};
const MOCK_BG: Record<string, string> = {};

// ── Unified post card ─────────────────────────────────────────────────────────
const PostCard = memo(function PostCard({ title, accentColor, bgColor, index, videoUrl, post, onOpen, onDelete, onTogglePin, views, createdAt }: {
  title: string; accentColor: string; bgColor: string; index: number; videoUrl?: string;
  post?: FeedPost | null; onOpen: () => void; onDelete?: () => void;
  onTogglePin?: () => void;
  views?: number; createdAt?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  // Durable thumbnail from IDB — same source feed-post-card uses, so the
  // Profile grid never falls back to the dark "no preview" placeholder when
  // we already have a real frame stored.
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (!post?.id) { setThumbUrl(null); return; }
    let cancelled = false;
    loadThumbnailUrl(post.id).then((u) => { if (!cancelled) setThumbUrl(u ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [post?.id]);

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
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]/85 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
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
        {/* Durable IDB thumbnail behind the video — keeps the card from going
            dark on grids where the lazy-mounted <video> hasn't decoded yet. */}
        {thumbUrl && (
          <img src={thumbUrl} alt="" aria-hidden draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ zIndex: 0 }} />
        )}
        {firstClipSrc && isVisible && (
          <video ref={videoRef} src={firstClipSrc} muted loop playsInline preload="metadata"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${hovered || !thumbUrl ? "opacity-100" : "opacity-0"}`}
            onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = firstClipOffset; }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80" />

        {/* Pin badge — fades out on hover to make room for action buttons. */}
        {post?.featured && (
          <div
            className={`pointer-events-none absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 shadow-[0_2px_10px_rgba(251,191,36,0.55)] transition-opacity duration-200 ${hovered ? "opacity-0" : "opacity-100"}`}
            aria-label="Pinned to profile"
          >
            <Star size={12} className="fill-white text-white drop-shadow" />
          </div>
        )}

        {/* Hover actions: pin (if author) + delete. Stacked top-right so they
            don't fight for the same pixel. */}
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onTogglePin && (
            <button onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
              title={post?.featured ? "Unpin from profile" : "Pin to profile"}
              className={`flex h-6 w-6 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                post?.featured
                  ? "bg-amber-500/80 text-white hover:bg-amber-500"
                  : "bg-[#0a0a0a]/60 text-white/45 hover:bg-amber-500/35 hover:text-amber-300"
              }`}>
              <Star size={10} className={post?.featured ? "fill-white" : ""} />
            </button>
          )}
          {onDelete && (
            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0a0a0a]/60 text-white/45 backdrop-blur-sm transition-colors hover:bg-red-500/30 hover:text-red-400">
              <Trash2 size={10} />
            </button>
          )}
        </div>

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xs rounded-3xl border border-white/14 bg-[#1c1c1c] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <span className="text-base font-bold text-white">Edit Profile</span>
          <button onClick={onClose} className="rounded-xl bg-white/8 p-1.5 text-white/40 hover:bg-white/15 hover:text-white"><X size={12} /></button>
        </div>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Display Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={DISPLAY_NAME_MAX}
              className="rounded-xl border border-white/10 bg-white/4 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-accent/40" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Bio</span>
            <textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={2} maxLength={BIO_MAX}
              className="resize-none rounded-xl border border-white/10 bg-white/4 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-accent/40" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Accent Hue</span>
            <input type="range" min={0} max={359} value={editHue} onChange={(e) => setEditHue(+e.target.value)} className="w-full" />
            <div className="h-3 w-full rounded-full" style={{ background: "linear-gradient(to right,hsl(0,55%,45%),hsl(60,55%,45%),hsl(120,55%,45%),hsl(180,55%,45%),hsl(240,55%,45%),hsl(300,55%,45%),hsl(359,55%,45%))" }} />
          </label>
          <div className="mt-1 flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-white/50 hover:bg-white/8">Cancel</button>
            <button onClick={save} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand/20 py-2.5 text-sm font-bold text-brand-text hover:bg-brand/30">
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


// ── Square tile (8-col visual wall — no metadata, hover plays the clip) ─────
function PostSquareTile({ item, onOpen, isMultiSelectMode = false, isSelected = false, onSelect }: {
  item: { type: "feed" | "registry"; id: string; title: string; accent: string; bg: string; date: number; post: FeedPost | null };
  onOpen: () => void;
  isMultiSelectMode?: boolean;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}) {
  const tileRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  const snap = item.post?.projectSnapshot;
  const firstClipSrc = useMemo(() => {
    if (!snap) return item.post?.videoUrl;
    const pool = snap.mediaPool ?? [];
    const first = snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips)
      .sort((a, b) => a.startTime - b.startTime)[0];
    return first ? (pool.find((m) => m.id === first.sourceId)?.previewUrl ?? item.post?.videoUrl) : item.post?.videoUrl;
  }, [snap, item.post?.videoUrl]);

  const firstClipOffset = useMemo(() => {
    if (!snap) return 0.001;
    const first = snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips)
      .sort((a, b) => a.startTime - b.startTime)[0];
    return first ? Math.max(0.001, (first.mediaOffset ?? 0) / 1_000_000) : 0.001;
  }, [snap]);

  useEffect(() => {
    const el = tileRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!item.post?.id) { setThumbUrl(null); return; }
    let cancelled = false;
    loadThumbnailUrl(item.post.id).then((u) => { if (!cancelled) setThumbUrl(u ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [item.post?.id]);

  const isPinned = !!item.post?.featured;

  return (
    <button
      ref={tileRef}
      onClick={isMultiSelectMode ? () => onSelect?.(item.id) : onOpen}
      onMouseEnter={() => {
        setHovered(true);
        const v = videoRef.current;
        if (v && firstClipSrc) { v.currentTime = firstClipOffset; v.play().catch(() => {}); }
      }}
      onMouseLeave={() => {
        setHovered(false);
        const v = videoRef.current;
        if (v) { v.pause(); v.currentTime = firstClipOffset; }
      }}
      className={`group relative aspect-square w-full overflow-hidden rounded-md ring-1 ring-inset transition-all ${
        isSelected ? "ring-red-400/70" : "ring-white/[0.04] hover:ring-white/15"
      }`}
      style={{ background: item.bg }}
      title={item.title}
    >
      {thumbUrl && (
        <img src={thumbUrl} alt="" aria-hidden draggable={false}
          className="absolute inset-0 h-full w-full object-cover" />
      )}
      {firstClipSrc && isVisible && (
        <video ref={videoRef} src={firstClipSrc} muted loop playsInline preload="metadata"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${hovered || !thumbUrl ? "opacity-100" : "opacity-0"}`}
          onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = firstClipOffset; }} />
      )}
      {!firstClipSrc && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 rounded-sm" style={{ background: item.accent, opacity: 0.4 }} />
        </div>
      )}
      {isPinned && (
        <div className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 shadow-[0_1px_4px_rgba(251,191,36,0.55)]">
          <Star size={8} className="fill-white text-white" />
        </div>
      )}
      {isMultiSelectMode && (
        <div className={`absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded border transition-colors ${
          isSelected ? "border-red-400 bg-red-500/40" : "border-white/40 bg-black/30"
        }`}>
          {isSelected && <Check size={9} className="text-red-100" />}
        </div>
      )}
    </button>
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
        className="w-full resize-none rounded-xl border border-brand-accent/40 bg-white/5 px-2 py-1.5 text-[13px] leading-snug text-white outline-none focus:border-brand-accent"
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
  const handleFromParams = Array.isArray(params.username) ? params.username[0] : (params.username ?? "");
  // Optimistic follower delta for this creator — bumped instantly when the
  // viewer hits Follow anywhere in the app. Falls back to 0 for untouched creators.
  const followerDelta = useUserStore((s) => s.followerDeltas[handleFromParams] ?? 0);
  // Reactive follow state — single source of truth for both TheaterUI and here.
  const isFollowingCreator = useUserStore((s) => s.following.includes(handleFromParams));
  const storeFollowCreator = useUserStore((s) => s.followCreator);
  const storeUnfollowCreator = useUserStore((s) => s.unfollowCreator);
  const [shareOpen, setShareOpen] = useState(false);
  const openProjectInTab = useProjectStore((s) => s.openProjectInTab);
  const loadProject      = useProjectStore((s) => s.loadProject);
  const allUserPosts     = useFeedStore((s) => s.userPosts);
  const removePost   = useFeedStore((s) => s.removePost);
  const removePosts  = useFeedStore((s) => s.removePosts);
  const togglePin    = useFeedStore((s) => s.togglePin);
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
  const profileBase  = isOwnProfile
    ? { displayName: currentUser.displayName, bio: currentUser.bio, hue: currentUser.hue, followers: currentUser.followers, following: currentUser.following }
    : (creator ?? { displayName: username, bio: "Synapse creator", hue: 200, followers: 0, following: 0 });
  // Apply the optimistic follow delta to the target creator's follower count.
  const profile = isOwnProfile
    ? profileBase
    : { ...profileBase, followers: Math.max(0, profileBase.followers + followerDelta) };

  const accent   = isOwnProfile ? `hsl(${profile.hue} 55% 45%)` : (MOCK_ACCENT[username] ?? "#7c3aed");
  const bannerBg = isOwnProfile ? `hsl(${profile.hue} 30% 8%)`  : (MOCK_BG[username]     ?? "#1a1a1a");

  const offlinePosts = allUserPosts.filter((p) => isBlobUrl(p.videoUrl));

  // ── useMemo MUST come before any conditional return (Rules of Hooks) ────────
  // Public published posts — strictly status === "published" (or legacy posts with no status field).
  // NEVER mix in registry "Project Folders" / drafts here — those are private to the owner.
  //
  // Sort order: pinned posts first (by `pinnedAt` DESC — newest pin wins the
  // top slot), then everything else by `createdAt` DESC. Legacy `featured`
  // posts without a `pinnedAt` field fall in the pinned bucket but sort below
  // posts that have a real timestamp.
  const publishedPosts = useMemo(() => {
    return allUserPosts
      .filter((p) => p.authorUsername === currentUser.username || (isOwnProfile && !p.authorUsername))
      .filter((p) => {
        const s = (p as unknown as { status?: string }).status;
        return s === undefined || s === "published";
      })
      .map((p) => ({
        type: "feed" as const,
        id: p.id,
        title: p.title,
        accent: p.accent,
        bg: p.bg,
        date: p.createdAt ?? 0,
        pinnedAt: p.pinnedAt ?? (p.featured ? 1 : 0),
        post: p,
      }))
      .sort((a, b) => {
        if (a.pinnedAt !== b.pinnedAt) return b.pinnedAt - a.pinnedAt;
        return b.date - a.date;
      });
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

  // ── Loading gate — AFTER all hook declarations ────────────────────────────
  if (isOwnProfile && (!storeProfile || !hasHydrated) && !forceRender) return (
    <div className="flex h-full flex-col overflow-hidden bg-[#121014]">
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
    <div className="flex h-full flex-col overflow-hidden bg-[#121014]">
      {showEditProfile && <EditProfileModal onClose={() => setShowEdit(false)} />}
      <ShareSheet
        target={{ kind: "profile", handle: username, displayName: profile.displayName }}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        withBackdrop
      />
      {theaterPost && (
        <TheaterMode
          post={theaterPost}
          onClose={() => setTheaterPost(null)}
          onRemix={(p) => handleStudioLoad(p)}
          onCreator={(activePost) => navigateToCreator(router, activePost, () => setTheaterPost(null))}
          allPosts={profileQueue}
          lockedQueue={profileQueue}
          onNavigate={(p) => setTheaterPost(p)}
        />
      )}

      {/* Back nav */}
      <div className="z-10 shrink-0 flex items-center gap-2 border-b border-white/8 bg-[#121014]/95 px-4 py-2.5 backdrop-blur-sm">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/14 hover:text-white">
          <ArrowLeft size={11} />Back
        </button>
        <span className="text-[11px] text-white/35">@{username}</span>
        {/* Cleanup developer button removed — hydrateAllPosts now repairs
            offline blob URLs automatically on every boot. */}
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
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#121014] via-[#141414]/40 to-transparent" />
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
                {/* Follow button — reads/writes exclusively from useUserStore
                    so state stays synced with TheaterUI instantly. Hidden on
                    isOwnProfile (handled by the outer ternary). */}
                <button
                  onClick={() => {
                    if (isFollowingCreator) storeUnfollowCreator(username);
                    else                    storeFollowCreator(username);
                  }}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-all duration-200 hover:scale-[1.02] ${
                    isFollowingCreator
                      ? "border border-brand-accent/40 bg-brand/20 text-brand-muted hover:bg-brand/30"
                      : "bg-brand text-white hover:bg-brand-accent"
                  }`}
                >
                  <Users size={11} />{isFollowingCreator ? "Following" : "Follow"}
                </button>
                <button
                  onClick={() => setShareOpen(true)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/60 transition-all duration-200 hover:scale-[1.02] hover:bg-white/14"
                >
                  <Share2 size={11} />Share
                </button>
              </div>
            )}
          </div>

          <h1 className="text-xl font-bold text-white">{profile.displayName}</h1>
          <p className="text-sm text-white/45">@{username}</p>
          {isOwnProfile ? (
            <InlineBioEditor />
          ) : (
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-snug text-white/70">{profile.bio}</p>
          )}
          <SocialLinkRow links={isOwnProfile ? currentUser.socialLinks : undefined} />

          {/* ── Stats row ────────────────────────────────────────────────── */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5">
              {/* Follower count — switches to exact mode whenever the viewer
                  has caused a non-zero delta, so the +1 is unambiguous even
                  against a compacted "8.4k" baseline. `key={followerDelta}`
                  remounts the span on every change so the scale-pop keyframe
                  re-triggers each click. */}
              <span
                key={followerDelta}
                className="text-base font-bold text-white tabular-nums"
                style={{
                  animation: followerDelta !== 0 ? "synapse-follower-pop 420ms cubic-bezier(0.22,1,0.36,1)" : undefined,
                  display: "inline-block",
                  transformOrigin: "center",
                }}
              >
                {formatFollowerCount(profile.followers, followerDelta !== 0 ? "exact" : "compact")}
              </span>
              <span className="text-[11px] text-white/40">Followers</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold text-white">{profile.following}</span>
              <span className="text-[11px] text-white/40">Following</span>
            </div>
            <div className="mx-0.5 h-3 w-px self-center bg-white/12" />
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold text-white">{pubCount}</span>
              <span className="text-[11px] text-white/40">Posts</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold text-white" style={{ color: `${accent}` }}>
                {totalLikes >= 1000 ? `${(totalLikes / 1000).toFixed(1)}k` : totalLikes}
              </span>
              <span className="text-[11px] text-white/40">Likes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold text-white">{recipeUses}</span>
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
          <div className="flex items-center gap-2 border-t border-white/6 bg-[#121014]/80 px-6 py-2">
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
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                  {publishedPosts.map((item, i) => (
                    <PostCard key={item.id} title={item.title} accentColor={item.accent} bgColor={item.bg} index={i}
                      videoUrl={item.post?.videoUrl}
                      post={item.post}
                      views={item.post?.likes}
                      createdAt={item.date}
                      onOpen={() => handleOpenPost(item)}
                      onDelete={item.type === "feed" ? () => removePost(item.id) : undefined}
                      onTogglePin={item.type === "feed" ? () => togglePin(item.id) : undefined}
                    />
                  ))}
                </div>
              )}
              {isOwnProfile && publishedPosts.length > 0 && viewMode === "compact" && (
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-6 md:grid-cols-8">
                  {publishedPosts.map((item) => (
                    <PostSquareTile
                      key={item.id}
                      item={item}
                      onOpen={() => handleOpenPost(item)}
                      isMultiSelectMode={isMultiSelect}
                      isSelected={selectedIds.has(item.id)}
                      onSelect={toggleSelect}
                    />
                  ))}
                </div>
              )}
              {!isOwnProfile && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
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
