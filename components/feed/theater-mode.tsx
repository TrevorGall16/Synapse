"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { X, Zap, Heart, Share2, Play, Pause, MessageCircle, Users } from "lucide-react";
import type { FeedPost } from "@/lib/store/feed-store";

interface TheaterModeProps {
  post: FeedPost;
  onClose: () => void;
  onRemix: () => void;
  onCreator: () => void;
  allPosts?: FeedPost[];
  onNavigate?: (post: FeedPost) => void;
}

function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

// ── Mini card for Similar Content ─────────────────────────────────────────────
function MiniCard({ post, onNavigate }: { post: FeedPost; onNavigate: () => void }) {
  return (
    <article
      className="cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-all hover:border-white/20 hover:-translate-y-0.5"
      onClick={onNavigate}
    >
      <div className="relative" style={{ aspectRatio: "9/16", background: post.bg }}>
        <div className="absolute inset-0 flex items-end gap-[2px] px-1.5 pb-14 opacity-15" aria-hidden>
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="flex-1 rounded-t-[2px]"
              style={{ background: post.accent, height: `${18 + Math.sin(i * 0.75) * 38 + (i % 5) * 8}%` }}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80" />
        <div className="absolute inset-x-0 bottom-0 p-2">
          <p className="line-clamp-2 text-[9px] font-bold leading-snug text-white">{post.title}</p>
          <p className="mt-0.5 text-[8px] text-white/40">@{post.user.handle}</p>
        </div>
      </div>
    </article>
  );
}

// ── Theater Mode (TikTok-style vertical) ──────────────────────────────────────
export function TheaterMode({ post, onClose, onRemix, onCreator, allPosts = [], onNavigate }: TheaterModeProps) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [liked, setLiked]         = useState(false);

  // Scroll to top whenever we navigate to a new post
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [post.id]);

  // ESC to close
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

  // Auto-play on open
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

  // Similar: share at least one tag, cap at 12
  const similarPosts = allPosts
    .filter((p) => p.id !== post.id && p.tags.some((t) => post.tags.includes(t)))
    .slice(0, 12);

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 overflow-y-auto bg-black">

      {/* Close — fixed top-right */}
      <button
        onClick={onClose}
        className="fixed right-4 top-4 z-[60] flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/15 hover:text-white"
      >
        <X size={15} />
      </button>

      {/* ── Full-screen video section ──────────────────────────────────────── */}
      <section className="relative flex min-h-screen items-center justify-center px-4 py-4">
        <div
          className="group relative overflow-hidden rounded-2xl shadow-2xl"
          style={{ aspectRatio: "9/16", height: "calc(100vh - 32px)", background: post.bg }}
        >
          {/* Animated waveform background */}
          <div className="absolute inset-0 flex items-end gap-[3px] px-3 pb-28 opacity-20" aria-hidden>
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className="flex-1 animate-pulse rounded-t-[2px]"
                style={{ background: post.accent, height: `${18 + Math.sin(i * 0.7) * 40 + (i % 4) * 9}%`, animationDelay: `${(i * 55) % 900}ms` }}
              />
            ))}
          </div>
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse 75% 50% at 50% 25%, ${post.accent}35, transparent 65%)` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/90" />

          {/* Video */}
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
                ? <Pause size={24} className="text-white" fill="white" />
                : <Play  size={24} className="ml-1 text-white" fill="white" />}
            </div>
          </button>

          {/* Badges */}
          <div className="absolute left-3 top-3 flex gap-1.5">
            {post.featured && <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-bold uppercase text-black">Hot</span>}
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] tabular-nums text-white/70 backdrop-blur-sm">{post.duration}</span>
          </div>

          {/* ── Info overlay — bottom-left ───────────────────────────────── */}
          <div className="absolute bottom-6 left-4 right-20 pr-2">
            <button onClick={onCreator} className="mb-2.5 flex items-center gap-2 text-left">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white/20"
                style={{ background: `hsl(${post.user.hue} 55% 28%)` }}
              >
                {post.user.initial}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white drop-shadow">@{post.user.handle}</span>
                <span className="flex items-center gap-0.5 rounded-full border border-white/25 bg-black/40 px-1.5 py-0.5 text-[8px] font-semibold text-white/70 backdrop-blur-sm">
                  <Users size={7} />Follow
                </span>
              </div>
            </button>
            <h2 className="mb-1 line-clamp-2 text-sm font-bold leading-snug text-white drop-shadow">{post.title}</h2>
            {post.description && (
              <p className="mb-2 line-clamp-2 text-[10px] leading-relaxed text-white/65 drop-shadow">{post.description}</p>
            )}
            <div className="flex flex-wrap gap-1">
              {post.tags.map((t) => (
                <span key={t} className="rounded bg-white/12 px-1.5 py-0.5 text-[8px] font-medium text-white/60 backdrop-blur-sm">{t}</span>
              ))}
            </div>
          </div>

          {/* ── Action column — bottom-right ─────────────────────────────── */}
          <div className="absolute bottom-4 right-3 flex flex-col items-center gap-4">
            {/* Like */}
            <button onClick={() => setLiked((v) => !v)} className="flex flex-col items-center gap-1">
              <div className={`flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm transition-all ${
                liked ? "border-red-500/40 bg-red-500/30" : "border-white/15 bg-black/40 hover:bg-white/12"
              }`}>
                <Heart size={20} className={liked ? "fill-red-400 text-red-400" : "text-white"} />
              </div>
              <span className="text-[9px] font-semibold text-white/60">{fmtK(post.likes + (liked ? 1 : 0))}</span>
            </button>

            {/* Comment */}
            <button className="flex flex-col items-center gap-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm transition-colors hover:bg-white/12">
                <MessageCircle size={20} className="text-white" />
              </div>
              <span className="text-[9px] font-semibold text-white/60">{fmtK(post.comments)}</span>
            </button>

            {/* Share */}
            <button className="flex flex-col items-center gap-1">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 backdrop-blur-sm transition-colors hover:bg-white/12">
                <Share2 size={20} className="text-white" />
              </div>
              <span className="text-[9px] font-semibold text-white/60">Share</span>
            </button>

            {/* Remix — largest, most prominent */}
            <button onClick={onRemix} className="flex flex-col items-center gap-1">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95"
                style={{ background: post.accent, boxShadow: `0 0 28px ${post.accent}99, 0 0 10px ${post.accent}55` }}
              >
                <Zap size={26} className="text-white" fill="white" />
              </div>
              <span className="text-[9px] font-bold text-white">Remix</span>
            </button>
          </div>

          {/* Decorative scrubber */}
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
            <div className="h-full w-1/3 rounded-r-full" style={{ background: post.accent }} />
          </div>
        </div>
      </section>

      {/* ── Similar Content ────────────────────────────────────────────────── */}
      {similarPosts.length > 0 && (
        <section className="bg-[#0f0f0f] px-5 pb-12 pt-6">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/30">Similar Content</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {similarPosts.map((p) => (
              <MiniCard key={p.id} post={p} onNavigate={() => onNavigate?.(p)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
