"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import { X, Zap, Heart, Share2, Play, Pause, MessageCircle, Users, Volume2, VolumeX, GitBranch, WifiOff, Pencil, History } from "lucide-react";
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

// ── Gesture lock ───────────────────────────────────────────────────────────────
// Set synchronously in the click handler (before React batches the state update)
// so the matching TheaterCell's useLayoutEffect fires within the gesture trust window.
let _gesturePendingId: string | null = null;
export function primeTheaterGesture(postId: string) { _gesturePendingId = postId; }

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
const TX: React.CSSProperties = { textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,1)", WebkitTextStroke: "0.5px rgba(0,0,0,0.7)" };

/** Build a strictly deduplicated queue: seed first, then same-author posts, then tag-matched, then rest */
function buildQueue(seed: FeedPost, all: FeedPost[]): FeedPost[] {
  const seen = new Set<string>([seed.id]);
  const byAuthor = all.filter((p) => p.id !== seed.id && p.user.handle === seed.user.handle);
  byAuthor.forEach((p) => seen.add(p.id)); // populate BEFORE byTag so author posts can't appear twice
  const byTag = all.filter((p) => !seen.has(p.id) && p.tags.some((t) => seed.tags.includes(t)));
  byTag.forEach((p) => seen.add(p.id));
  const rest = all.filter((p) => !seen.has(p.id));
  return [seed, ...byAuthor, ...byTag, ...rest].slice(0, 50);
}

// ── TheaterCell ────────────────────────────────────────────────────────────────
interface CellProps {
  post: FeedPost;
  cellRef: (el: HTMLDivElement | null) => void;
  onRemix: () => void;
  onCreator: () => void;
  onHashtagClick: (tag: string) => void;
  globalMuted: boolean;
}

function TheaterCell({ post, cellRef, onRemix, onCreator, onHashtagClick, globalMuted }: CellProps) {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const mountedRef     = useRef(true);
  const rafRef         = useRef<number | null>(null);
  const phRef          = useRef(0);
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

  const [progress, setProgress]           = useState(0);
  const [isPlaying, setIsPlaying]         = useState(false);
  const [videoVisible, setVideoVisible]   = useState(false);
  const [mediaError, setMediaError]       = useState(false);
  const [following, setFollowing]         = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);
  const [showUnmuteToast, setShowUnmuteToast] = useState(false);
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
    const clip = clips.find((c) => ph >= c.startTime && ph < c.startTime + c.duration) ?? null;
    if (!clip) {
      if (loadedClipRef.current !== null) { v.pause(); loadedClipRef.current = null; loadedClipUrlRef.current = null; setVideoVisible(false); }
      return;
    }
    if (loadedClipRef.current === clip.id) {
      if (v.readyState >= 2) setVideoVisible(true);
      if (isPlayingRef.current && v.paused) v.play().catch(() => {});
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
          const guard = () => {
            if (loadedClipRef.current !== clipId) { v.removeEventListener("timeupdate", guard); return; }
            if (v.currentTime >= mediaEndSec) {
              v.removeEventListener("timeupdate", guard);
              phRef.current = clipStart + clipDur; loadedClipRef.current = null; loadedClipUrlRef.current = null; v.pause();
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
      // Guard: never wrap at less than 2 seconds — prevents ghost loops from empty-timeline publishes
      const dur = Math.max(totalDurRef.current, 2_000_000);
      if (dur > 0) {
        phRef.current = (phRef.current + Math.min(ts - lastTsRef.current, 100) * 1000) % dur;
        const v = videoRef.current;
        // Smart selection loop: for snapshot posts with a demo window, enforce the boundary imperatively
        // NOTE: demoStartTime/demoDuration are in MICROSECONDS, video.currentTime is in SECONDS
        if (post.projectSnapshot && v) {
          const demoStartUs = post.demoStartTime ?? 0;
          const demoDurUs   = post.demoDuration  ?? 0;
          if (demoDurUs > 0 && v.currentTime >= (demoStartUs + demoDurUs) / 1_000_000) {
            v.currentTime = demoStartUs / 1_000_000;
          }
        }
        // Progress: use native video time when available for accuracy
        if (v && v.duration > 0 && isFinite(v.duration)) {
          const demoStartS = (post.demoStartTime ?? 0) / 1_000_000;
          const demoDurS   = (post.demoDuration  ?? 0) / 1_000_000;
          const windowS    = demoDurS > 0 ? demoDurS : v.duration;
          const elapsed    = Math.max(0, v.currentTime - demoStartS);
          setProgress((elapsed / windowS) * 100);
        } else {
          setProgress((phRef.current / dur) * 100);
        }
        syncClip(phRef.current);
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
              const anim = clipCssAnimation(efxP);
              if (activeAnimRef.current !== efx.id) { v.style.animation = anim; activeAnimRef.current = efx.id; }
            }
          }
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
    phRef.current = 0; setProgress(0); setIsPlaying(false); setMediaError(false);
    loadedClipRef.current = null; loadedClipUrlRef.current = null; lastTsRef.current = 0;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (clips.length > 0 && v) {
      const clip = clips[0];
      loadedClipRef.current = clip.id; loadedClipUrlRef.current = clip.url; v.muted = true;
      const onMeta = () => {
        v.removeEventListener("loadedmetadata", onMeta);
        if (loadedClipRef.current !== clip.id) return;
        v.currentTime = (clip.mediaOffset ?? 0) / 1_000_000;
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          if (loadedClipRef.current !== clip.id) return;
          const reveal = () => {
            if (!mountedRef.current) return;
            setVideoVisible(true);
            v.play().then(() => { if (mountedRef.current) setIsPlaying(true); }).catch(() => {});
            const endSec = ((clip.mediaOffset ?? 0) + clip.duration) / 1_000_000;
            v.addEventListener("timeupdate", function g() {
              if (v.currentTime >= endSec) { v.removeEventListener("timeupdate", g); phRef.current = clip.startTime + clip.duration; loadedClipRef.current = null; loadedClipUrlRef.current = null; v.pause(); }
            });
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
    if (_gesturePendingId !== post.id) return;
    _gesturePendingId = null; // consume — only one cell plays in the gesture window
    // Snapshot posts: kick off the rAF tick loop synchronously within the gesture window.
    // syncClip() will load + play the first clip with gesture-inherited autoplay trust.
    if (post.projectSnapshot) {
      gesturePlayedRef.current = true;
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
  const remixAllowed = post.allowRemix !== false;
  // Resolved src for the main video element — undefined for snapshot posts (src set imperatively)
  const stableSrc = !post.projectSnapshot && post.videoUrl ? post.videoUrl : undefined;
  // Blur backdrop source: use videoUrl for ALL post types (snapshot posts set videoUrl = firstVideo.previewUrl)
  const blurSrc = post.videoUrl ?? snapshotClips[0]?.url;
  if (!post.projectSnapshot && post.videoUrl && !stableSrc) {
    console.error("[Theater] stableSrc resolved to undefined despite videoUrl being set", { postId: post.id, videoUrl: post.videoUrl });
  }

  return (
    <div ref={cellRef} className="relative flex h-screen w-full snap-start items-center justify-center bg-black">
      <div className="group relative h-full w-full overflow-hidden">

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

        {/* Debug: log the src value to verify it is non-null before handing it to the video */}
        {process.env.NODE_ENV === "development" && console.log("[Theater] Video SRC assigned:", stableSrc, "postId:", post.id) as never}

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
          style={{ ...presetVideoStyle, animationPlayState: isPlaying ? "running" : "paused" }}
          className={`absolute inset-0 z-[10] h-full w-full object-contain transition-opacity duration-150 ${videoVisible && !mediaError ? "opacity-100" : "opacity-0"}`}
        />

        {/* Text overlays — z-[15]: above video (z-[10]), below UI chrome (z-[20]+) */}
        {textClipsRef.current.filter((c) => phRef.current >= c.startTime && phRef.current < c.startTime + c.duration).map((c) => {
          const r = buildTextStyle(c, phRef.current);
          return r ? <div key={c.id} className="pointer-events-none absolute inset-0 z-[15]"><span style={r.style}>{r.displayText}</span></div> : null;
        })}

        <div className="absolute bottom-0 left-0 right-0 z-[35] pointer-events-none" style={{ height: "35%", background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }} />

        {/* Play/Pause tap zone */}
        <button onClick={togglePlay} className="absolute inset-x-0 top-0 bottom-12 z-[20] flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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
          <button onClick={togglePlay} className="absolute inset-0 z-30 flex h-full w-full flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm">
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
            <button onClick={onRemix} className="flex flex-col items-center gap-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm hover:bg-white/15">
                <Pencil size={15} className="text-white/80" />
              </div>
              <span className="text-[9px] font-semibold text-white/70" style={TX}>Edit</span>
            </button>
          )}
          <button onClick={remixAllowed ? onRemix : undefined} className={`flex flex-col items-center gap-1 ${remixAllowed ? "" : "opacity-35 cursor-not-allowed"}`}>
            <div className="flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95"
              style={remixAllowed ? { background: post.accent, boxShadow: `0 0 28px ${post.accent}99` } : { background: "#333" }}>
              <Zap size={26} className="text-white" fill="white" />
            </div>
            <span className="text-[9px] font-bold text-white" style={TX}>{remixAllowed ? "Remix" : "No Remix"}</span>
          </button>
        </div>

        {/* Scrubber */}
        <div onClick={handleSeek} className="absolute bottom-0 left-0 right-0 z-[50] h-2 cursor-pointer pointer-events-auto bg-white/15 hover:h-3 transition-all">
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

// ── TheaterMode ────────────────────────────────────────────────────────────────
interface TheaterModeProps {
  post: FeedPost;
  onClose: () => void;
  onRemix: () => void;
  onCreator: () => void;
  onHashtagClick?: (tag: string) => void;
  allPosts?: FeedPost[];
  onNavigate?: (post: FeedPost) => void;
}

export function TheaterMode({ post, onClose, onRemix, onCreator, onHashtagClick, allPosts = [] }: TheaterModeProps) {
  const [queue, setQueue]             = useState<FeedPost[]>(() => buildQueue(post, allPosts));
  const [muted, setMuted]             = useState(true);
  const [activePostId, setActivePostId] = useState(post.id);
  const [showVersions, setShowVersions] = useState(false);
  const scrollRef               = useRef<HTMLDivElement>(null);
  const cellRefs                = useRef<Map<string, HTMLDivElement>>(new Map());
  const elementToPid            = useRef<WeakMap<HTMLDivElement, string>>(new WeakMap());
  const observerRef             = useRef<IntersectionObserver | null>(null);

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
          if (!entry.isIntersecting) continue;
          const pid = elementToPid.current.get(entry.target as HTMLDivElement);
          if (pid) setActivePostId(pid);
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
      elementToPid.current.set(el, postId);
      observerRef.current?.observe(el);
    } else {
      cellRefs.current.delete(postId);
      // WeakMap self-cleans when el is GC'd — no delete needed
    }
  }, []);

  const activePost = useMemo(() => queue.find((p) => p.id === activePostId) ?? queue[0], [queue, activePostId]);
  const versionSiblings = useMemo(() => {
    if (!activePost) return [];
    const root = activePost.rootParentId ?? (activePost.remixedFromPostId ? activePost.id : null);
    if (!root && !activePost.remixedFromPostId) return [];
    return allPosts.filter((p) =>
      p.id !== activePost.id &&
      (p.rootParentId === root || p.rootParentId === activePost.id || p.remixedFromPostId === activePost.id)
    );
  }, [activePost, allPosts]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Top-right controls: Versions | Mute | Close */}
      <div className="fixed right-4 top-4 z-[100] flex items-center gap-2">
        {versionSiblings.length > 0 && (
          <button
            onClick={() => setShowVersions((v) => !v)}
            title="Versions"
            className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold backdrop-blur-sm transition-colors ${
              showVersions
                ? "border-purple-400/50 bg-purple-500/25 text-purple-200"
                : "border-white/20 bg-black/60 text-white/70 hover:bg-white/15 hover:text-white"
            }`}
          >
            <History size={13} />
            {versionSiblings.length}
          </button>
        )}
        <button
          onClick={() => setMuted((v) => !v)}
          title={muted ? "Unmute" : "Mute"}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/80 text-white drop-shadow-lg backdrop-blur-sm transition-colors hover:bg-black/90"
        >
          {muted ? <VolumeX size={16} className="text-white" /> : <Volume2 size={16} className="text-white" />}
        </button>
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/80 text-white/90 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
        >
          <X size={15} />
        </button>
      </div>

      {/* Versions drawer */}
      {showVersions && (
        <div className="fixed right-0 top-0 z-[55] flex h-full w-64 flex-col border-l border-white/10 bg-black/90 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="text-xs font-bold text-white/80">Versions ({versionSiblings.length})</span>
            <button onClick={() => setShowVersions(false)} className="text-white/40 hover:text-white"><X size={13} /></button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            {versionSiblings.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  const el = cellRefs.current.get(p.id);
                  if (el) { el.scrollIntoView({ behavior: "smooth" }); }
                  else {
                    setQueue((prev) => prev.some((q) => q.id === p.id) ? prev : [p, ...prev]);
                    setTimeout(() => cellRefs.current.get(p.id)?.scrollIntoView({ behavior: "smooth" }), 120);
                  }
                  setShowVersions(false);
                }}
                className="flex w-full items-start gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/5"
              >
                <div
                  className="h-14 w-10 shrink-0 overflow-hidden rounded-md"
                  style={{ background: p.bg ?? "#1a1a1a" }}
                >
                  {p.videoUrl && (
                    <video
                      src={p.videoUrl}
                      muted playsInline preload="none"
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-semibold text-white/90">{p.title}</p>
                  <p className="text-[10px] text-white/40">@{p.user.handle}</p>
                  {p.remixedFromHandle && (
                    <div className="mt-1 flex items-center gap-1">
                      <GitBranch size={8} className="text-purple-400" />
                      <span className="text-[9px] text-purple-300">@{p.remixedFromHandle}</span>
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Vertical snap-scroll feed — deduplicate at render time as a final safety net */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-screen overflow-y-scroll snap-y snap-mandatory"
        style={{ scrollbarWidth: "none" }}
      >
        {Array.from(new Map(queue.map((p) => [p.id, p])).values()).map((p) => (
          <TheaterCell
            key={p.id}
            post={p}
            cellRef={setCellRef(p.id)}
            onRemix={onRemix}
            onCreator={onCreator}
            onHashtagClick={onHashtagClick ?? (() => {})}
            globalMuted={muted}
          />
        ))}
      </div>
    </div>
  );
}
