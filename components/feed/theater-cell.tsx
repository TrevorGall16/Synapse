"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { Zap, Heart, Share2, Play, Pause, MessageCircle, Users, GitBranch, WifiOff, Pencil } from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";
import type { ClipEvent, MediaPoolItem } from "@/lib/store/types";
import { hydrateMediaPool } from "@/lib/store/media-pool-db";
import { useHydrationStore } from "@/lib/store/hydration-store";
import { useUserStore } from "@/lib/store/user-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { followCreator, unfollowCreator, isFollowing } from "@/lib/store/social-idb";
import { clipCssFilter, clipCssTransform, clipCssAnimation } from "@/lib/utils/svg-filters";
import { buildTextStyle } from "@/lib/utils/preview-helpers";
import { parseHashtags } from "@/lib/utils/hashtags";
import { canRemix } from "@/lib/policy";
import { consumeTheaterGesture, markInteracted } from "./theater-gesture";

// ── Shared render helpers ──────────────────────────────────────────────────────
export function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
export const TX: React.CSSProperties = { textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,1)", WebkitTextStroke: "0.5px rgba(0,0,0,0.7)" };

// ── TheaterCell ────────────────────────────────────────────────────────────────
export interface CellProps {
  post: FeedPost;
  cellRef: (el: HTMLDivElement | null) => void;
  onRemix: (post: FeedPost) => void;
  onCreator: () => void;
  onHashtagClick: (tag: string) => void;
  globalMuted: boolean;
  isActive: boolean;
}

export function TheaterCell({ post, cellRef, onRemix, onCreator, onHashtagClick, globalMuted, isActive }: CellProps) {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const mountedRef     = useRef(true);
  const rafRef         = useRef<number | null>(null);
  const phRef          = useRef(post.demoStartTime || 0);
  const lastTsRef      = useRef(0);
  const loadedClipRef    = useRef<string | null>(null);
  const loadedClipUrlRef = useRef<string | null>(null); // URL currently loaded in <video>
  const isPlayingRef   = useRef(false);
  const clipsRef       = useRef<Array<ClipEvent & { url: string }>>([]);
  const totalDurRef    = useRef(30_000_000);
  const effectClipsRef = useRef<ClipEvent[]>([]);
  const textClipsRef   = useRef<ClipEvent[]>([]);
  const activeAnimRef  = useRef<string | null>(null);
  /** Set to true by the gesture useLayoutEffect so the boot useEffect skips its reset */
  const gesturePlayedRef = useRef(false);
  const animationRef   = useRef<number | null>(null);
  const idleTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [progress, setProgress]           = useState(0);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [videoVisible, setVideoVisible]   = useState(false);
  const [mediaError, setMediaError]       = useState(false);
  const [following, setFollowing]         = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);
  const [showUnmuteToast, setShowUnmuteToast] = useState(false);
  const [isIdle, setIsIdle]                   = useState(false);
  const [hydratedPool, setHydratedPool]   = useState<MediaPoolItem[] | null>(null);
  const isHydrated   = useHydrationStore((s) => s.isHydrated);
  const currentUsername = useUserStore((s) => s.profile?.username);
  const likedPostIds = useFeedStore((s) => s.likedPostIds);
  const toggleLike   = useFeedStore((s) => s.toggleLike);
  const liked = likedPostIds.includes(post.id);
  const isOwn = !!currentUsername && currentUsername === post.authorUsername;

  // Track mount state to guard async callbacks
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Load follow state from IDB on mount
  useEffect(() => {
    isFollowing(post.user.handle).then(setFollowing).catch(() => {});
  }, [post.user.handle]);

  const handleFollowToggle = useCallback(async () => {
    const next = !following;
    setFollowing(next);
    try {
      if (next) await followCreator(post.user.handle);
      else await unfollowCreator(post.user.handle);
    } catch { setFollowing(!next); } // revert on error
  }, [following, post.user.handle]);

  // Idle timer: 2 s of no mouse movement while playing → ghost UI (cursor, scrubber, center icon)
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    setIsIdle(false);
    if (isPlayingRef.current)
      idleTimerRef.current = setTimeout(() => { if (mountedRef.current) setIsIdle(true); }, 2000);
  }, []); // reads only stable refs

  const handleMouseMove = useCallback(() => { if (isPlayingRef.current) resetIdleTimer(); }, [resetIdleTimer]);

  // Key on post.id only — previewUrls must not be part of the key or hydrateMediaPool
  // will be called again after the store updates with the newly-created blob URLs,
  // which triggers another hydrateMediaPool call, creating yet more blob URLs (infinite loop).
  useEffect(() => {
    setHydratedPool(null);
    const pool = post.projectSnapshot?.mediaPool;
    if (!pool?.length) return;
    hydrateMediaPool(pool).then(setHydratedPool).catch(() => setHydratedPool(pool));
  }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const hasMasterClock = !!post.demoDuration;
    const clip = clips.find((c) => ph >= c.startTime && ph < c.startTime + c.duration) ?? null;
    if (!clip) {
      // When demoDuration controls the loop, don't pause/unload — the playhead may
      // be between clip boundaries but still within the valid selection window.
      if (!hasMasterClock && loadedClipRef.current !== null) {
        v.pause(); loadedClipRef.current = null; loadedClipUrlRef.current = null; setVideoVisible(false);
      }
      return;
    }
    // If the same source URL is already loaded, just keep playing — don't reload.
    // This lets the playhead cross clip boundaries without interrupting playback
    // when the underlying video file is the same (common in single-video recipes).
    if (loadedClipRef.current === clip.id || loadedClipUrlRef.current === clip.url) {
      if (v.readyState >= 2) setVideoVisible(true);
      if (isPlayingRef.current && v.paused) v.play().catch(() => {});
      if (loadedClipRef.current !== clip.id) loadedClipRef.current = clip.id;
      return;
    }
    const { id: clipId, url: clipUrl, startTime: clipStart, mediaOffset: clipOffset = 0, duration: clipDur } = clip;
    loadedClipRef.current = clipId; loadedClipUrlRef.current = clipUrl;
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
          if (!mountedRef.current) return;
          setVideoVisible(true);
          if (isPlayingRef.current) v.play().catch(() => {});
          // timeupdate guard only for multi-clip sequencing without master clock
          if (!hasMasterClock) {
            const guard = () => {
              if (loadedClipRef.current !== clipId) { v.removeEventListener("timeupdate", guard); return; }
              if (v.currentTime >= mediaEndSec) {
                v.removeEventListener("timeupdate", guard);
                phRef.current = clipStart + clipDur; loadedClipRef.current = null; loadedClipUrlRef.current = null; v.pause();
              }
            };
            v.addEventListener("timeupdate", guard);
          }
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
      // Guard: never wrap at less than 2 seconds — prevents ghost loops from empty-timeline publishes
      const dur = Math.max(totalDurRef.current, 2_000_000);
      if (dur > 0) {
        const v = videoRef.current;
        // ── Unified Master Clock ──────────────────────────────────────
        // For snapshot posts: derive playhead from video.currentTime (single source of truth)
        // demoStartTime/demoDuration are MICROSECONDS, video.currentTime is SECONDS
        const startUs = post.demoStartTime || 0;
        const demoDurUs = post.demoDuration || 1_000_000;
        const endUs = startUs + demoDurUs;
        if (post.projectSnapshot && v) {
          const playheadUs = Math.round(v.currentTime * 1_000_000);
          // Strict selection clamping: force video back if outside ruler range
          if (playheadUs < startUs || playheadUs >= endUs - 50_000) {
            console.warn("!!! LOOP TRIGGERED !!!", { playheadUs, startUs, endUs, vidTime: v.currentTime });
            v.currentTime = startUs / 1_000_000;
          }
          // Derive phRef from video time so text/FX/syncClip all agree
          phRef.current = Math.round(v.currentTime * 1_000_000);
          // Progress re-based to selection (0-100%)
          const relativeUs = phRef.current - startUs;
          setProgress(Math.max(0, Math.min(100, (relativeUs / demoDurUs) * 100)));
        } else {
          // Non-snapshot: advance phRef from rAF delta as before
          phRef.current = (phRef.current + Math.min(ts - lastTsRef.current, 100) * 1000) % dur;
          if (v && v.duration > 0 && isFinite(v.duration)) {
            setProgress((v.currentTime / v.duration) * 100);
          } else {
            setProgress((phRef.current / dur) * 100);
          }
        }
        syncClip(phRef.current);
        // ── Effect clips: use unified playheadUs ──────────────────────
        let activeEfxId: string | null = null;
        if (v) {
          const ph = phRef.current;
          const efx = effectClipsRef.current.find((c) => (c.renderedCss || !c.fxParams?.effectDisabled) && ph >= c.startTime && ph < c.startTime + c.duration);
          activeEfxId = efx?.id ?? null;
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
              const anim = clipCssAnimation(efxP);
              if (activeAnimRef.current !== efx.id) { v.style.animation = anim; activeAnimRef.current = efx.id; }
            }
          }
          void activeEfxId; // used above for tracking
        }
      }
    }
    lastTsRef.current = ts;
    rafRef.current = requestAnimationFrame(tick);
  }, [syncClip]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      videoRef.current?.pause();
      return;
    }
    if (snapshotClips.length > 0) {
      // Snapshot posts: existing rAF tick handles clip sync + FX
      lastTsRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    } else {
      // Simple-video posts: drive progress bar from native currentTime/duration
      const updateProgress = () => {
        if (!videoRef.current) return;
        const { currentTime, duration } = videoRef.current;
        if (duration > 0 && isFinite(duration) && !isNaN(duration)) {
          setProgress((currentTime / duration) * 100);
        }
        animationRef.current = requestAnimationFrame(updateProgress);
      };
      animationRef.current = requestAnimationFrame(updateProgress);
    }
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
    };
  }, [isPlaying, snapshotClips.length, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boot: load first clip or simple videoUrl
  useEffect(() => {
    if (isPlayingRef.current) return;
    if (!isHydrated && !!post.projectSnapshot?.mediaPool?.length) return;
    const clips = clipsRef.current;
    const v = videoRef.current;
    // Guard: skip if the SAME clip with the SAME URL is already loading.
    // Allow reload when the URL changed (dead blob replaced by a fresh one after hydration).
    if (clips.length > 0 && loadedClipRef.current !== null) {
      const alreadyLoading = clips.find((c) => c.id === loadedClipRef.current);
      if (alreadyLoading && alreadyLoading.url === loadedClipUrlRef.current) return;
    }
    // If the gesture useLayoutEffect already kicked off playback (snapshot posts), skip the reset
    // so we don't cancel the rAF tick that was just started within the user-gesture trust window.
    if (gesturePlayedRef.current) { gesturePlayedRef.current = false; return; }
    const initPh = post.demoStartTime || 0;
    phRef.current = initPh; setProgress(0); setIsPlaying(false); setMediaError(false);
    loadedClipRef.current = null; loadedClipUrlRef.current = null; lastTsRef.current = 0;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (clips.length > 0 && v) {
      const clip = clips[0];
      loadedClipRef.current = clip.id; loadedClipUrlRef.current = clip.url; v.muted = true;
      const onMeta = () => {
        v.removeEventListener("loadedmetadata", onMeta);
        if (loadedClipRef.current !== clip.id) return;
        const startS = Math.max(0, (initPh - clip.startTime + (clip.mediaOffset ?? 0)) / 1_000_000);
        console.log("Initial Seek:", startS, { initPh, clipStart: clip.startTime, mediaOffset: clip.mediaOffset ?? 0 });
        v.currentTime = startS;
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          if (loadedClipRef.current !== clip.id) return;
          const reveal = () => {
            if (!mountedRef.current) return;
            setVideoVisible(true);
            v.play().then(() => { if (mountedRef.current) setIsPlaying(true); }).catch(() => {});
          };
          if (v.readyState >= 2) reveal();
          else { const onCp = () => { v.removeEventListener("canplay", onCp); if (loadedClipRef.current === clip.id) reveal(); }; v.addEventListener("canplay", onCp); }
        };
        v.addEventListener("seeked", onSeeked);
      };
      v.addEventListener("loadedmetadata", onMeta); v.src = clip.url; v.load();
    } else if (post.videoUrl && v) {
      // src is set via JSX + videoVisible via useLayoutEffect — only play if not already started
      if (!isPlayingRef.current) {
        if (mountedRef.current) setVideoVisible(true);
        v.muted = true; // React's muted prop is unreliable — set imperatively before play()
        v.play()
          .then(() => {
            if (!mountedRef.current) return;
            setIsPlaying(true); setShowPlayOverlay(false);
          })
          .catch(() => { if (mountedRef.current) setShowPlayOverlay(true); });
      }
    } else { setVideoVisible(false); if (v) { v.pause(); v.src = ""; } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, hydratedPool, isHydrated]);

  // Immediate play — fires within the user-gesture trust window.
  // Only executes for the post that matches the pending gesture lock.
  useLayoutEffect(() => {
    if (!consumeTheaterGesture(post.id)) return;
    // Snapshot posts: kick off the rAF tick loop synchronously within the gesture window.
    // syncClip() will load + play the first clip with gesture-inherited autoplay trust.
    if (post.projectSnapshot) {
      gesturePlayedRef.current = true;
      phRef.current = post.demoStartTime || 0;
      setIsPlaying(true);
      return;
    }
    if (!post.videoUrl) return;
    const v = videoRef.current;
    if (!v) return;
    // React does not reliably forward the `muted` prop to the DOM element — set it imperatively
    // so the browser permits autoplay (muted autoplay is always allowed, unmuted is not).
    v.muted = true;
    setVideoVisible(true);
    v.play()
      .then(() => {
        console.log("[Theater PLAY_SUCCESS]", post.id);
        if (!mountedRef.current) return;
        setIsPlaying(true);
        setShowPlayOverlay(false);
        if (v.muted) { setShowUnmuteToast(true); setTimeout(() => { if (mountedRef.current) setShowUnmuteToast(false); }, 3500); }
      })
      .catch((err: Error) => {
        console.warn("[Theater PLAY_BLOCKED]", err.name, err.message);
        if (mountedRef.current) setShowPlayOverlay(true);
      });
  }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause/resume CSS animations (strobe, glitch) in sync with video play state
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.style.animationPlayState = isPlaying ? "running" : "paused";
  }, [isPlaying]);

  // Idle timer: arm while playing, disarm on pause
  useEffect(() => {
    if (isPlaying) { resetIdleTimer(); }
    else { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); setIsIdle(false); }
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); }, []);

  // Scroll-driven play/pause — fires when the IntersectionObserver hands off activePostId
  useEffect(() => {
    const v = videoRef.current;
    if (!isActive) {
      v?.pause();
      setIsPlaying(false);
      return;
    }
    if (!v || isPlayingRef.current) return;
    v.muted = true;
    v.play()
      .then(() => { if (mountedRef.current) { setIsPlaying(true); setShowPlayOverlay(false); } })
      .catch(() => { if (mountedRef.current) setShowPlayOverlay(true); });
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = useCallback(() => {
    if (clipsRef.current.length === 0) {
      const v = videoRef.current; if (!v) return;
      if (isPlayingRef.current) { v.pause(); }
      else {
        v.play()
          .then(() => { setShowPlayOverlay(false); })
          .catch((err: Error) => { console.warn("[Theater togglePlay BLOCKED]", err.name, err.message); });
      }
    } else { setIsPlaying((p) => !p); }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setProgress(ratio * 100);
    if (clipsRef.current.length > 0) {
      phRef.current = ratio * totalDurRef.current;
      loadedClipRef.current = null; loadedClipUrlRef.current = null;
      syncClip(phRef.current);
    } else {
      const v = videoRef.current;
      if (v?.duration) {
        if (post.projectSnapshot) {
          const demoStartS = (post.demoStartTime ?? 0) / 1_000_000;
          const demoDurS   = (post.demoDuration  ?? 0) / 1_000_000 || v.duration;
          v.currentTime = demoStartS + ratio * demoDurS;
        } else {
          v.currentTime = ratio * v.duration;
        }
      }
    }
  }, [syncClip]);

  // For preset posts (no snapshot) apply fxParams as CSS — filter + transform + animation
  const presetVideoStyle = useMemo(() => {
    if (!post.presetData?.fxParams) return {};
    const p = post.presetData.fxParams;
    const f = clipCssFilter(p);
    const t = clipCssTransform(p);
    const a = clipCssAnimation(p);
    return { ...(f ? { filter: f } : {}), ...(t ? { transform: t } : {}), ...(a ? { animation: a } : {}) };
  }, [post.presetData]);

  const isBlobPost = post.videoUrl?.startsWith("blob:");
  const remixAllowed = canRemix(post);
  // Resolved src for the main video element — undefined for snapshot posts (src set imperatively)
  const stableSrc = !post.projectSnapshot && post.videoUrl ? post.videoUrl : undefined;
  // Blur backdrop source: use videoUrl for ALL post types (snapshot posts set videoUrl = firstVideo.previewUrl)
  const blurSrc = post.videoUrl ?? snapshotClips[0]?.url;
  if (!post.projectSnapshot && post.videoUrl && !stableSrc) {
    console.error("[Theater] stableSrc resolved to undefined despite videoUrl being set", { postId: post.id, videoUrl: post.videoUrl });
  }

  return (
    <div ref={cellRef} className="relative flex h-screen w-full snap-start snap-always items-center justify-center bg-black">
      <div
        className={`group relative h-full w-full overflow-hidden ${isIdle && isPlaying ? "cursor-none" : "cursor-auto"}`}
        onMouseMove={handleMouseMove}
      >

        {/* Black cover during initial load */}
        {!videoVisible && !mediaError && <div className="absolute inset-0 z-[2] bg-black" />}

        {hydratedPool === null && !!post.projectSnapshot?.mediaPool?.length && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
            <p className="text-[10px] text-white/50">Loading media…</p>
          </div>
        )}

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

        <video
          ref={videoRef}
          src={stableSrc}
          muted={true} autoPlay playsInline preload="auto"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={() => setMediaError(true)}
          onLoadedData={() => {
            // Fallback play: fires when first frame is available; catches cases where
            // useLayoutEffect ran before the video had data and play() was blocked.
            const v = videoRef.current;
            if (!v || isPlayingRef.current || post.projectSnapshot) return;
            v.play()
              .then(() => {
                if (!mountedRef.current) return;
                setIsPlaying(true); setVideoVisible(true); setShowPlayOverlay(false);
              })
              .catch((err: Error) => console.warn("[Theater onLoadedData BLOCKED]", err.name));
          }}
          onCanPlay={() => {
            // Final fallback: browser signals it can play but isPlaying still false
            const v = videoRef.current;
            if (!v || isPlayingRef.current || post.projectSnapshot) return;
            v.play()
              .then(() => {
                if (!mountedRef.current) return;
                setIsPlaying(true); setVideoVisible(true); setShowPlayOverlay(false);
              })
              .catch(() => {});
          }}
          style={{ ...presetVideoStyle, animationPlayState: isPlaying ? "running" : "paused", willChange: "transform" }}
          className={`absolute inset-0 z-[10] h-full w-full object-contain transition-opacity duration-150 ${videoVisible && !mediaError ? "opacity-100" : "opacity-0"}`}
        />

        {/* Text overlays — z-[15]: above video (z-[10]), below UI chrome (z-[20]+) */}
        {textClipsRef.current.filter((c) => phRef.current >= c.startTime && phRef.current < c.startTime + c.duration).map((c) => {
          const r = buildTextStyle(c, phRef.current);
          return r ? <div key={c.id} className="pointer-events-none absolute inset-0 z-[15]"><span style={r.style}>{r.displayText}</span></div> : null;
        })}

        <div className="absolute bottom-0 left-0 right-0 z-[35] pointer-events-none" style={{ height: "35%", background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }} />

        {/* Play/Pause: visible when paused; hidden instantly when playing or idle */}
        <button
          onClick={togglePlay}
          className={`absolute inset-x-0 top-0 bottom-12 z-[20] flex items-center justify-center transition-opacity duration-150 ${!isPlaying && !isIdle ? "opacity-100" : "opacity-0"}`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/45 backdrop-blur-sm">
            {isPlaying ? <Pause size={24} className="text-white" fill="white" /> : <Play size={24} className="ml-1 text-white" fill="white" />}
          </div>
        </button>

        {/* Badges top-left */}
        <div className="absolute left-3 top-3 z-[40] flex items-center gap-1.5">
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

        {/* Play-blocked overlay — covers 100% of the cell, cleared on tap */}
        {showPlayOverlay && (
          <button
            onClick={() => { markInteracted(); togglePlay(); }}
            className="absolute inset-0 z-30 flex h-full w-full flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/30">
              <Play size={36} className="ml-1.5 text-white" fill="white" />
            </div>
            <span className="text-sm font-bold text-white/80">Tap to Play</span>
          </button>
        )}

        {/* "Click to Unmute" toast */}
        {showUnmuteToast && (
          <div className="pointer-events-none absolute left-1/2 top-6 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-[11px] font-semibold text-white/80 backdrop-blur-sm">
            Tap the speaker to unmute
          </div>
        )}

        {/* Info overlay */}
        <div className="absolute bottom-8 left-4 right-20 z-[40] pr-2">
          {/* div + role="button" avoids nested-button hydration error (Follow btn is inside) */}
          <div role="button" tabIndex={0} onClick={onCreator} onKeyDown={(e) => e.key === "Enter" && onCreator()} className="mb-2 flex cursor-pointer items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white/25" style={{ background: `hsl(${post.user.hue} 55% 28%)` }}>{post.user.initial}</div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white" style={TX}>@{post.user.handle}</span>
              {!isOwn && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleFollowToggle(); }}
                  className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur-sm transition-colors ${
                    following
                      ? "border-purple-400/40 bg-purple-500/20 text-purple-200"
                      : "border-white/25 bg-black/50 text-white/80 hover:bg-white/10"
                  }`}
                >
                  <Users size={8} />{following ? "Following" : "Follow"}
                </button>
              )}
            </div>
          </div>
          <h2 className="mb-1.5 line-clamp-2 text-xl font-bold leading-snug text-white" style={TX}>{post.title}</h2>
          {post.description && <p className="mb-2 line-clamp-2 text-base leading-relaxed text-white/90" style={TX}>{parseHashtags(post.description, onHashtagClick)}</p>}
          <div className="flex flex-wrap gap-1.5">
            {post.tags.map((t) => (
              <button key={t} onClick={() => onHashtagClick(t)} className="rounded-full bg-black/50 px-2 py-0.5 text-base font-medium text-white/85 backdrop-blur-sm hover:bg-purple-500/20 hover:text-purple-200 transition-colors" style={TX}>{t}</button>
            ))}
          </div>
        </div>

        {/* Action column — right sidebar, bottom-aligned, clear of top controls and scrubber */}
        <div className="absolute bottom-14 right-3 z-[40] flex flex-col items-center gap-3">
          <button onClick={() => toggleLike(post.id)} className="flex flex-col items-center gap-1">
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
          {isOwn && (
            <button onClick={() => onRemix(post)} className="flex flex-col items-center gap-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm hover:bg-white/15">
                <Pencil size={15} className="text-white/80" />
              </div>
              <span className="text-[9px] font-semibold text-white/70" style={TX}>Edit</span>
            </button>
          )}
          <button onClick={remixAllowed ? () => onRemix(post) : undefined} className={`flex flex-col items-center gap-1 ${remixAllowed ? "" : "opacity-35 cursor-not-allowed"}`}>
            <div className="flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95"
              style={remixAllowed ? { background: post.accent, boxShadow: `0 0 28px ${post.accent}99` } : { background: "#333" }}>
              <Zap size={26} className="text-white" fill="white" />
            </div>
            <span className="text-[9px] font-bold text-white" style={TX}>{remixAllowed ? "Remix" : "No Remix"}</span>
          </button>
        </div>

        {/* Scrubber — ghosts out with the rest of the UI when idle */}
        <div
          onClick={handleSeek}
          className={`absolute bottom-0 left-0 right-0 z-[50] h-2 cursor-pointer bg-white/15 hover:h-3 transition-all duration-300 ${isIdle && isPlaying ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"}`}
        >
          <div className="h-full rounded-r-full transition-none" style={{ width: `${progress}%`, background: post.accent }} />
        </div>

        {/* Mirror blur — fixed behind the entire cell, immune to container bg-black */}
        {blurSrc && (
          <video src={blurSrc} className="fixed inset-0 w-full h-full object-cover blur-3xl opacity-60 scale-110 -z-[1] pointer-events-none" muted playsInline autoPlay loop />
        )}
      </div>
    </div>
  );
}
