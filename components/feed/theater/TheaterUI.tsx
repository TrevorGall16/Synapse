"use client";

/**
 * components/feed/theater/TheaterUI.tsx
 *
 * All interactive and decorative chrome for a Theater cell:
 * loading covers, error states, play/pause, info overlay, action column, scrubber.
 *
 * Receives display state and callbacks from TheaterPlayer — no store subscriptions,
 * no refs, no playback logic. Pure rendering layer.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Zap, Heart, Share2, Play, Pause,
  MessageCircle, Users, GitBranch, WifiOff, Pencil,
} from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";
import type { MediaPoolItem } from "@/lib/store/types";
import { parseHashtags } from "@/lib/utils/hashtags";
import { buildPostShareUrl } from "@/lib/utils/share";

// ── Shared render helpers (duplicated from TheaterPlayer to avoid circular import) ──
const fmtKLocal = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const TX: React.CSSProperties = {
  textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,1)",
  WebkitTextStroke: "0.5px rgba(0,0,0,0.7)",
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TheaterUIProps {
  post: FeedPost;
  progress: number;
  isPlaying: boolean;
  isIdle: boolean;
  videoVisible: boolean;
  mediaError: boolean;
  following: boolean;
  liked: boolean;
  isOwn: boolean;
  showPlayOverlay: boolean;
  showUnmuteToast: boolean;
  /** null = still loading blob URLs; non-null = ready (may be empty) */
  hydratedPool: MediaPoolItem[] | null;
  remixAllowed: boolean;
  isBlobPost: boolean;
  onTogglePlay: () => void;
  onSeekPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onSeekPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onSeekPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onSeekPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  onFollowToggle: () => void;
  onToggleLike: () => void;
  /** Called when the "tap to play" blocked overlay is tapped — marks interaction + toggles play */
  onPlayBlocked: () => void;
  onRemix: (post: FeedPost) => void;
  onCreator: () => void;
  onHashtagClick: (tag: string) => void;
  blurSrc?: string;
  isCommentsOpen: boolean;
  onToggleComments: () => void;
  /** Whether the main video is vertical (aspect < 1) — used to skip blur rendering */
  isVerticalVideo?: boolean;
}

// ── TheaterUI ─────────────────────────────────────────────────────────────────

export function TheaterUI({
  post,
  progress,
  isPlaying,
  isIdle,
  videoVisible,
  mediaError,
  following,
  liked,
  isOwn,
  showPlayOverlay,
  showUnmuteToast,
  hydratedPool,
  remixAllowed,
  isBlobPost,
  onTogglePlay,
  onSeekPointerDown,
  onSeekPointerMove,
  onSeekPointerUp,
  onSeekPointerCancel,
  onFollowToggle,
  onToggleLike,
  onPlayBlocked,
  onRemix,
  onCreator,
  onHashtagClick,
  blurSrc,
  isCommentsOpen,
  onToggleComments,
  isVerticalVideo,
}: TheaterUIProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const sharePopRef = useRef<HTMLDivElement>(null);
  const blurRef = useRef<HTMLVideoElement>(null);

  // Sync blur video play/pause with main video state
  // Skip entirely for vertical video — blur is invisible behind black bars
  useEffect(() => {
    const blur = blurRef.current;
    if (!blur) return;
    if (isVerticalVideo) {
      blur.pause();
      blur.removeAttribute("src");
      blur.load();
      return;
    }
    if (isPlaying) {
      blur.play().catch(() => {});
    } else {
      blur.pause();
    }
  }, [isPlaying, isVerticalVideo]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

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
    if (!post.id) { showToast("Cannot share — post has no ID"); setShareOpen(false); return; }
    const url = buildPostShareUrl(post.id);
    navigator.clipboard.writeText(url).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => showToast("Failed to copy link"),
    );
    setTimeout(() => setShareOpen(false), 800);
  }, [post.id]);

  const handleShareTwitter = useCallback(() => {
    if (!post.id) { showToast("Cannot share — post has no ID"); setShareOpen(false); return; }
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
    if (!post.id) { showToast("Cannot share — post has no ID"); setShareOpen(false); return; }
    const url = buildPostShareUrl(post.id);
    window.open(
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(post.title)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setShareOpen(false);
  }, [post.id, post.title]);

  return (
    <>
      {/* Black cover during initial load — sits below video (z-[2] vs video z-[10]) */}
      {!videoVisible && !mediaError && <div className="absolute inset-0 z-[2] bg-black" />}

      {/* Media pool hydration spinner */}
      {hydratedPool === null && !!post.projectSnapshot?.mediaPool?.length && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
          <p className="text-[10px] text-white/50">Loading media…</p>
        </div>
      )}

      {/* Waveform BG on error */}
      <div
        className={`absolute inset-0 flex items-end gap-[3px] px-3 pb-28 transition-opacity duration-300 ${mediaError ? "opacity-20" : "opacity-0"}`}
        aria-hidden
      >
        {Array.from({ length: 40 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-t-[2px]"
            style={{
              background: post.accent,
              height: `${18 + Math.sin(i * 0.7) * 40 + (i % 4) * 9}%`,
              animationDelay: `${(i * 55) % 900}ms`,
            }}
          />
        ))}
      </div>

      {/* Depth gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/60" />

      {/* Media error indicator */}
      {mediaError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
          <WifiOff size={32} className="text-white/30" />
          <p className="text-xs font-semibold text-white/40">Media Offline</p>
        </div>
      )}

      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[35] pointer-events-none"
        style={{ height: "35%", background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }}
      />

      {/* Play/Pause — visible when paused; hidden when playing or idle */}
      <button
        onClick={onTogglePlay}
        className={`absolute inset-x-0 top-0 bottom-12 z-[20] flex items-center justify-center transition-opacity duration-150 ${!isPlaying && !isIdle ? "opacity-100" : "opacity-0"}`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/45 backdrop-blur-sm">
          {isPlaying
            ? <Pause size={24} className="text-white" fill="white" />
            : <Play size={24} className="ml-1 text-white" fill="white" />
          }
        </div>
      </button>

      {/* Badges — top-left */}
      <div className="absolute left-3 top-3 z-[40] flex items-center gap-1.5">
        {post.featured && (
          <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-bold uppercase text-black">Hot</span>
        )}
        {post.duration !== "—" && (
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">
            {post.duration}
          </span>
        )}
        {isBlobPost && (
          <span className="rounded-full bg-orange-500/70 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">Local</span>
        )}
        {post.remixedFromHandle && (
          <div className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 backdrop-blur-sm">
            <GitBranch size={8} className="shrink-0 text-brand-accent" />
            <span className="text-[9px] font-semibold text-brand-text">Remix of @{post.remixedFromHandle}</span>
          </div>
        )}
      </div>

      {/* Play-blocked overlay — covers full cell, cleared on tap */}
      {showPlayOverlay && (
        <button
          onClick={onPlayBlocked}
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

      {/* Info overlay — bottom-left */}
      <div className="absolute bottom-8 left-4 right-20 z-[40] pr-2">
        {/* Author row — avatar & name are clickable */}
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onCreator(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onCreator(); } }}
          className="mb-2 flex cursor-pointer items-center gap-2.5"
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white/25 transition-transform hover:scale-105 active:scale-95"
            style={{ background: `hsl(${post.user.hue} 55% 28%)` }}
          >
            {post.user.initial}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white hover:underline" style={TX}>@{post.user.handle}</span>
            {!isOwn && (
              <button
                onClick={(e) => { e.stopPropagation(); onFollowToggle(); }}
                className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur-sm transition-colors ${
                  following
                    ? "border-brand-accent/40 bg-brand/20 text-brand-muted"
                    : "border-white/25 bg-black/50 text-white/80 hover:bg-white/10"
                }`}
              >
                <Users size={8} />{following ? "Following" : "Follow"}
              </button>
            )}
          </div>
        </div>
        <h2 className="mb-1.5 line-clamp-2 text-xl font-bold leading-snug text-white" style={TX}>
          {post.title}
        </h2>
        {post.description && (
          <p className="mb-2 line-clamp-2 text-base leading-relaxed text-white/90" style={TX}>
            {parseHashtags(post.description, onHashtagClick)}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {post.tags.map((t) => (
            <button
              key={t}
              onClick={() => onHashtagClick(t)}
              className="rounded-full bg-black/50 px-2 py-0.5 text-base font-medium text-white/85 backdrop-blur-sm hover:bg-brand/20 hover:text-brand-muted transition-colors"
              style={TX}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Action column — right sidebar */}
      <div className="absolute bottom-14 right-3 z-[40] flex flex-col items-center gap-3">
        {/* Like */}
        <button onClick={onToggleLike} className="flex flex-col items-center gap-1">
          <div className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm transition-all ${liked ? "border-red-500/40 bg-red-500/30" : "border-white/15 bg-black/40 hover:bg-white/12"}`}>
            <Heart size={20} className={liked ? "fill-red-400 text-red-400" : "text-white"} />
          </div>
          <span className="text-[9px] font-semibold text-white" style={TX}>{fmtKLocal(post.likes + (liked ? 1 : 0))}</span>
        </button>
        {/* Comment — hidden when creator disables comments */}
        {post.comments_enabled !== false && (
          <button onClick={onToggleComments} className="flex flex-col items-center gap-1">
            <div className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm transition-all ${
              isCommentsOpen
                ? "border-brand-accent/40 bg-brand/25"
                : "border-white/15 bg-black/40 hover:bg-white/12"
            }`}>
              <MessageCircle size={20} className={isCommentsOpen ? "text-brand-text" : "text-white"} />
            </div>
            <span className="text-[9px] font-semibold text-white" style={TX}>{fmtKLocal(post.comments)}</span>
          </button>
        )}
        {/* Share */}
        <div className="relative" ref={sharePopRef}>
          <button onClick={() => setShareOpen((v) => !v)} className="flex flex-col items-center gap-1">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm hover:bg-white/12">
              <Share2 size={20} className="text-white" />
            </div>
            <span className="text-[9px] font-semibold text-white" style={TX}>Share</span>
          </button>
          {shareOpen && (
            <div
              className="absolute right-full mr-2 bottom-0 z-[60] min-w-[150px] rounded-xl border border-white/20 py-1.5 shadow-2xl"
              style={{ background: "rgba(30,30,30,0.75)", backdropFilter: "blur(16px) saturate(180%)", WebkitBackdropFilter: "blur(16px) saturate(180%)" }}
            >
              <button
                onClick={handleCopyLink}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10"
              >
                {copied ? <span className="text-emerald-400">✓ Copied!</span> : "Copy Link"}
              </button>
              <button
                onClick={handleShareTwitter}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10"
              >
                Share to X
              </button>
              <button
                onClick={handleShareReddit}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10"
              >
                Share to Reddit
              </button>
            </div>
          )}
        </div>
        {/* Edit (own posts) */}
        {isOwn && (
          <button onClick={() => onRemix(post)} className="flex flex-col items-center gap-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm hover:bg-white/15">
              <Pencil size={15} className="text-white/80" />
            </div>
            <span className="text-[9px] font-semibold text-white/70" style={TX}>Edit</span>
          </button>
        )}
        {/* Remix */}
        <button
          onClick={remixAllowed ? () => onRemix(post) : undefined}
          className={`flex flex-col items-center gap-1 ${remixAllowed ? "" : "opacity-35 cursor-not-allowed"}`}
        >
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95"
            style={remixAllowed
              ? { background: post.accent, boxShadow: `0 0 28px ${post.accent}99` }
              : { background: "#333" }
            }
          >
            <Zap size={26} className="text-white" fill="white" />
          </div>
          <span className="text-[9px] font-bold text-white" style={TX}>{remixAllowed ? "Remix" : "No Remix"}</span>
        </button>
      </div>

      {/* Scrubber — pointer-captured for smooth drag-scrub */}
      <div
        onPointerDown={(e) => { e.stopPropagation(); onSeekPointerDown(e); }}
        onPointerMove={(e) => { e.stopPropagation(); onSeekPointerMove(e); }}
        onPointerUp={(e) => { e.stopPropagation(); onSeekPointerUp(e); }}
        onPointerCancel={(e) => { e.stopPropagation(); onSeekPointerCancel(e); }}
        className={`absolute bottom-0 left-0 right-0 z-[50] h-2 cursor-pointer touch-none bg-white/15 hover:h-3 transition-all duration-300 ${isIdle && isPlaying ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"}`}
      >
        <div className="pointer-events-none h-full rounded-r-full transition-none" style={{ width: `${progress}%`, background: post.accent }} />
      </div>

      {/* Action toast */}
      {toast && (
        <div className="pointer-events-none absolute left-1/2 bottom-14 z-[60] -translate-x-1/2 rounded-full bg-black/80 px-4 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
          {toast}
        </div>
      )}

      {/* Mirror blur — fixed behind the entire cell, synced to main video.
          Vertical videos (aspect < 1) skip rendering entirely for zero CPU hit. */}
      {blurSrc && !isVerticalVideo && (
        <video
          ref={blurRef}
          src={blurSrc}
          className="fixed inset-0 w-full h-full object-cover blur-3xl opacity-60 scale-110 -z-[1] pointer-events-none"
          muted
          playsInline
        />
      )}
    </>
  );
}
