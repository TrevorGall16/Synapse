"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { X, Zap, Heart, Share2, Play, Pause, MessageCircle, Users, Volume2, VolumeX, GitBranch, WifiOff, Pencil } from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";
import type { ClipEvent, MediaPoolItem } from "@/lib/store/types";
import { hydrateMediaPool } from "@/lib/store/media-pool-db";
import { useHydrationStore } from "@/lib/store/hydration-store";

interface TheaterModeProps {
  post: FeedPost; onClose: () => void; onRemix: () => void; onCreator: () => void;
  allPosts?: FeedPost[]; onNavigate?: (post: FeedPost) => void;
}

function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
const TX: React.CSSProperties = { textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,1)", WebkitTextStroke: "0.5px rgba(0,0,0,0.7)" };

function MiniCard({ post, onNavigate }: { post: FeedPost; onNavigate: () => void }) {
  return (
    <article className="cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-all hover:border-white/20 hover:-translate-y-0.5" onClick={onNavigate}>
      <div className="relative" style={{ aspectRatio: "9/16", background: post.bg }}>
        <div className="absolute inset-0 flex items-end gap-[2px] px-1.5 pb-14 opacity-15" aria-hidden>
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="flex-1 rounded-t-[2px]" style={{ background: post.accent, height: `${18 + Math.sin(i * 0.75) * 38 + (i % 5) * 8}%` }} />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80" />
        <div className="absolute inset-x-0 bottom-0 p-2">
          <p className="line-clamp-2 text-[9px] font-bold leading-snug text-white" style={TX}>{post.title}</p>
          <p className="mt-0.5 text-[8px] text-white/50">@{post.user.handle}</p>
        </div>
      </div>
    </article>
  );
}

export function TheaterMode({ post, onClose, onRemix, onCreator, allPosts = [], onNavigate }: TheaterModeProps) {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef       = useRef<number | null>(null);
  const phRef        = useRef(0);       // playhead µs — source of truth for multi-clip
  const lastTsRef    = useRef(0);
  const loadedClipRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const clipsRef     = useRef<Array<ClipEvent & { url: string }>>([]);
  const totalDurRef  = useRef(30_000_000);
  const mutedRef     = useRef(true);

  const [progress, setProgress]       = useState(0);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [muted, setMuted]             = useState(true);
  const [liked, setLiked]             = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);
  const [mediaError, setMediaError]   = useState(false);
  const [hydratedPool, setHydratedPool] = useState<MediaPoolItem[] | null>(null);
  const [recoverHint, setRecoverHint]   = useState(false);
  const isHydrated = useHydrationStore((s) => s.isHydrated);

  const poolKey = post.id + "|" + (post.projectSnapshot?.mediaPool?.map((m) => m.previewUrl).join(",") ?? "");
  useEffect(() => {
    setHydratedPool(null);
    const pool = post.projectSnapshot?.mediaPool;
    if (!pool?.length) return;
    hydrateMediaPool(pool).then(setHydratedPool).catch(() => setHydratedPool(pool));
  }, [poolKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show recovery hint after 2s of black screen on a snapshot post
  useEffect(() => {
    if (videoVisible || !post.projectSnapshot?.mediaPool?.length) { setRecoverHint(false); return; }
    const t = setTimeout(() => setRecoverHint(true), 2000);
    return () => clearTimeout(t);
  }, [videoVisible, post.projectSnapshot?.mediaPool?.length]);

  const snapshotClips = useMemo(() => {
    const snap = post.projectSnapshot;
    if (!snap) return [];
    const pool = (hydratedPool ?? snap.mediaPool) ?? [];
    return snap.tracks
      .filter((t) => t.type === "video").flatMap((t) => t.clips)
      .sort((a, b) => a.startTime - b.startTime)
      .map((c) => ({ ...c, url: pool.find((m) => m.id === c.sourceId)?.previewUrl }))
      .filter((c): c is ClipEvent & { url: string } => !!c.url);
  }, [post.projectSnapshot, hydratedPool]);

  const totalDuration = snapshotClips.length > 0 ? (post.projectSnapshot?.duration ?? 30_000_000) : 30_000_000;
  const firstClipUrl = snapshotClips[0]?.url ?? "";

  // Explicit src-watch: call load() when blob URL is swapped (browser won't auto-reload)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !firstClipUrl || isPlayingRef.current) return;
    if (v.src === firstClipUrl) return;
    v.src = firstClipUrl;
    v.load();
  }, [firstClipUrl]);

  useEffect(() => { clipsRef.current = snapshotClips; }, [snapshotClips]);
  useEffect(() => { totalDurRef.current = totalDuration; }, [totalDuration]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => {
    mutedRef.current = muted;
    const v = videoRef.current; if (v) { v.muted = muted; v.volume = muted ? 0 : 1; }
  }, [muted]);

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
    const clipId     = clip.id;
    const clipUrl    = clip.url;
    const clipStart  = clip.startTime;
    const clipOffset = clip.mediaOffset ?? 0;

    loadedClipRef.current = clip.id; // mark immediately so rAF returns early on re-entry
    setVideoVisible(false);           // hide until seeked + ready

    const onMeta = () => {
      v.removeEventListener("loadedmetadata", onMeta);
      // Abort if we've already moved to a different clip or gap
      if (loadedClipRef.current !== clipId) return;

      // Correct seek math: (playhead - clip.startTime + clip.mediaOffset) / 1_000_000
      // phRef.current is re-read here because it may have advanced during async load
      const seekTarget = Math.max(
        0,
        (phRef.current - clipStart + clipOffset) / 1_000_000,
      );

      // Gate play() on the "seeked" event so it fires only after currentTime is committed,
      // preventing a flash of the wrong frame at clip start
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        if (loadedClipRef.current !== clipId) return;
        v.muted = mutedRef.current;
        setMediaError(false);
        const reveal = () => { setVideoVisible(true); if (isPlayingRef.current) v.play().catch(() => {}); };
        if (v.readyState >= 2) { reveal(); }
        else { const onCp = () => { v.removeEventListener("canplay", onCp); if (loadedClipRef.current === clipId) reveal(); }; v.addEventListener("canplay", onCp); }
      };

      v.addEventListener("seeked", onSeeked);
      v.currentTime = seekTarget;
    };

    v.addEventListener("loadedmetadata", onMeta);
    v.src = clipUrl;
    v.load();
  }, []);

  // rAF tick — master timeline clock for multi-clip mode
  // ts is DOMHighResTimeStamp in ms; ×1000 converts to µs (clip units)
  const tick = useCallback((ts: number) => {
    if (lastTsRef.current > 0) {
      const dur = totalDurRef.current;
      if (dur > 0) {
        const delta = Math.min(ts - lastTsRef.current, 100); // clamp ≤100ms — prevents huge jump on resume/tab-switch
        phRef.current = (phRef.current + delta * 1000) % dur;
        setProgress(phRef.current / dur);
        syncClip(phRef.current);
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
  useEffect(() => {
    if (isPlayingRef.current) return; // already playing with valid URLs — hydration arrived late, skip
    if (!isHydrated && !!post.projectSnapshot?.mediaPool?.length) return; // wait for IDB recovery
    containerRef.current?.scrollTo({ top: 0, behavior: "instant" });
    phRef.current = 0; setProgress(0); setIsPlaying(false); setMediaError(false);
    loadedClipRef.current = null; lastTsRef.current = 0;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const clips = clipsRef.current;
    const v = videoRef.current;
    if (clips.length > 0 && v) {
      const clip = clips[0];
      loadedClipRef.current = clip.id;
      v.muted = true;
      const onMeta = () => {
        v.removeEventListener("loadedmetadata", onMeta);
        if (loadedClipRef.current !== clip.id) return;
        v.currentTime = (clip.mediaOffset ?? 0) / 1_000_000;
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          if (loadedClipRef.current !== clip.id) return;
          const reveal = () => { setVideoVisible(true); v.play().then(() => setIsPlaying(true)).catch(() => {}); };
          if (v.readyState >= 2) { reveal(); }
          else { const onCp = () => { v.removeEventListener("canplay", onCp); if (loadedClipRef.current === clip.id) reveal(); }; v.addEventListener("canplay", onCp); }
        };
        v.addEventListener("seeked", onSeeked);
      };
      v.addEventListener("loadedmetadata", onMeta);
      v.src = clip.url;
      v.load();
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
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

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
      loadedClipRef.current = null; // force clip re-sync
      syncClip(phRef.current);
    } else {
      const v = videoRef.current; if (v && v.duration) v.currentTime = ratio * v.duration;
    }
  }, [syncClip]);

  const isBlobPost = post.videoUrl?.startsWith("blob:");
  const remixAllowed = post.allowRemix !== false;
  const similarPosts = allPosts.filter((p) => p.id !== post.id && p.tags.some((t) => post.tags.includes(t))).slice(0, 12);

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 overflow-y-auto bg-black">
      <button onClick={onClose} className="fixed right-4 top-4 z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/15 hover:text-white">
        <X size={15} />
      </button>

      <section className="relative flex min-h-screen items-center justify-center px-4 py-4">
        <div className="group relative overflow-hidden rounded-2xl shadow-2xl" style={{ aspectRatio: "9/16", height: "calc(100vh - 32px)", background: post.bg }}>

          {hydratedPool === null && !!post.projectSnapshot?.mediaPool?.length && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 backdrop-blur-sm">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white/50" /><p className="text-[10px] font-semibold text-white/50">Loading media…</p>
            </div>
          )}
          {!videoVisible && !mediaError && <div className="absolute inset-0 bg-[#000000]" />}
          {recoverHint && <p className="absolute bottom-20 left-3 z-30 text-[9px] text-white/30">Attempting to recover IDB…</p>}

          {/* Waveform BG — only shown on media error, not in normal gaps */}
          <div className={`absolute inset-0 flex items-end gap-[3px] px-3 pb-28 transition-opacity duration-300 ${mediaError ? "opacity-20" : "opacity-0"}`} aria-hidden>
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="flex-1 animate-pulse rounded-t-[2px]"
                style={{ background: post.accent, height: `${18 + Math.sin(i * 0.7) * 40 + (i % 4) * 9}%`, animationDelay: `${(i * 55) % 900}ms` }} />
            ))}
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/60" />

          {/* Media Offline overlay */}
          {mediaError && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
              <WifiOff size={32} className="text-white/30" />
              <p className="text-center text-xs font-semibold text-white/40">Media Offline</p>
              <p className="text-center text-[10px] text-white/25">Refresh deleted temp data</p>
            </div>
          )}

          {/* Video */}
          <video ref={videoRef} muted loop={snapshotClips.length === 0} playsInline
            onError={() => setMediaError(true)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${videoVisible && !mediaError ? "opacity-100" : "opacity-0"}`}
          />

          {/* Bottom scrim */}
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: "35%", background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }} />

          {/* Play/pause tap zone */}
          <button onClick={togglePlay} className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/45 backdrop-blur-sm">
              {isPlaying ? <Pause size={24} className="text-white" fill="white" /> : <Play size={24} className="ml-1 text-white" fill="white" />}
            </div>
          </button>

          {/* Badges top-left */}
          <div className="absolute left-3 top-3 flex items-center gap-1.5">
            {post.featured && <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-bold uppercase text-black">Hot</span>}
            {post.duration !== "—" && <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">{post.duration}</span>}
            {isBlobPost && <span className="rounded-full bg-orange-500/70 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">Local Session</span>}
            {post.remixedFromHandle && (
              <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-semibold text-purple-300 backdrop-blur-sm">
                <GitBranch size={8} />Remixed from @{post.remixedFromHandle}
              </span>
            )}
          </div>

          {/* Mute toggle */}
          {(post.videoUrl || snapshotClips.length > 0) && (
            <button onClick={() => setMuted((v) => !v)} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur-sm transition-colors hover:bg-white/15">
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          )}

          {/* Info overlay — bottom-left */}
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

          {/* Action column — bottom-right */}
          <div className="absolute bottom-6 right-3 flex flex-col items-center gap-4">
            <button onClick={() => setLiked((v) => !v)} className="flex flex-col items-center gap-1">
              <div className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm transition-all ${liked ? "border-red-500/40 bg-red-500/30" : "border-white/15 bg-black/40 hover:bg-white/12"}`}>
                <Heart size={20} className={liked ? "fill-red-400 text-red-400" : "text-white"} />
              </div>
              <span className="text-[9px] font-semibold text-white" style={TX}>{fmtK(post.likes + (liked ? 1 : 0))}</span>
            </button>
            <button className="flex flex-col items-center gap-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm transition-colors hover:bg-white/12"><MessageCircle size={20} className="text-white" /></div>
              <span className="text-[9px] font-semibold text-white" style={TX}>{fmtK(post.comments)}</span>
            </button>
            <button className="flex flex-col items-center gap-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm transition-colors hover:bg-white/12"><Share2 size={20} className="text-white" /></div>
              <span className="text-[9px] font-semibold text-white" style={TX}>Share</span>
            </button>
            <button onClick={onRemix} className="flex flex-col items-center gap-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm transition-colors hover:bg-white/15">
                <Pencil size={15} className="text-white/80" />
              </div>
              <span className="text-[9px] font-semibold text-white/70" style={TX}>Edit</span>
            </button>
            <button onClick={remixAllowed ? onRemix : undefined} className={`flex flex-col items-center gap-1 ${remixAllowed ? "" : "opacity-35 cursor-not-allowed"}`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95"
                style={remixAllowed ? { background: post.accent, boxShadow: `0 0 28px ${post.accent}99, 0 0 10px ${post.accent}55` } : { background: "#333" }}>
                <Zap size={26} className="text-white" fill="white" />
              </div>
              <span className="text-[9px] font-bold text-white" style={TX}>{remixAllowed ? "Remix" : "No Remix"}</span>
            </button>
          </div>

          {/* Scrubber — spans full project duration including gaps */}
          <div onClick={handleSeek} className="absolute bottom-0 left-0 right-0 h-2 cursor-pointer bg-white/15 transition-all hover:h-3" title="Seek">
            <div className="h-full rounded-r-full transition-none" style={{ width: `${progress * 100}%`, background: post.accent }} />
          </div>
        </div>
      </section>

      {similarPosts.length > 0 && (
        <section className="bg-[#0f0f0f] px-5 pb-12 pt-6">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/30">Similar Content</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {similarPosts.map((p) => <MiniCard key={p.id} post={p} onNavigate={() => onNavigate?.(p)} />)}
          </div>
        </section>
      )}
    </div>
  );
}
