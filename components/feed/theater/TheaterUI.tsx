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

import React, { useState } from "react";
import {
  Zap, Heart, Share2, Play, Pause,
  Eye, MessageCircle, Users, GitBranch, WifiOff, Pencil,
} from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";
import type { MediaPoolItem } from "@/lib/store/types";
import { parseHashtags } from "@/lib/utils/hashtags";
import { ShareSheet } from "../share-sheet";

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
  isCommentsOpen: boolean;
  onToggleComments: () => void;
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
  isCommentsOpen,
  onToggleComments,
}: TheaterUIProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  return (
    <>
      {/* Media pool hydration spinner */}
      {hydratedPool === null && !!post.projectSnapshot?.mediaPool?.length && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#0a0a0a]/80">
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

      {/* Media error indicator */}
      {mediaError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
          <WifiOff size={32} className="text-white/30" />
          <p className="text-xs font-semibold text-white/40">Media Offline</p>
        </div>
      )}

      {/* Bottom fade — deepened to support hero-sized handle + title.
          Black stop raised to 0.9 and scrim extended to 45% so the larger
          typography stays legible on bright/busy video content. */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[35] pointer-events-none"
        style={{ height: "45%", background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 45%, transparent 100%)" }}
      />

      {/* Play/Pause — visible when paused; hidden when playing or idle */}
      <button
        onClick={onTogglePlay}
        className={`absolute inset-x-0 top-0 bottom-12 z-[20] flex items-center justify-center transition-opacity duration-150 ${!isPlaying && !isIdle ? "opacity-100" : "opacity-0"}`}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-[#0a0a0a]/45 backdrop-blur-sm">
          {isPlaying
            ? <Pause size={24} className="text-white" fill="white" />
            : <Play size={24} className="ml-1 text-white" fill="white" />
          }
        </div>
      </button>

      {/* Badges — top-left. The "Hot" badge was removed from the full-screen
          view: in-theater the viewer has already committed to this video, so
          a decorative hot flag is noise. Hot/Trending now lives only on grid
          cards and is computed per-pool via lib/social.isHot. */}
      <div className="absolute left-3 top-3 z-[40] flex items-center gap-1.5">
        {post.duration !== "—" && (
          <span className="rounded-full bg-[#0a0a0a]/60 px-2 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">
            {post.duration}
          </span>
        )}
        {isBlobPost && (
          <span className="rounded-full bg-orange-500/70 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">Local</span>
        )}
        {post.remixedFromHandle && (
          <div className="flex items-center gap-1 rounded-full bg-[#0a0a0a]/60 px-2 py-1 backdrop-blur-sm">
            <GitBranch size={8} className="shrink-0 text-brand-accent" />
            <span className="text-[9px] font-semibold text-brand-text">Remix of @{post.remixedFromHandle}</span>
          </div>
        )}
      </div>

      {/* Play-blocked overlay — covers full cell, cleared on tap */}
      {showPlayOverlay && (
        <button
          onClick={onPlayBlocked}
          className="absolute inset-0 z-30 flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0a0a0a]/60 backdrop-blur-sm"
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/30">
            <Play size={36} className="ml-1.5 text-white" fill="white" />
          </div>
          <span className="text-sm font-bold text-white/80">Tap to Play</span>
        </button>
      )}

      {/* "Click to Unmute" toast */}
      {showUnmuteToast && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-20 -translate-x-1/2 rounded-full bg-[#0a0a0a]/70 px-4 py-1.5 text-[11px] font-semibold text-white/80 backdrop-blur-sm">
          Tap the speaker to unmute
        </div>
      )}

      {/* Info overlay — bottom-left */}
      <div className="absolute bottom-8 left-4 right-20 z-[40] pr-2">
        {/* Author row — avatar & name are clickable */}
        <a
          href={`/profile/${post.user.handle}`}
          aria-label={`Open profile @${post.user.handle}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCreator(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onCreator(); } }}
          className="group mb-2 flex cursor-pointer items-center gap-2.5"
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white/25 transition-transform hover:scale-105 active:scale-95"
            style={{ background: `hsl(${post.user.hue} 55% 28%)` }}
          >
            {post.user.initial}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-white drop-shadow-lg hover:underline" style={TX}>@{post.user.handle}</span>
            {!isOwn && (
              <button
                key={String(following)}
                onClick={(e) => { e.stopPropagation(); onFollowToggle(); }}
                className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold backdrop-blur-sm transition-colors ${
                  following
                    ? "border-brand-accent/40 bg-brand/20 text-brand-muted"
                    : "border-white/25 bg-[#0a0a0a]/50 text-white/80 hover:bg-white/10"
                }`}
                style={{
                  animation: "synapse-follower-pop 420ms cubic-bezier(0.22,1,0.36,1)",
                  transformOrigin: "center",
                }}
              >
                <Users size={8} />{following ? "Following" : "Follow"}
              </button>
            )}
          </div>
        </a>
        <h2 className="mb-2 line-clamp-2 text-3xl font-extrabold tracking-tight leading-tight text-white drop-shadow-lg" style={TX}>
          {post.title}
        </h2>
        {post.description && (
          <p className="mb-2 line-clamp-2 text-base leading-relaxed text-white/90 drop-shadow-lg" style={TX}>
            {parseHashtags(post.description, onHashtagClick)}
          </p>
        )}
        {/* Channel chips — scaled up to text-lg with px-4 py-1.5 so the
            capsule has breathing room around the taller glyphs. */}
        {post.channels && post.channels.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {post.channels.map((ch) => (
              <span
                key={ch}
                className="rounded-full border border-purple-500/30 bg-purple-500/15 px-4 py-1.5 text-lg font-semibold text-purple-200 backdrop-blur-sm drop-shadow-lg"
                style={TX}
              >
                {ch}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {post.tags.map((t) => (
            <button
              key={t}
              onClick={() => onHashtagClick(t)}
              className="rounded-full bg-[#0a0a0a]/50 px-4 py-1.5 text-lg font-medium text-white/85 backdrop-blur-sm drop-shadow-lg hover:bg-brand/20 hover:text-brand-muted transition-colors"
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
          <div className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm transition-all ${liked ? "border-[#ff007a]/50 bg-[#ff007a]/25" : "border-white/15 bg-[#0a0a0a]/40 hover:bg-white/12"}`}>
            <Heart size={20} className={liked ? "fill-[#ff007a] text-[#ff007a]" : "text-[#ff007a]/70"} />
          </div>
          <span className="text-[9px] font-semibold text-white" style={TX}>{fmtKLocal(post.likes + (liked ? 1 : 0))}</span>
        </button>
        {/* Views — mirrors Feed Pillar metric */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#0a0a0a]/40 backdrop-blur-sm">
            <Eye size={20} className="text-[#f59e0b]" />
          </div>
          <span className="text-[9px] font-semibold text-white" style={TX}>{fmtKLocal(post.likes * 10 + post.comments * 20)}</span>
        </div>
        {/* Comment button — code preserved, hidden until comment feature ships */}
        <span className="hidden">
          {post.comments_enabled !== false && (
            <button onClick={onToggleComments} className="flex flex-col items-center gap-1">
              <div className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm transition-all ${
                isCommentsOpen
                  ? "border-brand-accent/40 bg-brand/25"
                  : "border-white/15 bg-[#0a0a0a]/40 hover:bg-white/12"
              }`}>
                <MessageCircle size={20} className={isCommentsOpen ? "text-brand-text" : "text-white"} />
              </div>
              <span className="text-[9px] font-semibold text-white" style={TX}>{fmtKLocal(post.comments)}</span>
            </button>
          )}
        </span>
        {/* Share — uses the shared <ShareSheet> so behavior matches Profile. */}
        <div className="relative">
          <button
            onClick={() => {
              if (!post.id) { showToast("Cannot share — post has no ID"); return; }
              setShareOpen((v) => !v);
            }}
            className="flex cursor-pointer flex-col items-center gap-1"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#0a0a0a]/40 backdrop-blur-sm hover:bg-white/12">
              <Share2 size={20} className="text-[#a855f7]" />
            </div>
            <span className="text-[9px] font-semibold text-white" style={TX}>Share</span>
          </button>
          <ShareSheet
            target={{ kind: "post", id: post.id, title: post.title }}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            positionClassName="absolute right-full mr-2 bottom-0"
          />
        </div>
        {/* Edit (own posts) */}
        {isOwn && (
          <button onClick={() => onRemix(post)} className="flex flex-col items-center gap-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#0a0a0a]/40 backdrop-blur-sm hover:bg-white/15">
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

      {/* Scrubber — pointer-captured for smooth drag-scrub.
          LOCK: Theater seek parity (paused vs playing). The synthetic click that
          follows pointerdown/up must NOT bubble to the cell's togglePlay handler;
          otherwise the user gets a seek + an unintended pause on the same gesture. */}
      <div
        onPointerDown={(e) => { e.stopPropagation(); onSeekPointerDown(e); }}
        onPointerMove={(e) => { e.stopPropagation(); onSeekPointerMove(e); }}
        onPointerUp={(e) => { e.stopPropagation(); onSeekPointerUp(e); }}
        onPointerCancel={(e) => { e.stopPropagation(); onSeekPointerCancel(e); }}
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 left-0 right-0 z-[50] h-2 cursor-pointer touch-none bg-white/15 hover:h-3 transition-all duration-300 ${isIdle && isPlaying ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"}`}
      >
        <div className="pointer-events-none h-full rounded-r-full transition-none" style={{ width: `${progress}%`, background: "#ff007a" }} />
      </div>

      {/* Action toast */}
      {toast && (
        <div className="pointer-events-none absolute left-1/2 bottom-14 z-[60] -translate-x-1/2 rounded-full bg-[#0a0a0a]/80 px-4 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
          {toast}
        </div>
      )}

    </>
  );
}
