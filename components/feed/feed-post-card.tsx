"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import { Heart, MessageCircle, Share2, Zap, Play, Flame, WifiOff, Trash2 } from "lucide-react";
import { type FeedPost, isBlobUrl } from "@/lib/store/feed-store";
import { cleanupSnapshotMedia } from "@/lib/store/media-pool-db";

function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

interface FeedPostCardProps {
  post: FeedPost;
  onOpen: () => void;
  onRemix: () => void;
  onCreator: () => void;
  onDelete?: () => void;
  /** Only show the delete control when explicitly true (Profile page only) */
  showDelete?: boolean;
}

export function FeedPostCard({ post, onOpen, onRemix, onCreator, onDelete, showDelete }: FeedPostCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [liked, setLiked] = useState(false);
  const [mediaOffline, setMediaOffline] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Gate client-only renders to prevent SSR/hydration mismatch from Math.sin() bar heights
  const [mounted, setMounted] = useState(false);
  const isBlob = isBlobUrl(post.videoUrl);

  // First clip's source URL + seek offset — handles gaps at project start
  const { firstClipSrc, firstClipOffset } = useMemo(() => {
    const snap = post.projectSnapshot;
    if (!snap) return { firstClipSrc: post.videoUrl, firstClipOffset: 0.001 };
    const pool = snap.mediaPool ?? [];
    const fc = snap.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips).sort((a, b) => a.startTime - b.startTime)[0];
    return {
      firstClipSrc: fc ? (pool.find((m) => m.id === fc.sourceId)?.previewUrl ?? post.videoUrl) : post.videoUrl,
      firstClipOffset: fc ? Math.max(0.001, (fc.mediaOffset ?? 0) / 1_000_000) : 0.001,
    };
  }, [post.projectSnapshot, post.videoUrl]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !firstClipSrc) return;
    const onMeta = () => { v.currentTime = firstClipOffset; };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [firstClipSrc, firstClipOffset]);

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
      onClick={onOpen} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
    >
      <div className="relative" style={{ aspectRatio: "9/16", background: post.bg }}>
        {/* Delete confirmation overlay — only reachable when showDelete is true */}
        {confirmDelete && showDelete && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-bold text-white">Delete this post?</p>
            <div className="flex gap-2">
              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-[10px] font-semibold text-white/60 hover:bg-white/8">Cancel</button>
              <button onClick={(e) => { e.stopPropagation(); if (post.projectSnapshot?.mediaPool) cleanupSnapshotMedia(post.projectSnapshot.mediaPool).catch(console.warn); onDelete?.(); }} className="rounded-lg bg-red-500/25 px-3 py-1.5 text-[10px] font-bold text-red-400 hover:bg-red-500/35">Delete</button>
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
        <video ref={videoRef} src={firstClipSrc}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${firstClipSrc && !mediaOffline ? "opacity-100" : "opacity-0"}`}
          muted loop playsInline preload="metadata"
          onError={() => setMediaOffline(true)}
        />
        {mediaOffline && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60">
            <WifiOff size={18} className="text-white/30" />
            <p className="text-[9px] font-semibold text-white/35">Media Offline</p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />

        {post.featured && (
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
          <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="mb-1 flex items-center gap-1.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: `hsl(${post.user.hue} 55% 30%)` }}>{post.user.initial}</div>
            <span className="text-[10px] font-medium text-white/70">@{post.user.handle}</span>
          </button>
          <p className="line-clamp-2 text-[11px] font-bold leading-snug text-white">{post.title}</p>
        </div>

        {/* Hover overlay — actions slide up */}
        <div className={`absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/30 to-transparent p-3 transition-all duration-200 ${hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"}`}>
          <button onClick={(e) => { e.stopPropagation(); onCreator(); }} className="mb-1.5 flex items-center gap-1.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ring-1 ring-white/20" style={{ background: `hsl(${post.user.hue} 55% 30%)` }}>{post.user.initial}</div>
            <span className="text-[10px] font-semibold text-white/80">@{post.user.handle}</span>
          </button>
          <p className="mb-1.5 text-xs font-bold leading-snug text-white">{post.title}</p>
          <div className="mb-3 flex flex-wrap gap-1">
            {post.tags.map((t) => <span key={t} className="rounded bg-white/10 px-1 py-px text-[8px] text-white/50">{t}</span>)}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={(e) => { e.stopPropagation(); setLiked((v) => !v); }} className="flex items-center gap-0.5 text-[10px] text-white/60 transition-colors hover:text-red-400">
                <Heart size={11} className={liked ? "fill-red-400 text-red-400" : ""} /><span>{fmtK(post.likes + (liked ? 1 : 0))}</span>
              </button>
              <button onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 text-[10px] text-white/60 hover:text-white/90">
                <MessageCircle size={11} /><span>{fmtK(post.comments)}</span>
              </button>
              <button onClick={(e) => e.stopPropagation()} className="text-white/60 hover:text-white/90"><Share2 size={11} /></button>
              {onDelete && showDelete && (
                <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
                  className="flex items-center gap-0.5 text-[10px] text-white/40 transition-colors hover:text-red-400">
                  <Trash2 size={11} />
                </button>
              )}
            </div>
            <button onClick={(e) => { e.stopPropagation(); onRemix(); }}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white transition-all active:scale-95"
              style={{ background: `${post.accent}dd`, boxShadow: `0 0 10px ${post.accent}50` }}
            ><Zap size={9} />Remix</button>
          </div>
        </div>
      </div>
    </article>
  );
}
