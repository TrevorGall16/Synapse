"use client";

import { useEffect, useRef, useState } from "react";
import { Heart, Share2, Eye, MoreHorizontal, Zap, Download } from "lucide-react";
import { type FeedPost, useFeedStore } from "@/lib/store/feed-store";
import { canRemix } from "@/lib/policy";
import { buildPostShareUrl } from "@/lib/utils/share";
import { FeedPostCard } from "./feed-post-card";

function fmtK(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

interface Props {
  posts: FeedPost[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  currentUsername?: string;
  onOpen: (post: FeedPost) => void;
  onRemix: (post: FeedPost) => void;
  onImport: (post: FeedPost) => void;
  onCreator: (post: FeedPost) => void;
  onDelete: (post: FeedPost) => void;
}

// ── Action Pillar ─────────────────────────────────────────────────────────────
// Rendered as a sibling to FeedPostCard — floats to the right of the video
// frame with a 16px gap. Owns all social state (like, share, more).

interface PillarProps {
  post: FeedPost;
  onRemix: () => void;
  onImport?: () => void;
}

function FeedPillar({ post, onRemix, onImport }: PillarProps) {
  const liked = useFeedStore((s) => s.likedPostIds.includes(post.id));
  const toggleLike = useFeedStore((s) => s.toggleLike);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shareOpen) return;
    const onOut = (e: MouseEvent) => {
      if (!(shareRef.current?.contains(e.target as Node) ?? false)) setShareOpen(false);
    };
    document.addEventListener("pointerdown", onOut);
    return () => document.removeEventListener("pointerdown", onOut);
  }, [shareOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const onOut = (e: MouseEvent) => {
      if (!(moreRef.current?.contains(e.target as Node) ?? false)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onOut);
    return () => document.removeEventListener("pointerdown", onOut);
  }, [moreOpen]);

  const handleCopyLink = () => {
    const url = buildPostShareUrl(post.id);
    navigator.clipboard.writeText(url).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => { setToast("Failed to copy"); setTimeout(() => setToast(null), 2000); },
    );
    setTimeout(() => setShareOpen(false), 800);
  };

  const handleShareTwitter = () => {
    const url = buildPostShareUrl(post.id);
    window.open(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Check out "${post.title}" on Synapse`)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setShareOpen(false);
  };

  const handleShareReddit = () => {
    const url = buildPostShareUrl(post.id);
    window.open(
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(post.title)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setShareOpen(false);
  };

  return (
    <div className="relative flex shrink-0 flex-col items-center gap-5 pb-6">
      {/* Like */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleLike(post.id); }}
        className="flex flex-col items-center gap-1.5"
      >
        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl backdrop-blur-sm drop-shadow-lg transition-all ${liked ? "bg-icon-heart/25 ring-1 ring-icon-heart/50" : "bg-white/10"}`}>
          <Heart size={26} className={liked ? "fill-icon-heart text-icon-heart" : "text-icon-heart/70"} />
        </div>
        <span className="text-[10px] font-bold text-white drop-shadow-md">{fmtK(post.likes + (liked ? 1 : 0))}</span>
      </button>

      {/* Share */}
      <div className="relative flex flex-col items-center gap-1.5" ref={shareRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setShareOpen((v) => !v); }}
          className="flex flex-col items-center gap-1.5"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm drop-shadow-lg">
            <Share2 size={26} className="text-icon-share" />
          </div>
          <span className="text-[10px] font-bold text-white drop-shadow-md">Share</span>
        </button>
        {shareOpen && (
          <div
            className="absolute bottom-0 right-full z-[60] mr-3 min-w-[150px] rounded-xl border border-white/20 py-1.5 shadow-2xl"
            style={{ background: "rgba(30,30,30,0.85)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={handleCopyLink} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 hover:bg-white/10">
              {copied ? <span className="text-emerald-400">✓ Copied!</span> : "Copy Link"}
            </button>
            <button onClick={handleShareTwitter} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 hover:bg-white/10">Share to X</button>
            <button onClick={handleShareReddit} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[11px] font-medium text-white/90 hover:bg-white/10">Share to Reddit</button>
          </div>
        )}
      </div>

      {/* Views */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm drop-shadow-lg">
          <Eye size={26} className="text-icon-views" />
        </div>
        <span className="text-[10px] font-bold text-white drop-shadow-md">{fmtK(post.likes * 10 + post.comments * 20)}</span>
      </div>

      {/* More (Remix + Import) */}
      {(canRemix(post) || onImport) && (
        <div className="relative flex flex-col items-center gap-1.5" ref={moreRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setMoreOpen((v) => !v); }}
            className="flex flex-col items-center gap-1.5"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm drop-shadow-lg">
              <MoreHorizontal size={26} className="text-icon-more" />
            </div>
            <span className="text-[10px] font-bold text-white drop-shadow-md">More</span>
          </button>
          {moreOpen && (
            <div
              className="absolute bottom-0 right-full z-[60] mr-3 min-w-[140px] rounded-xl border border-white/20 py-1.5 shadow-2xl"
              style={{ background: "rgba(30,30,30,0.85)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {canRemix(post) && (
                <button
                  onClick={(e) => { e.stopPropagation(); setMoreOpen(false); onRemix(); }}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-base font-semibold text-white/90 hover:bg-white/10"
                >
                  <Zap size={13} style={{ color: post.accent }} />Remix
                </button>
              )}
              {onImport && (
                <button
                  onClick={(e) => { e.stopPropagation(); setMoreOpen(false); onImport(); }}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-base font-semibold text-white/90 hover:bg-white/10"
                >
                  <Download size={13} className="text-white/60" />Import
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-[9px] font-semibold text-white/90">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Feed ──────────────────────────────────────────────────────────────────────

/**
 * Single-column vertical-snap feed. Each card fills the viewport height so it
 * snaps one-post-at-a-time like RedGIF / TikTok. The action pillar (Like,
 * Share, Views, More) lives OUTSIDE the video frame as a sibling column to
 * the right of the card, matching the RedGIF side-remote pattern.
 *
 * The parent scroll container (owned by the feed page) is promoted to a snap
 * container while this component is mounted; snap-type is cleared on unmount.
 */
export function FeedSingleColumn({
  posts,
  scrollRef,
  currentUsername,
  onOpen,
  onRemix,
  onImport,
  onCreator,
  onDelete,
}: Props) {
  useEffect(() => {
    const parent = scrollRef.current;
    if (!parent) return;
    parent.style.scrollSnapType = "y proximity";
    return () => {
      parent.style.scrollSnapType = "";
    };
  }, [scrollRef]);

  return (
    <>
      {/* Persistent purple-rise atmosphere — fixed to viewport bottom, never scrolls.
          Uses rgba() not oklch() — the slash-alpha oklch syntax is dropped by CSS parsers
          in style props in some browser/bundler combos. rgba(147,51,234) = purple-600. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[1] h-[65vh]"
        style={{
          background: "linear-gradient(to top, rgba(147,51,234,0.25) 0%, rgba(147,51,234,0.08) 50%, transparent 100%)",
        }}
        aria-hidden
      />

      <div className="relative z-[2] flex flex-col items-center pt-2">
        {posts.map((post) => (
          <div
            key={post.id}
            className="relative flex w-full items-center justify-center px-3 py-3"
            style={{ height: "calc(100svh - 160px)", scrollSnapAlign: "center" }}
          >
            {/* Card + Pillar centered as a unit — pillar floats 16px to the right.
                Card width accounts for the pillar (4rem ≈ 64px) + gap (16px) so the
                pair fits on narrow mobile viewports without overflow. */}
            <div className="flex items-end gap-4">
              <div
                className="relative flex-none"
                style={{ width: "min(calc((100svh - 156px) * 9 / 16 - 2rem), calc(100vw - 24px - 4rem - 16px), 720px)" }}
              >
                <FeedPostCard
                  post={post}
                  pool={posts}
                  autoplayInView
                  onOpen={() => onOpen(post)}
                  onRemix={() => onRemix(post)}
                  onImport={() => onImport(post)}
                  onCreator={() => onCreator(post)}
                  onDelete={
                    post.authorUsername && post.authorUsername === currentUsername
                      ? () => onDelete(post)
                      : undefined
                  }
                />
              </div>
              <FeedPillar
                post={post}
                onRemix={() => onRemix(post)}
                onImport={() => onImport(post)}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
