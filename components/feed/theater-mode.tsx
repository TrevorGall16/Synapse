"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Zap, Heart, Share2, Play, Pause, Users } from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";

interface TheaterModeProps {
  post: FeedPost;
  onClose: () => void;
  onRemix: () => void;
  onCreator: () => void;
}

function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

const MOCK_DESC = "A high-energy VJ edit featuring beat-reactive effects and synchronized visuals. Built entirely in Synapse. Remix it and make it your own.";

export function TheaterMode({ post, onClose, onRemix, onCreator }: TheaterModeProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [liked, setLiked] = useState(false);

  // ESC to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Auto-play if video URL present
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !post.videoUrl) return;
    v.play().then(() => setIsPlaying(true)).catch(() => {});
    return () => { v.pause(); };
  }, [post.videoUrl]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) { v.pause(); setIsPlaying(false); }
    else { v.play().then(() => setIsPlaying(true)).catch(() => {}); }
  }, [isPlaying]);

  return (
    <div className="fixed inset-0 z-50 flex bg-black/93 backdrop-blur-md" onClick={onClose}>

      {/* ── Left: video player (70%) ─────────────────────── */}
      <div className="flex flex-[7] items-center justify-center p-6" onClick={(e) => e.stopPropagation()}>
        <div
          className="group relative overflow-hidden rounded-2xl shadow-2xl"
          style={{ aspectRatio: "9/16", maxHeight: "calc(100vh - 48px)", background: post.bg }}
        >
          {/* Animated waveform background */}
          <div className="absolute inset-0 flex items-end gap-[3px] px-3 pb-20 opacity-30" aria-hidden>
            {Array.from({ length: 36 }).map((_, i) => (
              <div key={i} className="flex-1 animate-pulse rounded-t-[2px]"
                style={{ background: post.accent, height: `${18 + Math.sin(i * 0.7) * 40 + (i % 4) * 9}%`, animationDelay: `${(i * 55) % 900}ms` }}
              />
            ))}
          </div>
          <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse 75% 50% at 50% 25%, ${post.accent}35, transparent 65%)` }} />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/75" />

          {/* Real video — visible only when videoUrl exists */}
          <video
            ref={videoRef}
            src={post.videoUrl}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${post.videoUrl ? "opacity-100" : "opacity-0"}`}
            muted loop playsInline
          />

          {/* Play / pause tap zone */}
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/45 backdrop-blur-sm">
              {isPlaying
                ? <Pause size={22} className="text-white" fill="white" />
                : <Play  size={22} className="ml-1 text-white" fill="white" />}
            </div>
          </button>

          {/* Badges */}
          <div className="absolute left-3 top-3 flex gap-1.5">
            {post.featured && <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-bold uppercase text-black">Hot</span>}
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">{post.duration}</span>
          </div>

          {/* Decorative scrubber */}
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
            <div className="h-full w-1/3 rounded-r-full transition-all" style={{ background: post.accent }} />
          </div>
        </div>
      </div>

      {/* ── Right: side panel (30%) ──────────────────────── */}
      <div className="flex flex-[3] flex-col overflow-hidden border-l border-white/8 bg-[#0f0f0f]/90" onClick={(e) => e.stopPropagation()}>
        {/* Header bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-5 py-3.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">Now Viewing</span>
          <button onClick={onClose} className="rounded-lg bg-white/8 p-1.5 text-white/50 transition-colors hover:bg-white/15 hover:text-white">
            <X size={14} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          {/* Creator row */}
          <div className="flex items-center justify-between">
            <button onClick={onCreator} className="flex items-center gap-2.5 text-left">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white/10"
                style={{ background: `hsl(${post.user.hue} 55% 28%)` }}>
                {post.user.initial}
              </div>
              <div>
                <p className="text-xs font-bold text-white">@{post.user.handle}</p>
                <p className="text-[10px] text-white/35">Creator</p>
              </div>
            </button>
            <button className="flex items-center gap-1 rounded-lg border border-white/12 bg-white/6 px-2.5 py-1.5 text-[10px] font-semibold text-white/55 transition-colors hover:bg-white/12 hover:text-white/80">
              <Users size={9} />Follow
            </button>
          </div>

          {/* Title + tags */}
          <div>
            <h2 className="text-[15px] font-bold leading-snug text-white">{post.title}</h2>
            <div className="mt-2 flex flex-wrap gap-1">
              {post.tags.map((t) => (
                <span key={t} className="rounded bg-white/8 px-1.5 py-0.5 text-[9px] font-medium text-white/50">{t}</span>
              ))}
            </div>
          </div>

          {/* Description */}
          <p className="text-[11px] leading-relaxed text-white/50">{post.description ?? MOCK_DESC}</p>

          {/* Stats */}
          <div className="flex items-center gap-5 text-[11px] text-white/35">
            <span><span className="font-bold text-white/60">{fmtK(post.likes + (liked ? 1 : 0))}</span> likes</span>
            <span><span className="font-bold text-white/60">{fmtK(post.comments)}</span> comments</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action buttons */}
          <div className="flex flex-col gap-2.5">
            <button
              onClick={() => setLiked((v) => !v)}
              className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all ${
                liked
                  ? "border border-red-500/30 bg-red-500/15 text-red-300"
                  : "border border-white/10 bg-white/6 text-white/60 hover:bg-white/12"
              }`}
            >
              <Heart size={14} className={liked ? "fill-red-300" : ""} />
              {liked ? "Liked" : "Like"}
            </button>
            <button className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/6 py-2.5 text-sm font-semibold text-white/60 transition-all hover:bg-white/12">
              <Share2 size={14} />Share
            </button>
            <button
              onClick={onRemix}
              className="flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition-all active:scale-[0.98]"
              style={{ background: `${post.accent}cc`, boxShadow: `0 0 20px ${post.accent}44` }}
            >
              <Zap size={14} />Remix in Studio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
