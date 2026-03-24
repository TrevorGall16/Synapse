"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { X, Zap, Heart, Share2, Play, Pause, MessageCircle, Users, Volume2, VolumeX, GitBranch, WifiOff, Pencil } from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";
import type { ClipEvent, MediaPoolItem } from "@/lib/store/types";
import { hydrateMediaPool } from "@/lib/store/media-pool-db";
import { useHydrationStore } from "@/lib/store/hydration-store";
import { useUserStore } from "@/lib/store/user-store";
import { clipCssFilter, clipCssTransform } from "@/lib/utils/svg-filters";
import { buildTextStyle } from "@/lib/utils/preview-helpers";

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
const TX: React.CSSProperties = { textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,1)", WebkitTextStroke: "0.5px rgba(0,0,0,0.7)" };

/** Build a deduplicated queue: seed first, then same-author posts, then tag-matched, then rest */
function buildQueue(seed: FeedPost, all: FeedPost[]): FeedPost[] {
  const seen = new Set<string>([seed.id]);
  const byAuthor  = all.filter((p) => p.id !== seed.id && p.user.handle === seed.user.handle);
  const byTag     = all.filter((p) => !seen.has(p.id) && p.tags.some((t) => seed.tags.includes(t)) && (byAuthor.forEach((a) => seen.add(a.id)), true));
  const rest      = all.filter((p) => !seen.has(p.id) && !byTag.includes(p));
  byAuthor.forEach((p) => seen.add(p.id));
  byTag.forEach((p) => seen.add(p.id));
  return [seed, ...byAuthor, ...byTag, ...rest].slice(0, 50);
}

// ── TheaterCell ────────────────────────────────────────────────────────────────
interface CellProps {
  post: FeedPost;
  cellRef: (el: HTMLDivElement | null) => void;
  onRemix: () => void;
  onCreator: () => void;
  globalMuted: boolean;
  onToggleMute: () => void;
}

function TheaterCell({ post, cellRef, onRemix, onCreator, globalMuted, onToggleMute }: CellProps) {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const rafRef         = useRef<number | null>(null);
  const phRef          = useRef(0);
  const lastTsRef      = useRef(0);
  const loadedClipRef  = useRef<string | null>(null);
  const isPlayingRef   = useRef(false);
  const clipsRef       = useRef<Array<ClipEvent & { url: string }>>([]);
  const totalDurRef    = useRef(30_000_000);
  const effectClipsRef = useRef<ClipEvent[]>([]);
  const textClipsRef   = useRef<ClipEvent[]>([]);
  const activeAnimRef  = useRef<string | null>(null);

  const [progress, setProgress]       = useState(0);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);
  const [mediaError, setMediaError]   = useState(false);
  const [liked, setLiked]             = useState(false);
  const [hydratedPool, setHydratedPool] = useState<MediaPoolItem[] | null>(null);
  const isHydrated = useHydrationStore((s) => s.isHydrated);
  const currentUsername = useUserStore((s) => s.profile?.username);

  const poolKey = post.id + "|" + (post.projectSnapshot?.mediaPool?.map((m) => m.previewUrl).join(",") ?? "");
  useEffect(() => {
    setHydratedPool(null);
    const pool = post.projectSnapshot?.mediaPool;
    if (!pool?.length) return;
    hydrateMediaPool(pool).then(setHydratedPool).catch(() => setHydratedPool(pool));
  }, [poolKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const snap = post.projectSnapshot;
    const videoClips = snap ? snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips) : [];
    effectClipsRef.current = snap
      ? [...snap.tracks.filter((t) => t.type === "effect").flatMap((t) => t.clips), ...videoClips.flatMap((c) => c.embeddedEffectClips ?? [])]
      : [];
    textClipsRef.current = snap
      ? [...snap.tracks.filter((t) => t.type === "text").flatMap((t) => t.clips), ...videoClips.flatMap((c) => c.embeddedTextClips ?? [])]
      : [];
  }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshotClips = useMemo(() => {
    const snap = post.projectSnapshot;
    if (!snap) return [];
    const pool = (hydratedPool ?? snap.mediaPool) ?? [];
    return snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips)
      .sort((a, b) => a.startTime - b.startTime)
      .map((c) => ({ ...c, url: pool.find((m) => m.id === c.sourceId)?.previewUrl }))
      .filter((c): c is ClipEvent & { url: string } => !!c.url);
  }, [post.projectSnapshot, hydratedPool]);

  useEffect(() => { clipsRef.current = snapshotClips; }, [snapshotClips]);
  useEffect(() => { totalDurRef.current = post.projectSnapshot?.duration ?? 30_000_000; }, [post.projectSnapshot?.duration]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => {
    const v = videoRef.current; if (v) { v.muted = globalMuted; v.volume = globalMuted ? 0 : 1; }
  }, [globalMuted]);

  const syncClip = useCallback((ph: number) => {
    const clips = clipsRef.current;
    const v = videoRef.current;
    if (!v) return;
    const clip = clips.find((c) => ph >= c.startTime && ph < c.startTime + c.duration) ?? null;
    if (!clip) {
      if (loadedClipRef.current !== null) { v.pause(); loadedClipRef.current = null; setVideoVisible(false); }
      return;
    }
    if (loadedClipRef.current === clip.id) {
      if (v.readyState >= 2) setVideoVisible(true);
      if (isPlayingRef.current && v.paused) v.play().catch(() => {});
      return;
    }
    const { id: clipId, url: clipUrl, startTime: clipStart, mediaOffset: clipOffset = 0, duration: clipDur } = clip;
    loadedClipRef.current = clipId;
    setVideoVisible(false);
    const onMeta = () => {
      v.removeEventListener("loadedmetadata", onMeta);
      if (loadedClipRef.current !== clipId) return;
      const seekTarget = Math.max(0, (phRef.current - clipStart + clipOffset) / 1_000_000);
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        if (loadedClipRef.current !== clipId) return;
        v.muted = globalMuted;
        setMediaError(false);
        const mediaEndSec = (clipOffset + clipDur) / 1_000_000;
        const reveal = () => {
          setVideoVisible(true);
          if (isPlayingRef.current) v.play().catch(() => {});
          const guard = () => {
            if (loadedClipRef.current !== clipId) { v.removeEventListener("timeupdate", guard); return; }
            if (v.currentTime >= mediaEndSec) {
              v.removeEventListener("timeupdate", guard);
              phRef.current = clipStart + clipDur; loadedClipRef.current = null; v.pause();
            }
          };
          v.addEventListener("timeupdate", guard);
        };
        if (v.readyState >= 2) reveal();
        else { const onCp = () => { v.removeEventListener("canplay", onCp); if (loadedClipRef.current === clipId) reveal(); }; v.addEventListener("canplay", onCp); }
      };
      v.addEventListener("seeked", onSeeked);
      v.currentTime = seekTarget;
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.src = clipUrl; v.load();
  }, [globalMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  const tick = useCallback((ts: number) => {
    if (lastTsRef.current > 0) {
      const dur = totalDurRef.current;
      if (dur > 0) {
        phRef.current = (phRef.current + Math.min(ts - lastTsRef.current, 100) * 1000) % dur;
        setProgress(phRef.current / dur);
        syncClip(phRef.current);
        const v = videoRef.current;
        if (v) {
          const ph = phRef.current;
          const efx = effectClipsRef.current.find((c) => (c.renderedCss || !c.fxParams?.effectDisabled) && ph >= c.startTime && ph < c.startTime + c.duration);
          if (!efx) {
            v.style.filter = ""; v.style.transform = "";
            if (activeAnimRef.current !== null) { v.style.animation = ""; activeAnimRef.current = null; }
          } else if (efx.renderedCss && !efx.fxParams) {
            v.style.filter = efx.renderedCss.filter; v.style.transform = efx.renderedCss.transform;
            if (activeAnimRef.current !== efx.id) { v.style.animation = efx.renderedCss.animation ?? ""; activeAnimRef.current = efx.id; }
          } else {
            const efxP = efx.fxParams ?? {};
            if (String(efxP.effectType) === "hypno-tunnel") {
              const intensity = Number(efxP.intensity ?? 50) / 100;
              const phase = (ts % 2000) / 2000;
              v.style.filter = `hue-rotate(${Math.round(phase * 360)}deg) saturate(${(1 + intensity * 3).toFixed(2)}) contrast(${(1 + intensity * 1.5).toFixed(2)})`;
              v.style.transform = `scale(${(1 + intensity * 0.2 + Math.sin(phase * Math.PI * 2) * intensity * 0.05).toFixed(3)}) rotate(${((phase * 2 - 1) * intensity * 8).toFixed(1)}deg)`;
            } else {
              v.style.filter = clipCssFilter(efxP); v.style.transform = clipCssTransform(efxP);
            }
          }
        }
      }
    }
    lastTsRef.current = ts;
    rafRef.current = requestAnimationFrame(tick);
  }, [syncClip]);

  useEffect(() => {
    if (!isPlaying || snapshotClips.length === 0) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (!isPlaying) videoRef.current?.pause();
      return;
    }
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  }, [isPlaying, snapshotClips.length, tick]);

  // Boot: load first clip or simple videoUrl
  useEffect(() => {
    if (isPlayingRef.current) return;
    if (!isHydrated && !!post.projectSnapshot?.mediaPool?.length) return;
    phRef.current = 0; setProgress(0); setIsPlaying(false); setMediaError(false);
    loadedClipRef.current = null; lastTsRef.current = 0;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const clips = clipsRef.current;
    const v = videoRef.current;
    if (clips.length > 0 && v) {
      const clip = clips[0];
      loadedClipRef.current = clip.id; v.muted = true;
      const onMeta = () => {
        v.removeEventListener("loadedmetadata", onMeta);
        if (loadedClipRef.current !== clip.id) return;
        v.currentTime = (clip.mediaOffset ?? 0) / 1_000_000;
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          if (loadedClipRef.current !== clip.id) return;
          const reveal = () => {
            setVideoVisible(true); v.play().then(() => setIsPlaying(true)).catch(() => {});
            const endSec = ((clip.mediaOffset ?? 0) + clip.duration) / 1_000_000;
            v.addEventListener("timeupdate", function g() {
              if (v.currentTime >= endSec) { v.removeEventListener("timeupdate", g); phRef.current = clip.startTime + clip.duration; loadedClipRef.current = null; v.pause(); }
            });
          };
          if (v.readyState >= 2) reveal();
          else { const onCp = () => { v.removeEventListener("canplay", onCp); if (loadedClipRef.current === clip.id) reveal(); }; v.addEventListener("canplay", onCp); }
        };
        v.addEventListener("seeked", onSeeked);
      };
      v.addEventListener("loadedmetadata", onMeta); v.src = clip.url; v.load();
    } else if (post.videoUrl && v) {
      v.src = post.videoUrl; setVideoVisible(true);
      v.play().then(() => setIsPlaying(true)).catch(() => {});
    } else { setVideoVisible(false); if (v) { v.pause(); v.src = ""; } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, hydratedPool, isHydrated]);

  useEffect(() => {
    if (snapshotClips.length > 0) return;
    const v = videoRef.current; if (!v) return;
    const onTime = () => { if (v.duration) setProgress(v.currentTime / v.duration); };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [snapshotClips.length]);

  const togglePlay = useCallback(() => {
    if (clipsRef.current.length === 0) {
      const v = videoRef.current; if (!v) return;
      if (isPlayingRef.current) { v.pause(); setIsPlaying(false); }
      else { v.play().then(() => setIsPlaying(true)).catch(() => {}); }
    } else { setIsPlaying((p) => !p); }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setProgress(ratio);
    if (clipsRef.current.length > 0) {
      phRef.current = ratio * totalDurRef.current;
      loadedClipRef.current = null;
      syncClip(phRef.current);
    } else {
      const v = videoRef.current; if (v?.duration) v.currentTime = ratio * v.duration;
    }
  }, [syncClip]);

  const isBlobPost = post.videoUrl?.startsWith("blob:");
  const remixAllowed = post.allowRemix !== false;

  return (
    <div ref={cellRef} className="relative flex h-screen w-full snap-start items-center justify-center bg-black">
      <div className="group relative h-full w-full overflow-hidden" style={{ background: post.bg }}>

        {hydratedPool === null && !!post.projectSnapshot?.mediaPool?.length && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
            <p className="text-[10px] text-white/50">Loading media…</p>
          </div>
        )}
        {!videoVisible && !mediaError && <div className="absolute inset-0 bg-black" />}

        {/* Waveform BG on error */}
        <div className={`absolute inset-0 flex items-end gap-[3px] px-3 pb-28 transition-opacity duration-300 ${mediaError ? "opacity-20" : "opacity-0"}`} aria-hidden>
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} className="flex-1 animate-pulse rounded-t-[2px]"
              style={{ background: post.accent, height: `${18 + Math.sin(i * 0.7) * 40 + (i % 4) * 9}%`, animationDelay: `${(i * 55) % 900}ms` }} />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/60" />

        {mediaError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
            <WifiOff size={32} className="text-white/30" />
            <p className="text-xs font-semibold text-white/40">Media Offline</p>
          </div>
        )}

        <video ref={videoRef} muted loop={snapshotClips.length === 0} playsInline
          onError={() => setMediaError(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${videoVisible && !mediaError ? "opacity-100" : "opacity-0"}`}
        />

        {/* Text overlays */}
        {textClipsRef.current.filter((c) => phRef.current >= c.startTime && phRef.current < c.startTime + c.duration).map((c) => {
          const r = buildTextStyle(c, phRef.current);
          return r ? <div key={c.id} className="pointer-events-none absolute inset-0 z-[8]"><span style={r.style}>{r.displayText}</span></div> : null;
        })}

        <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: "35%", background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }} />

        {/* Play/Pause tap zone */}
        <button onClick={togglePlay} className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/45 backdrop-blur-sm">
            {isPlaying ? <Pause size={24} className="text-white" fill="white" /> : <Play size={24} className="ml-1 text-white" fill="white" />}
          </div>
        </button>

        {/* Badges top-left */}
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          {post.featured && <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-bold uppercase text-black">Hot</span>}
          {post.duration !== "—" && <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">{post.duration}</span>}
          {isBlobPost && <span className="rounded-full bg-orange-500/70 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">Local</span>}
          {post.remixedFromHandle && (
            <div className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 backdrop-blur-sm">
              <GitBranch size={8} className="shrink-0 text-purple-400" />
              <span className="text-[9px] font-semibold text-purple-300">Remix of @{post.remixedFromHandle}</span>
            </div>
          )}
        </div>

        {/* Mute toggle */}
        <button onClick={onToggleMute} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/15">
          {globalMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>

        {/* Info overlay */}
        <div className="absolute bottom-8 left-4 right-20 pr-2">
          <button onClick={onCreator} className="mb-2 flex items-center gap-2.5 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white/25" style={{ background: `hsl(${post.user.hue} 55% 28%)` }}>{post.user.initial}</div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white" style={TX}>@{post.user.handle}</span>
              <span className="flex items-center gap-0.5 rounded-full border border-white/25 bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold text-white/80 backdrop-blur-sm"><Users size={8} />Follow</span>
            </div>
          </button>
          <h2 className="mb-1.5 line-clamp-2 text-xl font-bold leading-snug text-white" style={TX}>{post.title}</h2>
          {post.description && <p className="mb-2 line-clamp-2 text-base leading-relaxed text-white/90" style={TX}>{post.description}</p>}
          <div className="flex flex-wrap gap-1.5">
            {post.tags.map((t) => <span key={t} className="rounded-full bg-black/50 px-2 py-0.5 text-base font-medium text-white/85 backdrop-blur-sm" style={TX}>{t}</span>)}
          </div>
        </div>

        {/* Action column */}
        <div className="absolute bottom-6 right-3 flex flex-col items-center gap-4">
          <button onClick={() => setLiked((v) => !v)} className="flex flex-col items-center gap-1">
            <div className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm transition-all ${liked ? "border-red-500/40 bg-red-500/30" : "border-white/15 bg-black/40 hover:bg-white/12"}`}>
              <Heart size={20} className={liked ? "fill-red-400 text-red-400" : "text-white"} />
            </div>
            <span className="text-[9px] font-semibold text-white" style={TX}>{fmtK(post.likes + (liked ? 1 : 0))}</span>
          </button>
          <button className="flex flex-col items-center gap-1">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm hover:bg-white/12"><MessageCircle size={20} className="text-white" /></div>
            <span className="text-[9px] font-semibold text-white" style={TX}>{fmtK(post.comments)}</span>
          </button>
          <button className="flex flex-col items-center gap-1">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm hover:bg-white/12"><Share2 size={20} className="text-white" /></div>
            <span className="text-[9px] font-semibold text-white" style={TX}>Share</span>
          </button>
          <button onClick={onRemix} className="flex flex-col items-center gap-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm hover:bg-white/15">
              <Pencil size={15} className="text-white/80" />
            </div>
            <span className="text-[9px] font-semibold text-white/70" style={TX}>Edit</span>
          </button>
          <button onClick={remixAllowed ? onRemix : undefined} className={`flex flex-col items-center gap-1 ${remixAllowed ? "" : "opacity-35 cursor-not-allowed"}`}>
            <div className="flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95"
              style={remixAllowed ? { background: post.accent, boxShadow: `0 0 28px ${post.accent}99` } : { background: "#333" }}>
              <Zap size={26} className="text-white" fill="white" />
            </div>
            <span className="text-[9px] font-bold text-white" style={TX}>{remixAllowed ? "Remix" : "No Remix"}</span>
          </button>
        </div>

        {/* Scrubber */}
        <div onClick={handleSeek} className="absolute bottom-0 left-0 right-0 h-2 cursor-pointer bg-white/15 hover:h-3 transition-all">
          <div className="h-full rounded-r-full transition-none" style={{ width: `${progress * 100}%`, background: post.accent }} />
        </div>
      </div>
    </div>
  );
}

// ── TheaterMode ────────────────────────────────────────────────────────────────
interface TheaterModeProps {
  post: FeedPost;
  onClose: () => void;
  onRemix: () => void;
  onCreator: () => void;
  allPosts?: FeedPost[];
  onNavigate?: (post: FeedPost) => void;
}

export function TheaterMode({ post, onClose, onRemix, onCreator, allPosts = [] }: TheaterModeProps) {
  const [queue, setQueue]       = useState<FeedPost[]>(() => buildQueue(post, allPosts));
  const [muted, setMuted]       = useState(true);
  const scrollRef               = useRef<HTMLDivElement>(null);
  const cellRefs                = useRef<Map<string, HTMLDivElement>>(new Map());
  const observerRef             = useRef<IntersectionObserver | null>(null);
  const activeVideoRef          = useRef<HTMLVideoElement | null>(null);

  // Rebuild queue when seed post changes
  useEffect(() => { setQueue(buildQueue(post, allPosts)); }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

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
          const video = entry.target.querySelector("video") as HTMLVideoElement | null;
          if (!video) continue;
          if (entry.isIntersecting) {
            activeVideoRef.current = video;
            video.play().catch(() => {});
          } else {
            video.pause();
            video.currentTime = 0;
          }
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
  }, [allPosts]);

  const setCellRef = useCallback((postId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      cellRefs.current.set(postId, el);
      observerRef.current?.observe(el);
    } else {
      cellRefs.current.delete(postId);
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Close */}
      <button
        onClick={onClose}
        className="fixed right-4 top-4 z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/15 hover:text-white"
      >
        <X size={15} />
      </button>

      {/* Vertical snap-scroll feed */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-screen overflow-y-scroll snap-y snap-mandatory"
        style={{ scrollbarWidth: "none" }}
      >
        {queue.map((p) => (
          <TheaterCell
            key={p.id}
            post={p}
            cellRef={setCellRef(p.id)}
            onRemix={onRemix}
            onCreator={onCreator}
            globalMuted={muted}
            onToggleMute={() => setMuted((v) => !v)}
          />
        ))}
      </div>
    </div>
  );
}
