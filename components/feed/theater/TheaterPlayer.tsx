"use client";

/**
 * components/feed/theater/TheaterPlayer.tsx
 *
 * All video/playback logic for a single Theater cell:
 * refs, media hydration, clip sequencing, GlobalTicker-driven tick loop,
 * effect/text clip sync, and idle-cursor management.
 *
 * Renders the <video> element and text overlays directly (both need ref access),
 * then delegates all interactive/decorative chrome to <TheaterUI>.
 *
 * F — GlobalTicker: All continuous rAF loops (tick, animTick) are registered with
 * GlobalTicker instead of spawning independent requestAnimationFrame chains.
 * @local-raf: none — this file is fully migrated.
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import type { FeedPost } from "@/lib/store/feed-store";
import type { ClipEvent, MediaPoolItem } from "@/lib/store/types";
import { hydrateMediaPool } from "@/lib/store/media-pool-db";
import { useHydrationStore } from "@/lib/store/hydration-store";
import { useUserStore } from "@/lib/store/user-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { followCreator as idbFollow, unfollowCreator as idbUnfollow } from "@/lib/store/social-idb";
import { clipCssFilter, clipCssTransform, clipCssAnimation } from "@/lib/utils/svg-filters";
import { buildTextStyle, buildFxFilter } from "@/lib/utils/preview-helpers";
import {
  computeSeekTarget,
  timelineUsFromMedia,
  mediaSecFromTimeline,
  isOutsideDemoWindow,
} from "@/lib/utils/theater-seek";
import { canRemix } from "@/lib/policy";
import { consumeTheaterGesture, markInteracted } from "../theater-gesture";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";
import { TheaterUI } from "./TheaterUI";

// ── Shared render helpers ─────────────────────────────────────────────────────
export function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
export const TX: React.CSSProperties = {
  textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,1)",
  WebkitTextStroke: "0.5px rgba(0,0,0,0.7)",
};

// ── TheaterCell ───────────────────────────────────────────────────────────────
export interface CellProps {
  post: FeedPost;
  cellRef: (el: HTMLDivElement | null) => void;
  onRemix: (post: FeedPost) => void;
  onCreator: () => void;
  onHashtagClick: (tag: string) => void;
  globalMuted: boolean;
  isActive: boolean;
  isCommentsOpen: boolean;
  onToggleComments: () => void;
}

export function TheaterCell({ post, cellRef, onRemix, onCreator, onHashtagClick, globalMuted, isActive, isCommentsOpen, onToggleComments }: CellProps) {
  const videoRef          = useRef<HTMLVideoElement>(null);
  const mountedRef        = useRef(true);
  // GlobalTicker callback IDs (replaces independent requestAnimationFrame chains)
  const tickIdRef         = useRef<number | null>(null);
  const animTickIdRef     = useRef<number | null>(null);
  const phRef             = useRef(post.demoStartTime || 0);
  const lastTsRef         = useRef(0);
  const loadedClipRef     = useRef<string | null>(null);
  const loadedClipUrlRef  = useRef<string | null>(null);
  const isPlayingRef      = useRef(false);
  const clipsRef          = useRef<Array<ClipEvent & { url: string }>>([]);
  const totalDurRef       = useRef(30_000_000);
  const effectClipsRef    = useRef<ClipEvent[]>([]);
  const textClipsRef      = useRef<ClipEvent[]>([]);
  const activeAnimRef     = useRef<string | null>(null);
  const tunnelRef         = useRef<HTMLDivElement>(null);
  /** Set to true by the gesture useLayoutEffect so the boot useEffect skips its reset */
  const gesturePlayedRef  = useRef(false);
  const isScrubbingRef    = useRef(false);
  const wasPlayingBeforeScrubRef = useRef(false);
  const idleTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [progress, setProgress]               = useState(0);
  const [isPlaying, setIsPlaying]             = useState(false);
  const [videoVisible, setVideoVisible]       = useState(false);
  const [mediaError, setMediaError]           = useState(false);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);
  const [showUnmuteToast, setShowUnmuteToast] = useState(false);
  const [isIdle, setIsIdle]                   = useState(false);
  const [hydratedPool, setHydratedPool]       = useState<MediaPoolItem[] | null>(null);
  const [isVerticalVideo, setIsVerticalVideo] = useState(false);

  const isHydrated       = useHydrationStore((s) => s.isHydrated);
  const currentUsername  = useUserStore((s) => s.profile?.username);
  // Sync follow state from zustand (reactive) instead of the async IDB probe
  // the original implementation used — lets the button feel instantaneous and
  // survive cell unmount/remount without flicker.
  const following        = useUserStore((s) => s.following.includes(post.user.handle));
  const storeFollow      = useUserStore((s) => s.followCreator);
  const storeUnfollow    = useUserStore((s) => s.unfollowCreator);
  const likedPostIds     = useFeedStore((s) => s.likedPostIds);
  const toggleLike       = useFeedStore((s) => s.toggleLike);
  const liked            = likedPostIds.includes(post.id);
  const isOwn            = !!currentUsername && currentUsername === post.authorUsername;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Unregister GlobalTicker callbacks on unmount to prevent stale tick access
      if (tickIdRef.current !== null)     { unregisterTickCallback(tickIdRef.current);     tickIdRef.current     = null; }
      if (animTickIdRef.current !== null) { unregisterTickCallback(animTickIdRef.current); animTickIdRef.current = null; }
    };
  }, []);

  // Optimistic follow toggle — zustand update is synchronous so the button,
  // follower count, and feed relevance boost all apply within the same frame.
  // IDB write is fire-and-forget: the zustand state is the source of truth
  // and is itself persisted via zustand/middleware.
  const handleFollowToggle = useCallback(() => {
    if (following) {
      storeUnfollow(post.user.handle);
      idbUnfollow(post.user.handle).catch(() => {});
    } else {
      storeFollow(post.user.handle);
      idbFollow(post.user.handle).catch(() => {});
    }
  }, [following, post.user.handle, storeFollow, storeUnfollow]);

  // Idle timer: 2 s of no mouse movement while playing → ghost UI
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    setIsIdle(false);
    if (isPlayingRef.current)
      idleTimerRef.current = setTimeout(() => { if (mountedRef.current) setIsIdle(true); }, 2000);
  }, []);

  const handleMouseMove = useCallback(() => { if (isPlayingRef.current) resetIdleTimer(); }, [resetIdleTimer]);

  // Key on post.id only — prevents blob URL creation loop
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
    // Dev trace — mirrors [publish] snapshot. Compare side-by-side to surface any
    // fxParams shape drift between publish-time and Theater load.
    if (process.env.NODE_ENV !== "production" && snap) {
      console.debug("[theater] load effect snapshot", {
        postId: post.id,
        effectClips: effectClipsRef.current.map((c) => ({
          id: c.id,
          effectType: c.fxParams?.effectType ?? (c.renderedCss ? "<renderedCss>" : null),
          intensity: c.fxParams?.intensity,
          speed: c.fxParams?.speed,
          hueRotate: c.fxParams?.hueRotate,
          blurAmount: c.fxParams?.blurAmount,
          hasRenderedCss: !!c.renderedCss,
        })),
      });
    }
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

  // ── syncClip ───────────────────────────────────────────────────────────────

  const syncClip = useCallback((ph: number) => {
    const clips = clipsRef.current;
    const v = videoRef.current;
    if (!v) return;
    const hasMasterClock = !!post.demoDuration;
    const clip = clips.find((c) => ph >= c.startTime && ph < c.startTime + c.duration) ?? null;
    if (!clip) {
      if (!hasMasterClock && loadedClipRef.current !== null) {
        v.pause(); loadedClipRef.current = null; loadedClipUrlRef.current = null; setVideoVisible(false);
      }
      return;
    }
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

  // ── GlobalTicker tick (snapshot posts) ────────────────────────────────────
  // Registered with GlobalTicker — no self-referential requestAnimationFrame call.

  const tick = useCallback((ts: number) => {
    // LOCK: Theater seek parity (paused vs playing).
    // Scrub must be the sole authority on phRef while the user is dragging —
    // otherwise the tick that fires between pointerdown and the isPlaying
    // state flush will clobber the just-seeked position back to 0:00.
    if (isScrubbingRef.current) { lastTsRef.current = ts; return; }
    if (lastTsRef.current > 0) {
      const dur = Math.max(totalDurRef.current, 2_000_000);
      if (dur > 0) {
        const v = videoRef.current;
        const startUs  = post.demoStartTime || 0;
        const demoDurUs = post.demoDuration || 1_000_000;
        if (post.projectSnapshot && v) {
          // Convert media currentTime → TIMELINE microseconds via the active clip's
          // mediaOffset. Reading v.currentTime directly and treating it as timeline
          // space was the root cause of the 0:00 reset regression for Ruler Selection
          // publishes (clips where mediaOffset > 0).
          const activeClip =
            clipsRef.current.find((c) => c.id === loadedClipRef.current) ??
            clipsRef.current.find((c) => {
              const ph = Math.round(v.currentTime * 1_000_000);
              return ph >= (c.mediaOffset ?? 0) && ph < (c.mediaOffset ?? 0) + c.duration;
            }) ??
            null;
          let timelineUs = timelineUsFromMedia(activeClip, v.currentTime);
          if (isOutsideDemoWindow(timelineUs, startUs, demoDurUs)) {
            const resetSec = mediaSecFromTimeline(activeClip, startUs);
            v.currentTime = resetSec;
            timelineUs = startUs;
          }
          phRef.current = timelineUs;
          const relativeUs = timelineUs - startUs;
          setProgress(Math.max(0, Math.min(100, (relativeUs / demoDurUs) * 100)));
        } else {
          phRef.current = (phRef.current + Math.min(ts - lastTsRef.current, 100) * 1000) % dur;
          if (v && v.duration > 0 && isFinite(v.duration)) {
            setProgress((v.currentTime / v.duration) * 100);
          } else {
            setProgress((phRef.current / dur) * 100);
          }
        }
        syncClip(phRef.current);
        // Effect clips: sync CSS filter/transform/animation
        let activeEfxId: string | null = null;
        if (v) {
          const ph = phRef.current;
          const efx = effectClipsRef.current.find((c) => (c.renderedCss || !c.fxParams?.effectDisabled) && ph >= c.startTime && ph < c.startTime + c.duration);
          activeEfxId = efx?.id ?? null;
          if (!efx) {
            v.style.filter = ""; v.style.transform = "";
            if (activeAnimRef.current !== null) { v.style.animation = ""; activeAnimRef.current = null; }
            if (tunnelRef.current) tunnelRef.current.style.display = "none";
          } else if (efx.renderedCss && !efx.fxParams) {
            v.style.filter = efx.renderedCss.filter; v.style.transform = efx.renderedCss.transform;
            if (activeAnimRef.current !== efx.id) { v.style.animation = efx.renderedCss.animation ?? ""; activeAnimRef.current = efx.id; }
            if (tunnelRef.current) tunnelRef.current.style.display = "none";
          } else {
            // LOCK: Studio/Theater effect parity.
            // Route through the SAME buildFxFilter used by Studio's PreviewMonitor so
            // animated effects (hue-rotate speed, strobe, glitch, flash) produce
            // identical per-frame output. The old path used clipCssFilter, which
            // reads only the static `hueRotate` degree and ignores `speed` — the
            // "effect visible in Studio but missing in Theater" regression.
            const fx = buildFxFilter([efx], ph);
            v.style.filter = fx.filter !== "none" ? fx.filter : "";
            const transformParts: string[] = [];
            if (fx.mirrorTransform) transformParts.push(fx.mirrorTransform);
            if (fx.glitchTransform) transformParts.push(fx.glitchTransform);
            v.style.transform = transformParts.join(" ");
            // buildFxFilter drives strobe/glitch per-frame via the GlobalTicker now
            // (matching Studio), so the CSS @keyframes animation is cleared.
            if (activeAnimRef.current !== null) { v.style.animation = ""; activeAnimRef.current = null; }
            const td = tunnelRef.current;
            if (fx.hypnoTunnel && td) {
              td.style.display = "block";
              td.style.background = fx.hypnoTunnel.background;
              td.style.transform = "translate(-50%, -50%)";
            } else if (td) {
              td.style.display = "none";
            }
          }
          void activeEfxId;
        }
      }
    }
    lastTsRef.current = ts;
    // GlobalTicker handles loop continuation — no requestAnimationFrame call here
  }, [syncClip]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Register/unregister tick on play state change ─────────────────────────

  useEffect(() => {
    if (!isPlaying) {
      if (tickIdRef.current !== null)     { unregisterTickCallback(tickIdRef.current);     tickIdRef.current     = null; }
      if (animTickIdRef.current !== null) { unregisterTickCallback(animTickIdRef.current); animTickIdRef.current = null; }
      videoRef.current?.pause();
      return;
    }
    if (snapshotClips.length > 0) {
      // Snapshot posts: GlobalTicker-driven clip/FX sync
      lastTsRef.current = 0;
      tickIdRef.current = registerTickCallback(tick);
    } else {
      // Simple-video posts: drive progress bar from native currentTime/duration
      animTickIdRef.current = registerTickCallback(() => {
        if (!videoRef.current) return;
        const { currentTime, duration: vDur } = videoRef.current;
        if (vDur > 0 && isFinite(vDur) && !isNaN(vDur)) {
          setProgress((currentTime / vDur) * 100);
        }
      });
    }
    return () => {
      if (tickIdRef.current !== null)     { unregisterTickCallback(tickIdRef.current);     tickIdRef.current     = null; }
      if (animTickIdRef.current !== null) { unregisterTickCallback(animTickIdRef.current); animTickIdRef.current = null; }
    };
  }, [isPlaying, snapshotClips.length, tick]);

  // ── CSS animation play-state sync ─────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.style.animationPlayState = isPlaying ? "running" : "paused";
  }, [isPlaying]);

  // ── Idle timer ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isPlaying) { resetIdleTimer(); }
    else { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); setIsIdle(false); }
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); }, []);

  // ── Scroll-driven play/pause ──────────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!isActive) { v?.pause(); setIsPlaying(false); return; }
    if (!v || isPlayingRef.current) return;
    v.muted = true;
    v.play()
      .then(() => { if (mountedRef.current) { setIsPlaying(true); setShowPlayOverlay(false); } })
      .catch(() => { if (mountedRef.current) setShowPlayOverlay(true); });
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    if (isScrubbingRef.current) return;
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

  // LOCK: Theater seek parity (paused vs playing).
  // All seek math goes through the shared `computeSeekTarget` helper so paused
  // and playing states produce byte-identical output — any branching on
  // isPlaying here would reintroduce the drift bug.
  //
  // `commit=false` — pointer-move path. Update the visible frame within the
  //   currently loaded clip only. Do NOT call syncClip: it can reload v.src at
  //   clip boundaries, which appears to the user as a rhythmic stall mid-drag.
  // `commit=true`  — pointerup/cancel path. Single authoritative syncClip so
  //   the correct source + correct currentTime are both latched before playback
  //   resumes. This is the only moment the scrub path is allowed to reload src.
  const seekFromPointer = useCallback((clientX: number, el: HTMLDivElement, commit: boolean) => {
    const rect = el.getBoundingClientRect();
    const v = videoRef.current;
    if (!v) return;

    if (clipsRef.current.length > 0) {
      const startUs = post.demoStartTime ?? 0;
      const demoDurUs = post.demoDuration ?? totalDurRef.current;
      const target = computeSeekTarget(clientX, rect, startUs, demoDurUs, clipsRef.current);
      if (!target) return;

      phRef.current = target.timelineUs;
      setProgress(target.ratio * 100);

      // Visual feedback: only seek the video element when the pointer is over
      // the clip whose src is already loaded. Cross-clip targets wait for the
      // authoritative commit below.
      if (target.targetClip && target.targetClip.id === loadedClipRef.current) {
        v.currentTime = target.mediaSec;
      }

      if (commit) syncClip(target.timelineUs);
    } else {
      if (rect.width <= 0) return;
      const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
      const ratio = x / rect.width;
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      if (dur <= 0) return;
      v.currentTime = ratio * dur;
      setProgress(ratio * 100);
    }
  }, [post.demoStartTime, post.demoDuration, syncClip]);

  const onSeekPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    wasPlayingBeforeScrubRef.current = isPlayingRef.current || !!(v && !v.paused && !v.ended);
    isScrubbingRef.current = true;
    // Pause video + ticker so the frame stays still under the user's thumb
    if (v && !v.paused) v.pause();
    setIsPlaying(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromPointer(e.clientX, e.currentTarget, false);
  }, [seekFromPointer]);

  const onSeekPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbingRef.current) return;
    seekFromPointer(e.clientX, e.currentTarget, false);
  }, [seekFromPointer]);

  const onSeekPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // One authoritative commit at pointer-up — latches correct src + currentTime
    // before playback resumes, without the mid-drag src reloads that cause stalls.
    if (isScrubbingRef.current) seekFromPointer(e.clientX, e.currentTarget, true);
    isScrubbingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Resume playback only if it was playing before the scrub began
    if (wasPlayingBeforeScrubRef.current) {
      const v = videoRef.current;
      if (v) v.play().catch(() => {});
      setIsPlaying(true);
    }
    wasPlayingBeforeScrubRef.current = false;
  }, [seekFromPointer]);

  const onSeekPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Cancel still needs an authoritative sync at the last known pointer position
    // so the player doesn't resume against a half-seeked frame.
    if (isScrubbingRef.current) seekFromPointer(e.clientX, e.currentTarget, true);
    isScrubbingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (wasPlayingBeforeScrubRef.current) {
      const v = videoRef.current;
      if (v) v.play().catch(() => {});
      setIsPlaying(true);
    }
    wasPlayingBeforeScrubRef.current = false;
  }, [seekFromPointer]);

  // ── Boot: load first clip or simple videoUrl ───────────────────────────────

  useEffect(() => {
    if (isPlayingRef.current) return;
    if (!isHydrated && !!post.projectSnapshot?.mediaPool?.length) return;
    const clips = clipsRef.current;
    const v = videoRef.current;
    if (clips.length > 0 && loadedClipRef.current !== null) {
      const alreadyLoading = clips.find((c) => c.id === loadedClipRef.current);
      if (alreadyLoading && alreadyLoading.url === loadedClipUrlRef.current) return;
    }
    if (gesturePlayedRef.current) { gesturePlayedRef.current = false; return; }
    const initPh = post.demoStartTime || 0;
    phRef.current = initPh; setProgress(0); setIsPlaying(false); setMediaError(false);
    loadedClipRef.current = null; loadedClipUrlRef.current = null; lastTsRef.current = 0;
    if (tickIdRef.current !== null)     { unregisterTickCallback(tickIdRef.current);     tickIdRef.current     = null; }
    if (animTickIdRef.current !== null) { unregisterTickCallback(animTickIdRef.current); animTickIdRef.current = null; }
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
      if (!isPlayingRef.current) {
        if (mountedRef.current) setVideoVisible(true);
        v.muted = true;
        v.play()
          .then(() => { if (!mountedRef.current) return; setIsPlaying(true); setShowPlayOverlay(false); })
          .catch(() => { if (mountedRef.current) setShowPlayOverlay(true); });
      }
    } else { setVideoVisible(false); if (v) { v.pause(); v.src = ""; } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, hydratedPool, isHydrated]);

  // ── Gesture useLayoutEffect — fires within user-gesture trust window ───────

  useLayoutEffect(() => {
    if (!consumeTheaterGesture(post.id)) return;
    if (post.projectSnapshot) {
      gesturePlayedRef.current = true;
      phRef.current = post.demoStartTime || 0;
      setIsPlaying(true);
      return;
    }
    if (!post.videoUrl) return;
    const v = videoRef.current; if (!v) return;
    v.muted = true;
    setVideoVisible(true);
    v.play()
      .then(() => {
        console.log("[Theater PLAY_SUCCESS]", post.id);
        if (!mountedRef.current) return;
        setIsPlaying(true); setShowPlayOverlay(false);
        if (v.muted) { setShowUnmuteToast(true); setTimeout(() => { if (mountedRef.current) setShowUnmuteToast(false); }, 3500); }
      })
      .catch((err: Error) => {
        console.warn("[Theater PLAY_BLOCKED]", err.name, err.message);
        if (mountedRef.current) setShowPlayOverlay(true);
      });
  }, [post.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived display values ────────────────────────────────────────────────

  const presetVideoStyle = useMemo(() => {
    if (!post.presetData?.fxParams) return {};
    const p = post.presetData.fxParams;
    const f = clipCssFilter(p); const t = clipCssTransform(p); const a = clipCssAnimation(p);
    return { ...(f ? { filter: f } : {}), ...(t ? { transform: t } : {}), ...(a ? { animation: a } : {}) };
  }, [post.presetData]);

  const isBlobPost   = post.videoUrl?.startsWith("blob:");
  const remixAllowed = canRemix(post);
  const stableSrc    = !post.projectSnapshot && post.videoUrl ? post.videoUrl : undefined;
  const blurSrc      = post.videoUrl ?? snapshotClips[0]?.url;

  if (!post.projectSnapshot && post.videoUrl && !stableSrc) {
    console.error("[Theater] stableSrc resolved to undefined despite videoUrl being set", { postId: post.id, videoUrl: post.videoUrl });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={cellRef} className="relative flex h-screen w-full snap-start snap-always items-center justify-center bg-black">
      <div
        className={`group relative h-full w-full overflow-hidden ${isIdle && isPlaying ? "cursor-none" : "cursor-auto"}`}
        onMouseMove={handleMouseMove}
      >
        {/* Main video element */}
        <video
          ref={videoRef}
          src={stableSrc}
          muted={true} autoPlay playsInline preload="auto"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={() => setMediaError(true)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) {
              setIsVerticalVideo(v.videoWidth / v.videoHeight < 1);
            }
          }}
          onLoadedData={() => {
            const v = videoRef.current;
            if (!v || isPlayingRef.current || post.projectSnapshot) return;
            v.play()
              .then(() => { if (!mountedRef.current) return; setIsPlaying(true); setVideoVisible(true); setShowPlayOverlay(false); })
              .catch((err: Error) => console.warn("[Theater onLoadedData BLOCKED]", err.name));
          }}
          onCanPlay={() => {
            const v = videoRef.current;
            if (!v || isPlayingRef.current || post.projectSnapshot) return;
            v.play()
              .then(() => { if (!mountedRef.current) return; setIsPlaying(true); setVideoVisible(true); setShowPlayOverlay(false); })
              .catch(() => {});
          }}
          style={{ ...presetVideoStyle, animationPlayState: isPlaying ? "running" : "paused", willChange: "transform" }}
          className={`absolute inset-0 z-[10] h-full w-full object-contain transition-opacity duration-150 ${videoVisible && !mediaError ? "opacity-100" : "opacity-0"}`}
        />

        {/* Hypno-tunnel radial overlay — z-[12]: above video, below text & UI.
            Oversized 300%×300% circle with borderRadius:50% so rotation never
            shows square corners — matches Studio PreviewVideoLayer approach. */}
        <div className="pointer-events-none absolute inset-0 z-[12] overflow-hidden">
          <div
            ref={tunnelRef}
            style={{
              display: "none",
              position: "absolute",
              width: "300%", height: "300%",
              top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              transformOrigin: "center center",
              borderRadius: "50%",
              mixBlendMode: "screen",
            }}
          />
        </div>

        {/* Text overlays — z-[15]: above video, below UI chrome. Reads phRef directly. */}
        {textClipsRef.current
          .filter((c) => phRef.current >= c.startTime && phRef.current < c.startTime + c.duration)
          .map((c) => {
            const r = buildTextStyle(c, phRef.current);
            return r ? (
              <div key={c.id} className="pointer-events-none absolute inset-0 z-[15]">
                <span style={r.style}>{r.displayText}</span>
              </div>
            ) : null;
          })
        }

        {/* All interactive and decorative chrome */}
        <TheaterUI
          post={post}
          progress={progress}
          isPlaying={isPlaying}
          isIdle={isIdle}
          videoVisible={videoVisible}
          mediaError={mediaError}
          following={following}
          liked={liked}
          isOwn={isOwn}
          showPlayOverlay={showPlayOverlay}
          showUnmuteToast={showUnmuteToast}
          hydratedPool={hydratedPool}
          remixAllowed={!!remixAllowed}
          isBlobPost={!!isBlobPost}
          onTogglePlay={togglePlay}
          onSeekPointerDown={onSeekPointerDown}
          onSeekPointerMove={onSeekPointerMove}
          onSeekPointerUp={onSeekPointerUp}
          onSeekPointerCancel={onSeekPointerCancel}
          onFollowToggle={handleFollowToggle}
          onToggleLike={() => toggleLike(post.id)}
          onPlayBlocked={() => { markInteracted(); togglePlay(); }}
          onRemix={onRemix}
          onCreator={onCreator}
          onHashtagClick={onHashtagClick}
          blurSrc={blurSrc}
          isCommentsOpen={isCommentsOpen}
          onToggleComments={onToggleComments}
          isVerticalVideo={isVerticalVideo}
        />
      </div>
    </div>
  );
}
