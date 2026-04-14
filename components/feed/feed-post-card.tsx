"use client";

import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { Heart, MessageCircle, Share2, Zap, Play, Flame, WifiOff, Trash2, GitBranch, Download } from "lucide-react";
import { type FeedPost, isBlobUrl, useFeedStore, FALLBACK_VIDEO_URL } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";
import { canRemix } from "@/lib/policy";
import { clipCssTransform } from "@/lib/utils/svg-filters";
import { buildTextStyle, buildFxFilter } from "@/lib/utils/preview-helpers";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";
import type { ClipEvent } from "@/lib/store/types";
import { buildPostShareUrl } from "@/lib/utils/share";
import { isHot } from "@/lib/social";

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
}

export function FeedPostCard({ post, onOpen, onRemix, onCreator, onDelete, onImport, showDelete, pool }: FeedPostCardProps) {
  const currentUsername = useUserStore((s) => s.profile?.username);
  const likedPostIds = useFeedStore((s) => s.likedPostIds);
  const toggleLike   = useFeedStore((s) => s.toggleLike);
  const liked = likedPostIds.includes(post.id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [mediaOffline, setMediaOffline] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Gate client-only renders to prevent SSR/hydration mismatch from Math.sin() bar heights
  const [mounted, setMounted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sharePopRef = useRef<HTMLDivElement>(null);
  const isBlob = isBlobUrl(post.videoUrl);

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

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !firstClipSrc) return;
    const onMeta = () => { v.currentTime = firstClipOffset; };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [firstClipSrc, firstClipOffset]);

  // Hover FX preview — drive `buildFxFilter` per tick using the SHARED helper
  // that Studio and Theater use, so animated effects (hue-rotate speed, strobe,
  // glitch, flash) preview with byte-identical math. Only runs while hovered;
  // styles are cleared on exit to preserve static-thumbnail color purity.
  useEffect(() => {
    if (!hovered || activeEffectClips.length === 0) return;
    const v = videoRef.current;
    if (!v) return;
    const baseTransform = firstClipTransform;
    const id = registerTickCallback(() => {
      // Translate video's media time → timeline microseconds so buildFxFilter
      // evaluates the effect at the *same* playhead Theater would compute.
      const timelineUs = firstClipStart + (v.currentTime * 1_000_000 - firstClipMediaOffsetUs);
      const fx = buildFxFilter(activeEffectClips, timelineUs);
      v.style.filter = fx.filter === "none" ? "" : fx.filter;
      const transformParts: string[] = [];
      if (baseTransform) transformParts.push(baseTransform);
      if (fx.mirrorTransform) transformParts.push(fx.mirrorTransform);
      if (fx.glitchTransform) transformParts.push(fx.glitchTransform);
      v.style.transform = transformParts.join(" ");
    });
    return () => {
      unregisterTickCallback(id);
      // Clear FX styles on hover exit — the static thumbnail must look identical
      // to the published preview frame (no lingering color drift, no transform).
      v.style.filter = "";
      v.style.transform = "";
    };
  }, [hovered, activeEffectClips, firstClipStart, firstClipMediaOffsetUs, firstClipTransform]);

  useEffect(() => {
    if (!shareOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (sharePopRef.current && !sharePopRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    };
    document.addEventListener("pointerdown", onClickOutside);
    return () => document.removeEventListener("pointerdown", onClickOutside);
  }, [shareOpen]);

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
    if (videoRef.current && firstClipSrc) { videoRef.current.currentTime = firstClipOffset; videoRef.current.play().catch(() => {}); }
  };
  const handleMouseLeave = () => {
    setHovered(false);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = firstClipOffset; }
  };

  return (
    <article
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-all duration-200 hover:border-white/20 hover:shadow-2xl hover:-translate-y-0.5"
      onClick={() => { videoRef.current?.play().catch(() => {}); onOpen(); }}
      onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
    >
      <div className="relative" style={{ aspectRatio: "9/16", background: post.bg }}>
        {/* Delete confirmation overlay — only reachable when showDelete is true */}
        {confirmDelete && showDelete && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
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

        {/* Video */}
        <video ref={videoRef} src={firstClipSrc || undefined}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[150ms] ${firstClipSrc && !mediaOffline ? "opacity-100" : "opacity-0"}`}
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
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60">
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
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />

        {pool && isHot(post, pool) && (
          <span className="absolute left-2.5 top-2.5 flex items-center gap-0.5 rounded-full bg-amber-400/90 px-1.5 py-0.5 text-[8px] font-bold uppercase text-black">
            <Flame size={7} />Hot
          </span>
        )}
        {isBlob && !hovered && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-orange-500/70 px-1.5 py-0.5 text-[8px] font-semibold text-white">Local</span>
        )}
        {post.duration !== "—" && !hovered && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">{post.duration}</span>
        )}

        {/* Play icon (fades out on hover) */}
        <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${hovered ? "opacity-0" : ""}`}>
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/30 backdrop-blur-sm">
            <Play size={14} className="ml-0.5 text-white" fill="white" />
          </div>
        </div>

        {/* Default bottom info (fades on hover) */}
        <div className={`absolute bottom-0 left-0 right-0 p-3 transition-all duration-200 ${hovered ? "opacity-0 translate-y-1" : ""}`}>
          <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="mb-1 flex cursor-pointer items-center gap-1.5 hover:underline">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: `hsl(${post.user.hue} 55% 30%)` }}>{post.user.initial}</div>
            <span className="text-[10px] font-medium text-white/70">@{post.user.handle}</span>
          </button>
          <p className="line-clamp-2 text-[11px] font-bold leading-snug text-white">{post.title}</p>
          {post.remixedFromHandle && (
            <div className="mt-1">
              <span className="flex items-center gap-0.5 text-[8px] text-purple-300/70"><GitBranch size={7} />Remix of @{post.remixedFromHandle}{post.rootParentHandle && <> • Original by @{post.rootParentHandle}</>}</span>
            </div>
          )}
        </div>

        {/* Hover overlay — actions slide up */}
        <div className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/30 to-transparent p-3 transition-all duration-200 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}>
          <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="mb-1.5 flex cursor-pointer items-center gap-1.5 hover:underline">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ring-1 ring-white/20" style={{ background: `hsl(${post.user.hue} 55% 30%)` }}>{post.user.initial}</div>
            <span className="text-[10px] font-semibold text-white/80">@{post.user.handle}</span>
          </button>
          <p className="mb-1 text-xs font-bold leading-snug text-white">{post.title}</p>
          {post.remixedFromHandle && (
            <div className="mb-1">
              <span className="flex items-center gap-0.5 text-[8px] text-purple-300/70"><GitBranch size={7} />Remix of @{post.remixedFromHandle}{post.rootParentHandle && <> • Original by @{post.rootParentHandle}</>}</span>
            </div>
          )}
          {post.channels && post.channels.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {post.channels.map((ch) => <span key={ch} className="rounded-full border border-purple-500/25 bg-purple-500/15 px-1.5 py-px text-[8px] font-semibold text-purple-200">{ch}</span>)}
            </div>
          )}
          <div className="mb-2 flex flex-wrap gap-1">
            {post.tags.map((t) => <span key={t} className="rounded bg-white/10 px-1 py-px text-[8px] text-white/50">{t}</span>)}
          </div>
          <div className="flex items-center justify-between">
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
        {toast && (
          <div className="pointer-events-none absolute left-1/2 bottom-4 z-30 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-[9px] font-semibold text-white/90 backdrop-blur-sm">
            {toast}
          </div>
        )}
      </div>
    </article>
  );
}
