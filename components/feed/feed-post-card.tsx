"use client";

import { useRef, useState, useMemo, useEffect, useCallback, useSyncExternalStore } from "react";
import { Heart, MessageCircle, Share2, Zap, Play, Flame, WifiOff, Trash2, GitBranch, Download, Eye } from "lucide-react";
import { type FeedPost, isBlobUrl, useFeedStore, FALLBACK_VIDEO_URL } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";
import { canRemix } from "@/lib/policy";
import { clipCssTransform } from "@/lib/utils/svg-filters";
import { buildTextStyle, buildFxFilter } from "@/lib/utils/preview-helpers";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";
import type { ClipEvent } from "@/lib/store/types";
import { buildPostShareUrl } from "@/lib/utils/share";
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
  // Per-post subscription — cards re-render only when their own like flips,
  // not when any other card's like does. Zustand compares by reference
  // identity, and boolean primitives are referentially stable across renders.
  const liked = useFeedStore((s) => s.likedPostIds.includes(post.id));
  const toggleLike = useFeedStore((s) => s.toggleLike);
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
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sharePopRef = useRef<HTMLDivElement>(null);
  const sharePopPillarRef = useRef<HTMLDivElement>(null);
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
    const onMeta = () => { v.currentTime = firstClipOffset; };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [firstClipSrc, firstClipOffset]);

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

  useEffect(() => {
    if (!shareOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inGrid = sharePopRef.current?.contains(target) ?? false;
      const inPillar = sharePopPillarRef.current?.contains(target) ?? false;
      if (!inGrid && !inPillar) setShareOpen(false);
    };
    document.addEventListener("pointerdown", onClickOutside);
    return () => document.removeEventListener("pointerdown", onClickOutside);
  }, [shareOpen]);

  // Glass Wire progress bar — direct DOM write via GlobalTicker, zero React re-renders.
  useEffect(() => {
    if (!autoplayInView) return;
    const id = registerTickCallback(() => {
      const v = videoRef.current;
      const bar = progressBarRef.current;
      if (!v || !bar || !v.duration || isNaN(v.duration)) return;
      bar.style.width = `${(v.currentTime / v.duration) * 100}%`;
    });
    return () => unregisterTickCallback(id);
  }, [autoplayInView]);

  const handleCopyLink = useCallback(() => {
    if (!post.id) { setToast("Cannot share — post has no ID"); setTimeout(() => setToast(null), 2000); setShareOpen(false); return; }
    const url = buildPostShareUrl(post.id);
    navigator.clipboard.writeText(url).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => { setToast("Failed to copy link"); setTimeout(() => setToast(null), 2000); },
    );
    setTimeout(() => setShareOpen(false), 800);
  }, [post.id]);

  const handleShareTwitter = useCallback(() => {
    if (!post.id) { setToast("Cannot share — post has no ID"); setTimeout(() => setToast(null), 2000); setShareOpen(false); return; }
    const url = buildPostShareUrl(post.id);
    const text = `Check out "${post.title}" on Synapse`;
    window.open(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setShareOpen(false);
  }, [post.id, post.title]);

  const handleShareReddit = useCallback(() => {
    if (!post.id) { setToast("Cannot share — post has no ID"); setTimeout(() => setToast(null), 2000); setShareOpen(false); return; }
    const url = buildPostShareUrl(post.id);
    window.open(
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(post.title)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setShareOpen(false);
  }, [post.id, post.title]);

  const handleComment = () => {
    setToast("Comments coming soon");
    setTimeout(() => setToast(null), 2000);
  };

  const handleMouseEnter = () => {
    setHovered(true);
    const v = videoRef.current;
    if (!v || !firstClipSrc) return;
    // In single-column autoplay, the IntersectionObserver already owns playback.
    // Seamlessly "inherit" the currently-playing stream instead of slamming
    // currentTime back to 0 — that caused a visible re-buffer on hover.
    if (autoplayInView && !v.paused) return;
    v.currentTime = firstClipOffset;
    v.play().catch(() => {});
  };
  const handleMouseLeave = () => {
    setHovered(false);
    const v = videoRef.current;
    if (!v) return;
    // Autoplay feed keeps the stream running until it scrolls out of view.
    if (autoplayInView) return;
    v.pause();
    v.currentTime = firstClipOffset;
  };

  return (
    <article
      ref={articleRef}
      // aspect-[9/16] + w-full + h-auto locks the TikTok-style portrait
      // rectangle in CSS, so the browser reserves the correct card box before
      // the virtualizer's row math settles. Stripping this made cards collapse
      // to a square during the first paint on wide monitors.
      className="group relative aspect-[9/16] h-auto w-full cursor-pointer overflow-hidden rounded-xl transition-transform duration-300 ease-out hover:z-10 hover:scale-[1.05]"
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

        {/* Persistent bottom-left metadata — enhanced in single-column, fades on hover in grid */}
        <div
          className={`absolute bottom-0 left-0 right-0 p-3 transition-all duration-200 ${!autoplayInView && hovered ? "opacity-0 translate-y-1" : ""}`}
          style={autoplayInView ? { paddingRight: "4.5rem", paddingBottom: "1rem" } : undefined}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="flex cursor-pointer items-center gap-1.5 hover:underline">
              <div
                className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${autoplayInView ? "h-8 w-8 text-sm" : "h-5 w-5 text-[9px]"}`}
                style={{ background: `hsl(${post.user.hue} 55% 30%)` }}
              >{post.user.initial}</div>
              <span className={`font-semibold text-white/85 drop-shadow-md ${autoplayInView ? "text-lg" : "text-base"}`}>@{post.user.handle}</span>
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
          <p className="line-clamp-2 text-base font-bold leading-snug text-white drop-shadow-md">{post.title}</p>
          {post.remixedFromHandle && (
            <div className="mt-1">
              <span className="flex items-center gap-0.5 text-[8px] text-purple-300/70"><GitBranch size={7} />Remix of @{post.remixedFromHandle}{post.rootParentHandle && <> • Original by @{post.rootParentHandle}</>}</span>
            </div>
          )}
        </div>

        {/* Hover overlay — actions slide up */}
        <div className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/30 to-transparent p-3 transition-all duration-200 ${autoplayInView ? "pr-16" : ""} ${hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}>
          <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="mb-1.5 flex cursor-pointer items-center gap-1.5 hover:underline">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ring-1 ring-white/20" style={{ background: `hsl(${post.user.hue} 55% 30%)` }}>{post.user.initial}</div>
            <span className="text-base font-semibold text-white/90 drop-shadow-md">@{post.user.handle}</span>
          </button>
          <p className="mb-1.5 text-base font-bold leading-snug text-white drop-shadow-md">{post.title}</p>
          {post.remixedFromHandle && (
            <div className="mb-1">
              <span className="flex items-center gap-0.5 text-[8px] text-purple-300/70"><GitBranch size={7} />Remix of @{post.remixedFromHandle}{post.rootParentHandle && <> • Original by @{post.rootParentHandle}</>}</span>
            </div>
          )}
          {post.channels && post.channels.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {post.channels.map((ch) => <span key={ch} className="rounded-full border border-purple-500/25 bg-purple-500/15 px-2 py-px text-[9px] font-bold tracking-wide text-purple-200">{ch}</span>)}
            </div>
          )}
          <div className="mb-2 flex flex-wrap gap-1">
            {post.tags.map((t) => <span key={t} className="rounded bg-white/10 px-1 py-px text-[8px] text-white/50">{t}</span>)}
          </div>
          <div className={`flex items-center ${autoplayInView ? "justify-end" : "justify-between"}`}>
            {!autoplayInView && (
              <div className="flex items-center gap-3">
                <button onClick={(e) => { e.stopPropagation(); toggleLike(post.id); }} className="flex items-center gap-0.5 text-[10px] text-white/60 transition-colors hover:text-red-400">
                  <Heart size={11} className={liked ? "fill-red-400 text-red-400" : ""} /><span>{fmtK(post.likes + (liked ? 1 : 0))}</span>
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleComment(); }} className="flex items-center gap-0.5 text-[10px] text-white/60 hover:text-white/90">
                  <MessageCircle size={11} /><span>{fmtK(post.comments)}</span>
                </button>
                <div className="relative" ref={sharePopRef}>
                  <button onClick={(e) => { e.stopPropagation(); setShareOpen((v) => !v); }} className="text-white/60 hover:text-white/90"><Share2 size={11} /></button>
                  {shareOpen && (
                    <div
                      className="absolute left-1/2 bottom-full mb-1.5 z-[60] min-w-[150px] -translate-x-1/2 rounded-xl border border-white/20 py-1.5 shadow-2xl"
                      style={{ background: "rgba(30,30,30,0.75)", backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button onClick={handleCopyLink} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10">
                        {copied ? <span className="text-emerald-400">✓ Copied!</span> : "Copy Link"}
                      </button>
                      <button onClick={handleShareTwitter} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10">
                        Share to X
                      </button>
                      <button onClick={handleShareReddit} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10">
                        Share to Reddit
                      </button>
                    </div>
                  )}
                </div>
                {onDelete && showDelete && (
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                    className="flex items-center gap-0.5 text-[10px] text-white/40 transition-colors hover:text-red-400">
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              {onImport && (
                <button onClick={(e) => { e.stopPropagation(); onImport(); }}
                  className="flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1.5 text-[10px] font-semibold text-white/60 transition-all hover:bg-white/8 active:scale-95"
                  title="Import to Media Pool"
                ><Download size={9} />Import</button>
              )}
              {canRemix(post) && (
                <button onClick={(e) => { e.stopPropagation(); onRemix(); }}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white transition-all active:scale-95"
                  style={{ background: `${post.accent}dd`, boxShadow: `0 0 10px ${post.accent}50` }}
                ><Zap size={9} />Remix</button>
              )}
            </div>
          </div>
        </div>
        {/* Single-column action pillar — persistent social triggers, no backdrop-filter blur (mobile GPU guardrail) */}
        {autoplayInView && (
          <div className="absolute bottom-28 right-3 z-20 flex flex-col items-center gap-5">
            <button onClick={(e) => { e.stopPropagation(); toggleLike(post.id); }} className="flex flex-col items-center gap-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white drop-shadow-md">
                <Heart size={20} className={liked ? "fill-red-400 text-red-400" : ""} />
              </div>
              <span className="text-[9px] font-bold text-white drop-shadow-md">{fmtK(post.likes + (liked ? 1 : 0))}</span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleComment(); }} className="flex flex-col items-center gap-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white drop-shadow-md">
                <MessageCircle size={20} />
              </div>
              <span className="text-[9px] font-bold text-white drop-shadow-md">{fmtK(post.comments)}</span>
            </button>
            <div className="relative flex flex-col items-center gap-1" ref={sharePopPillarRef}>
              <button onClick={(e) => { e.stopPropagation(); setShareOpen((v) => !v); }} className="flex flex-col items-center gap-1">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white drop-shadow-md">
                  <Share2 size={20} />
                </div>
                <span className="text-[9px] font-bold text-white drop-shadow-md">Share</span>
              </button>
              {shareOpen && (
                <div
                  className="absolute right-full bottom-0 z-[60] mr-2 min-w-[150px] rounded-xl border border-white/20 py-1.5 shadow-2xl"
                  style={{ background: "rgba(30,30,30,0.75)", backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button onClick={handleCopyLink} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10">
                    {copied ? <span className="text-emerald-400">✓ Copied!</span> : "Copy Link"}
                  </button>
                  <button onClick={handleShareTwitter} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10">
                    Share to X
                  </button>
                  <button onClick={handleShareReddit} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10">
                    Share to Reddit
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white drop-shadow-md">
                <Eye size={20} />
              </div>
              <span className="text-[9px] font-bold text-white drop-shadow-md">{fmtK(post.likes * 10 + post.comments * 20)}</span>
            </div>
          </div>
        )}

        {/* Glass Wire progress bar — GlobalTicker writes width directly, zero React re-renders */}
        {autoplayInView && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-[2px] bg-white/10">
            <div ref={progressBarRef} className="h-full bg-white/60" style={{ width: "0%" }} />
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
