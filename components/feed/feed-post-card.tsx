"use client";

import { useRef, useState, useMemo, useEffect, useSyncExternalStore } from "react";
import { Play, Flame, WifiOff, Trash2, GitBranch } from "lucide-react";
import { type FeedPost, isBlobUrl, FALLBACK_VIDEO_URL } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";
import { clipCssTransform } from "@/lib/utils/svg-filters";
import { buildTextStyle, buildFxFilter } from "@/lib/utils/preview-helpers";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";
import type { ClipEvent } from "@/lib/store/types";
import { isHot } from "@/lib/social";
import { observeViewport } from "@/lib/utils/intersection-observer-pool";
import { loadThumbnailUrl, saveThumbnail } from "@/lib/store/thumbnail-idb";
import { captureLiveFrame, extractThumbnail } from "@/lib/utils/thumbnail-extractor";

function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

interface FeedPostCardProps {
  post: FeedPost;
  onOpen: () => void;
  onRemix: () => void;
  onCreator: () => void;
  onDelete?: () => void;
  onImport?: () => void;
  /** Only show the delete control when explicitly true (Profile page only) */
  showDelete?: boolean;
  /** Pool to score engagement against for the "Hot" badge. Defaults to empty
   *  (no badge) — callers that render a grid should pass the rendered list. */
  pool?: readonly FeedPost[];
  /** When true, an IntersectionObserver auto-plays the video when ≥60% of the
   *  card is visible and pauses it when it scrolls out. Intended for the
   *  single-column RedGIF view. Grid mode leaves this false (default) so the
   *  existing hover-only behaviour is byte-identical. */
  autoplayInView?: boolean;
}

export function FeedPostCard({ post, onOpen, onRemix, onCreator, onDelete, onImport, showDelete, pool, autoplayInView = false }: FeedPostCardProps) {
  const currentUsername = useUserStore((s) => s.profile?.username);
  const following = useUserStore((s) => s.following);
  const followCreator = useUserStore((s) => s.followCreator);
  const unfollowCreator = useUserStore((s) => s.unfollowCreator);
  const isFollowingCreator = following.includes(post.user.handle);
  const videoRef = useRef<HTMLVideoElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState(false);
  const [mediaOffline, setMediaOffline] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Gate client-only renders to prevent SSR/hydration mismatch from Math.sin() bar heights.
  // useSyncExternalStore flips true after hydration without a setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [toast, setToast] = useState<string | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isBlob = isBlobUrl(post.videoUrl);
  // Durable thumbnail URL resolved from IndexedDB. When present it wins over
  // every other preview source, so local-media cards render immediately after
  // refresh even before the blob pool finishes hydrating.
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // First clip's source URL + seek offset — handles gaps at project start.
  // Static thumbnail (un-hovered) NEVER applies color/animation filters so the
  // card frame is byte-identical to its published thumbnail. On hover we drive
  // `buildFxFilter` via the GlobalTicker — same helper Studio/Theater use — so
  // motion effects (hue-rotate, strobe, glitch, etc.) preview with zero drift.
  const { firstClipSrc, firstClipOffset, firstClipTransform, firstClipStart, firstClipMediaOffsetUs, activeEffectClips } = useMemo(() => {
    const empty = {
      firstClipSrc: post.videoUrl, firstClipOffset: 0.001, firstClipTransform: "",
      firstClipStart: 0, firstClipMediaOffsetUs: 0, activeEffectClips: [] as ClipEvent[],
    };
    const snap = post.projectSnapshot;
    if (!snap) return empty;
    const pool = snap.mediaPool ?? [];
    const fc = snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime)[0];
    if (!fc) return empty;
    // Merge embedded (remix baking) + separate effect tracks (original / user-added post-remix).
    const effectPool: ClipEvent[] = [
      ...(fc.embeddedEffectClips ?? []),
      ...snap.tracks.filter((t) => t.type === "effect").flatMap((t) => t.clips),
    ];
    // Every overlapping, enabled effect — stacking is authoritative (matches Theater).
    const active = effectPool.filter((c) =>
      c.startTime < fc.startTime + fc.duration &&
      c.startTime + c.duration > fc.startTime &&
      !c.fxParams?.effectDisabled,
    );
    const firstEfx = active[0];
    const firstEfxFxParams = firstEfx?.fxParams ?? {};
    const firstClipTransform = firstEfx ? (firstEfx.renderedCss?.transform ?? clipCssTransform(firstEfxFxParams)) : "";
    return {
      firstClipSrc: pool.find((m) => m.id === fc.sourceId)?.previewUrl ?? post.videoUrl,
      firstClipOffset: Math.max(0.001, (fc.mediaOffset ?? 0) / 1_000_000),
      firstClipTransform,
      firstClipStart: fc.startTime,
      firstClipMediaOffsetUs: fc.mediaOffset ?? 0,
      activeEffectClips: active,
    };
  }, [post.projectSnapshot, post.videoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clip-bounded playback: prefer exported demoStartTime/demoDuration over raw source offsets.
  // Mirrors the coordinate system Theater uses so the feed and Theater play the same window.
  const clipStartSec = post.demoStartTime != null && post.demoStartTime > 0
    ? post.demoStartTime / 1_000_000
    : firstClipOffset;
  const clipDurationSec: number | null = post.demoDuration ? post.demoDuration / 1_000_000 : null;

  // Text overlays visible at the preview frame offset
  // Also checks embeddedTextClips on video clips (remix baking)
  const textOverlays = useMemo(() => {
    const snap = post.projectSnapshot;
    if (!snap) return [];
    const phMicros = firstClipOffset * 1_000_000;
    const fc = snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime)[0];
    const textPool = [
      ...(fc?.embeddedTextClips ?? []),
      ...snap.tracks.filter((t) => t.type === "text").flatMap((t) => t.clips),
    ];
    return textPool
      .filter((c) => phMicros >= c.startTime && phMicros < c.startTime + c.duration)
      .map((c) => buildTextStyle(c, phMicros))
      .filter((r): r is NonNullable<ReturnType<typeof buildTextStyle>> => r !== null);
  }, [post.projectSnapshot, firstClipOffset]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !firstClipSrc) return;
    const onMeta = () => { v.currentTime = clipStartSec; };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [firstClipSrc, clipStartSec]);

  // Loop guard — when exported clip bounds are set, reset to clipStartSec before
  // the source video reaches the end of the clip window. Native `loop` handles the
  // full-source fallback; this guard fires first for bounded clips.
  useEffect(() => {
    if (clipDurationSec === null) return;
    const v = videoRef.current;
    if (!v) return;
    const loopEnd = clipStartSec + clipDurationSec;
    const guard = () => { if (v.currentTime >= loopEnd) v.currentTime = clipStartSec; };
    v.addEventListener("timeupdate", guard);
    return () => v.removeEventListener("timeupdate", guard);
  }, [clipStartSec, clipDurationSec]);

  // ── Durable thumbnail pipeline ───────────────────────────────────────
  // On mount (and whenever the source identity changes) try the durable
  // IndexedDB thumbnail first. If none exists, schedule a background
  // extraction from `firstClipSrc` — the result is both shown to this card
  // immediately AND persisted so every subsequent refresh/boot short-circuits
  // straight to Layer 1 of the source chain.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await loadThumbnailUrl(post.id);
      if (cancelled) return;
      if (existing) {
        setThumbUrl(existing);
        return;
      }
      // No persisted thumb — try to extract one from the canonical media.
      // Skip when we have nothing to read from; the runtime captureLiveFrame
      // effect below will handle the case where playback produces frames.
      if (!firstClipSrc) return;
      const blob = await extractThumbnail(firstClipSrc);
      if (cancelled || !blob) return;
      await saveThumbnail(post.id, blob);
      const freshUrl = await loadThumbnailUrl(post.id);
      if (!cancelled && freshUrl) setThumbUrl(freshUrl);
    })();
    return () => { cancelled = true; };
  }, [post.id, firstClipSrc]);

  // Runtime fallback (Layer 3 of the chain): if we still have no durable thumb
  // but the video has reached a decodable frame during hover, capture that
  // frame, persist it, and show it from now on. Guarded so we never overwrite
  // an already-persisted thumbnail.
  useEffect(() => {
    if (thumbUrl) return; // Layer 1 already resolved
    const v = videoRef.current;
    if (!v) return;
    const onFrame = () => {
      if (thumbUrl || v.readyState < 2) return;
      captureLiveFrame(v).then((blob) => {
        if (!blob) return;
        saveThumbnail(post.id, blob).then(() => {
          loadThumbnailUrl(post.id).then((u) => { if (u) setThumbUrl(u); });
        });
      });
    };
    v.addEventListener("loadeddata", onFrame, { once: true });
    return () => v.removeEventListener("loadeddata", onFrame);
  }, [post.id, thumbUrl]);

  // Viewport-driven <video>.src strip: when the card leaves the viewport,
  // null out src so the browser releases decoder + demux buffer. On re-enter
  // the src is restored; the loadedmetadata effect above re-seeks to
  // firstClipOffset so the visible frame matches the published thumbnail.
  // The rootMargin is generous to prevent flicker at scroll-edge bounces.
  useEffect(() => {
    const article = videoRef.current?.parentElement;
    if (!article || !firstClipSrc) return;
    const unobserve = observeViewport(article, (isVisible) => {
      const v = videoRef.current;
      if (!v) return;
      if (isVisible) {
        if (v.src !== firstClipSrc) {
          v.src = firstClipSrc;
          v.load();
        }
      } else {
        v.pause();
        v.removeAttribute("src");
        v.load();
        const bar = progressBarRef.current;
        if (bar) bar.style.width = "0%";
      }
    }, "400px");
    return unobserve;
  }, [firstClipSrc]);

  // IntersectionObserver autoplay — single-column (RedGIF) mode only.
  // When autoplayInView is true, play the video as soon as ≥60% of the <article>
  // is intersecting the viewport, and pause it when it scrolls out. The three
  // autoplay-policy attributes (muted loop playsInline) are already on the
  // <video> element so no additions are needed here.
  useEffect(() => {
    if (!autoplayInView) return;
    const article = articleRef.current;
    if (!article) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const v = videoRef.current;
        if (!v) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      },
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(article);
    return () => observer.disconnect();
  }, [autoplayInView]);

  // FX preview — drive `buildFxFilter` per tick using the SHARED helper that
  // Studio and Theater use, so animated effects (hue-rotate speed, strobe,
  // glitch, flash) preview with byte-identical math. Runs whenever the video
  // is playing: either the user is hovering in grid view, OR IntersectionObserver
  // autoplay has taken over in the single-column RedGIF feed. Styles are cleared
  // on exit to preserve static-thumbnail color purity.
  const fxActive = hovered || autoplayInView;
  useEffect(() => {
    if (!fxActive || activeEffectClips.length === 0) return;
    const v = videoRef.current;
    if (!v) return;
    const baseTransform = firstClipTransform;
    const id = registerTickCallback(() => {
      // Translate video's media time → timeline microseconds so buildFxFilter
      // evaluates the effect at the *same* playhead Theater would compute.
      const timelineUs = firstClipStart + (v.currentTime * 1_000_000 - firstClipMediaOffsetUs);
      // Theater/Feed parity — per-tick lifetime gate. Matches
      // TheaterPlayer.tsx:312-316 so short effect clips (e.g., a 3s glitch)
      // stop applying once the playhead passes their duration, instead of
      // persisting for the whole hover.
      const liveClips = activeEffectClips.filter(
        (c) => timelineUs >= c.startTime && timelineUs < c.startTime + c.duration,
      );
      if (liveClips.length === 0) {
        v.style.filter = "";
        v.style.transform = baseTransform ?? "";
        return;
      }
      const fx = buildFxFilter(liveClips, timelineUs);
      v.style.filter = fx.filter === "none" ? "" : fx.filter;
      const transformParts: string[] = [];
      if (baseTransform) transformParts.push(baseTransform);
      if (fx.mirrorTransform) transformParts.push(fx.mirrorTransform);
      if (fx.glitchTransform) transformParts.push(fx.glitchTransform);
      v.style.transform = transformParts.join(" ");
    });
    return () => {
      unregisterTickCallback(id);
      // Clear FX styles on exit — the static thumbnail must look identical
      // to the published preview frame (no lingering color drift, no transform).
      v.style.filter = "";
      v.style.transform = "";
    };
  }, [fxActive, activeEffectClips, firstClipStart, firstClipMediaOffsetUs, firstClipTransform]);

  // Glass Wire progress bar — direct DOM write via GlobalTicker, zero React re-renders.
  // Math mirrors Theater: (currentTime - clipStart) / clipDuration so the bar tracks
  // the exported clip window, not the full source file.
  useEffect(() => {
    if (!autoplayInView) return;
    const id = registerTickCallback(() => {
      const v = videoRef.current;
      const bar = progressBarRef.current;
      if (!v || !bar || !v.duration || isNaN(v.duration)) return;
      if (clipDurationSec !== null) {
        const pct = Math.min(Math.max((v.currentTime - clipStartSec) / clipDurationSec, 0), 1);
        bar.style.width = `${pct * 100}%`;
      } else {
        bar.style.width = `${(v.currentTime / v.duration) * 100}%`;
      }
    });
    return () => unregisterTickCallback(id);
  }, [autoplayInView, clipStartSec, clipDurationSec]);

  const handleMouseEnter = () => {
    setHovered(true);
    const v = videoRef.current;
    if (!v || !firstClipSrc) return;
    // In single-column autoplay, the IntersectionObserver already owns playback.
    // Seamlessly "inherit" the currently-playing stream instead of slamming
    // currentTime back to 0 — that caused a visible re-buffer on hover.
    if (autoplayInView && !v.paused) return;
    v.currentTime = clipStartSec;
    v.play().catch(() => {});
  };
  const handleMouseLeave = () => {
    setHovered(false);
    const v = videoRef.current;
    if (!v) return;
    // Autoplay feed keeps the stream running until it scrolls out of view.
    if (autoplayInView) return;
    v.pause();
    v.currentTime = clipStartSec;
  };

  return (
    <article
      ref={articleRef}
      // aspect-[9/16] + w-full + h-auto locks the TikTok-style portrait
      // rectangle in CSS, so the browser reserves the correct card box before
      // the virtualizer's row math settles. Stripping this made cards collapse
      // to a square during the first paint on wide monitors.
      className={`group relative aspect-[9/16] h-auto w-full cursor-pointer overflow-hidden rounded-3xl transition-transform duration-300 ease-out ${autoplayInView ? "" : "hover:z-10 hover:scale-[1.05]"}`}
      style={{ willChange: "transform" }}
      onClick={() => { videoRef.current?.play().catch(() => {}); onOpen(); }}
      onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
    >
      <div className="relative h-full w-full" style={{ background: post.bg }}>
        {/* Delete confirmation overlay — only reachable when showDelete is true */}
        {confirmDelete && showDelete && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]/85 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-bold text-white">Delete this post?</p>
            <div className="flex gap-2">
              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-[10px] font-semibold text-white/60 hover:bg-white/8">Cancel</button>
              <button onClick={(e) => { e.stopPropagation(); onDelete?.(); }} className="rounded-lg bg-red-500/25 px-3 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/35">Delete</button>
            </div>
          </div>
        )}
        {/* Waveform bars — client-only to avoid SSR/hydration mismatch from Math.sin heights */}
        <div className={`absolute inset-0 flex items-end gap-[2px] px-2 pb-28 transition-opacity duration-500 ${post.videoUrl ? "opacity-0" : "opacity-20"}`} aria-hidden>
          {mounted && Array.from({ length: 32 }).map((_, i) => (
            <div key={i} className="flex-1 animate-pulse rounded-t-[2px]"
              style={{ background: post.accent, height: `${18 + Math.sin(i * 0.75) * 38 + (i % 5) * 8}%`, animationDelay: `${(i * 60) % 1000}ms` }} />
          ))}
        </div>

        {/* Durable IDB thumbnail — Layer 1 of the preview-source chain.
            Rendered as a static <img> poster BEHIND the <video>. Stays
            visible when the video isn't playing, which means:
              - cards render instantly on scroll (no decoder warmup needed)
              - refreshes with a dead blob URL still show a real frame
              - on hover, the playing <video> covers it with live motion */}
        {thumbUrl && (
          <img
            src={thumbUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
            style={{ zIndex: 0 }}
            draggable={false}
          />
        )}

        {/* Video */}
        <video ref={videoRef} src={firstClipSrc || undefined}
          {...(autoplayInView ? { "data-feed-video": "true" } : {})}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[150ms] ${firstClipSrc && !mediaOffline && (hovered || autoplayInView) ? "opacity-100" : thumbUrl ? "opacity-0" : firstClipSrc && !mediaOffline ? "opacity-100" : "opacity-0"}`}
          // The hover tick loop owns `filter` and `transform` while hovered and
          // clears them on exit. Do not set them inline here or React re-renders
          // will clobber per-tick FX values.
          style={{ transformOrigin: "center center" }}
          muted loop playsInline preload="metadata"
          onError={() => {
            const v = videoRef.current;
            // Layer 2: if the dead URL is a blob or not already the fallback, swap to placeholder
            if (v && v.src !== FALLBACK_VIDEO_URL) {
              v.src = FALLBACK_VIDEO_URL;
            } else {
              setMediaOffline(true);
            }
          }}
        />
        {mediaOffline && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[#0a0a0a]/60">
            <WifiOff size={18} className="text-white/30" />
            <p className="text-[9px] font-semibold text-white/35">Media Offline</p>
          </div>
        )}
        {/* Text overlays from snapshot (static at preview frame) */}
        {textOverlays.map((r, i) => (
          <div key={i} className="pointer-events-none absolute inset-0" style={{ zIndex: 5 }}>
            <span style={r.style}>{r.displayText}</span>
          </div>
        ))}
        {/* Typography scrim — deeper bottom-half ramp to support the larger
            handle + title text. Dark stop now starts at 50% (was 76%) so the
            bottom block of copy reads on any frame, including bright videos.
            A short top vignette keeps the upper badge row legible. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.65) 78%, rgba(0,0,0,0.95) 100%)",
          }}
        />

        {pool && isHot(post, pool) && (
          <span className="absolute left-2.5 top-2.5 flex items-center gap-0.5 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[8px] font-bold uppercase text-black">
            <Flame size={7} />Hot
          </span>
        )}
        {isBlob && !hovered && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-orange-500/70 px-1.5 py-0.5 text-[8px] font-semibold text-white">Local</span>
        )}
        {post.duration !== "—" && !hovered && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-[#0a0a0a]/60 px-1.5 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">{post.duration}</span>
        )}

        {/* Play icon (fades out on hover, or whenever autoplay is driving the card) */}
        <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${hovered || autoplayInView ? "opacity-0" : ""}`}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[#0a0a0a]/30 backdrop-blur-sm">
            <Play size={14} className="ml-0.5 text-white" fill="white" />
          </div>
        </div>

        {/* Persistent bottom-left metadata — always visible */}
        <div
          className="absolute bottom-0 left-0 right-0 p-3"
          style={autoplayInView ? { paddingBottom: "1.25rem" } : undefined}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="flex cursor-pointer items-center gap-1.5 hover:underline">
              <div
                className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${autoplayInView ? "h-12 w-12 text-base" : "h-5 w-5 text-[9px]"}`}
                style={{ background: `hsl(${post.user.hue} 55% 30%)` }}
              >{post.user.initial}</div>
              <span className={`font-bold text-white/85 drop-shadow-md ${autoplayInView ? "text-xl" : "text-base"}`}>@{post.user.handle}</span>
            </button>
            {autoplayInView && currentUsername !== post.user.handle && (
              <button
                onClick={(e) => { e.stopPropagation(); isFollowingCreator ? unfollowCreator(post.user.handle) : followCreator(post.user.handle); }}
                className={`rounded-full px-3 py-0.5 text-[10px] font-bold transition-colors ${
                  isFollowingCreator
                    ? "bg-white/20 text-white/70 hover:bg-white/15"
                    : "border border-white/40 bg-black/40 text-white hover:bg-white/15"
                }`}
              >{isFollowingCreator ? "Following" : "Follow"}</button>
            )}
          </div>
          <p className={`line-clamp-2 font-bold leading-snug text-white drop-shadow-md ${autoplayInView ? "text-lg" : "text-base"}`}>{post.title}</p>
          {post.remixedFromHandle && (
            <div className="mt-1">
              <span className="flex items-center gap-0.5 text-[8px] text-purple-300/70"><GitBranch size={7} />Remix of @{post.remixedFromHandle}{post.rootParentHandle && <> • Original by @{post.rootParentHandle}</>}</span>
            </div>
          )}
          {/* Static tags — single-column only, max 3 shown permanently */}
          {autoplayInView && (post.tags.length > 0 || (post.channels && post.channels.length > 0)) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {[...(post.channels ?? []), ...post.tags].slice(0, 3).map((tag, i) => (
                <span key={i} className="glass-surface-ghost rounded-full px-2.5 py-0.5 text-xs font-medium text-white/80">
                  {tag.startsWith("#") ? tag : tag}
                </span>
              ))}
              {((post.channels?.length ?? 0) + post.tags.length) > 3 && (
                <span className="self-center text-xs font-medium text-white/40">...</span>
              )}
            </div>
          )}
        </div>

        {/* Grid-mode hover: stronger gradient backdrop + tags float to top */}
        {!autoplayInView && (
          <>
            {/* Reinforced bottom-to-top gradient — activates on hover so username
                and title have contrast against bright video frames */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${hovered ? "opacity-100" : "opacity-0"}`}
              style={{ background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.35) 50%, rgba(0,0,0,0.10) 100%)" }}
            />

            {/* Tags float to the TOP so they never overlap the avatar/username below */}
            <div className={`absolute left-0 right-0 top-0 flex flex-col gap-1 p-3 transition-all duration-200 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"}`}>
              {post.channels && post.channels.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {post.channels.map((ch) => (
                    <span key={ch} className="rounded-full border border-purple-500/25 bg-purple-500/15 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-purple-200">
                      {ch}
                    </span>
                  ))}
                </div>
              )}
              {post.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {post.tags.map((t) => (
                    <span key={t} className="glass-surface-ghost rounded-full px-2.5 py-0.5 text-[10px] font-medium text-white/75">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Delete — bottom-right, positioned above the persistent text block */}
            {onDelete && showDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                className={`absolute bottom-[88px] right-3 transition-all duration-200 ${hovered ? "opacity-100" : "opacity-0"}`}
              >
                <Trash2 size={13} className="text-white/40 hover:text-red-400 transition-colors" />
              </button>
            )}
          </>
        )}

        {/* Electric progress bar — GlobalTicker writes width directly, zero React re-renders */}
        {autoplayInView && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-[10px] bg-black/30">
            <div ref={progressBarRef} className="h-full bg-[#ff007a]" style={{ width: "0%", boxShadow: "0 0 10px #ff007a, 0 0 20px #ff007a66" }} />
          </div>
        )}

        {toast && (
          <div className="pointer-events-none absolute left-1/2 bottom-4 z-30 -translate-x-1/2 rounded-full bg-[#0a0a0a]/80 px-3 py-1 text-[9px] font-semibold text-white/90 backdrop-blur-sm">
            {toast}
          </div>
        )}
      </div>
    </article>
  );
}
