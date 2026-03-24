"use client";

import { useCallback, useRef } from "react";
import { X, BookMarked } from "lucide-react";
import { clipCssFilter, clipCssTransform } from "@/lib/utils/svg-filters";
import type { FeedPost } from "@/lib/store/feed-store";

// ── Category-keyed swatch animations (must match explore/page.tsx keyframes) ──
const SHOWCASE_KF = `
@keyframes sc-blur { 0%,100%{filter:blur(0) brightness(1)} 50%{filter:blur(8px) brightness(1.25)} }
@keyframes sc-jitter { 0%,100%{transform:none} 20%{transform:translateX(-5px) skewX(-6deg)} 60%{transform:translateX(5px) skewX(6deg)} }
@keyframes sc-warp { 0%,100%{transform:scaleX(1) scaleY(1)} 50%{transform:scaleX(1.1) scaleY(0.92)} }
@keyframes sc-hue { 0%{filter:hue-rotate(0deg) saturate(2)} 100%{filter:hue-rotate(360deg) saturate(2)} }
`;

function showcaseAnim(category: string): string {
  switch (category) {
    case "blur":       return "sc-blur 2.5s ease-in-out infinite";
    case "glitch":     return "sc-jitter 0.45s steps(4) infinite";
    case "distortion": return "sc-warp 2s ease-in-out infinite";
    case "color":      return "sc-hue 4s linear infinite";
    default:           return "";
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface ShowcasePreset {
  label: string;
  category: string;
  fxParams: Record<string, unknown>;
}

interface PresetShowcaseProps {
  post: FeedPost | null;     // non-null for feed-published presets
  preset: ShowcasePreset;    // always present (built-in or feed-derived)
  accent?: string;
  onClose: () => void;
  onSave: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────
export function PresetShowcase({ post, preset, accent = "#7c3aed", onClose, onSave }: PresetShowcaseProps) {
  const hasVideo = !!(post?.videoUrl);
  const cssFilter    = clipCssFilter(preset.fxParams);
  const cssTransform = clipCssTransform(preset.fxParams);
  const anim         = showcaseAnim(preset.category);
  const videoRef     = useRef<HTMLVideoElement>(null);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const demoStart = post?.demoStartTime ?? 0;

  // Seek to demoStart when the video first loads
  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (v && demoStart > 0) v.currentTime = demoStart;
  }, [demoStart]);

  // Loop a 4-second window starting at demoStart
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (v && v.currentTime > demoStart + 4) v.currentTime = demoStart;
  }, [demoStart]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-synapse-preset", JSON.stringify(preset.fxParams));
  }, [preset.fxParams]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <style dangerouslySetInnerHTML={{ __html: SHOWCASE_KF }} />

      <div
        className="relative flex w-full max-w-2xl overflow-hidden rounded-2xl border border-white/14 bg-[#1a1a1a] shadow-2xl"
        style={{ minHeight: 340 }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-lg bg-black/50 p-1.5 text-white/50 backdrop-blur-sm transition-colors hover:bg-white/15 hover:text-white"
        >
          <X size={13} />
        </button>

        {/* ── Left: Video or animated swatch ──────────────────────────────── */}
        <div className="relative w-[56%] shrink-0 overflow-hidden bg-black">
          {hasVideo ? (
            <video
              ref={videoRef}
              src={post!.videoUrl}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              className="h-full w-full object-cover"
              style={{ minHeight: 340 }}
            />
          ) : (
            <div
              className="flex h-full min-h-[340px] items-center justify-center"
              style={{ background: "#0c0c0c" }}
            >
              <div
                draggable
                onDragStart={handleDragStart}
                className="h-3/4 w-3/4 cursor-grab rounded-2xl active:cursor-grabbing"
                style={{
                  background: `linear-gradient(135deg, ${accent}80, ${accent}25)`,
                  filter: cssFilter || undefined,
                  transform: cssTransform || undefined,
                  animation: anim || undefined,
                }}
              />
            </div>
          )}

        </div>

        {/* ── Right: Info panel ─────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col gap-4 p-5">
          {/* Category badge */}
          <span className="w-fit rounded-full bg-white/8 px-2.5 py-0.5 text-[9px] font-semibold capitalize text-white/40">
            {preset.category}
          </span>

          {/* Title */}
          <h2 className="text-base font-bold leading-snug text-white">{preset.label}</h2>

          {/* Author — only for feed-published presets */}
          {post && (
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ background: `hsl(${post.user.hue} 55% 30%)` }}
              >
                {post.user.initial}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-white/80">@{post.user.handle}</p>
                <p className="text-[9px] text-white/35">Creator</p>
              </div>
            </div>
          )}

          {/* Description */}
          {post?.description ? (
            <p className="line-clamp-4 text-[11px] leading-relaxed text-white/55">{post.description}</p>
          ) : (
            <p className="text-[11px] text-white/25 italic">No description provided.</p>
          )}

          {/* Tags */}
          {post?.tags?.length ? (
            <div className="flex flex-wrap gap-1">
              {post.tags.slice(0, 5).map((t) => (
                <span key={t} className="rounded bg-white/8 px-1.5 py-0.5 text-[8px] text-white/40">{t}</span>
              ))}
            </div>
          ) : null}

          <div className="mt-auto flex flex-col gap-2">
            <button
              onClick={onSave}
              className="flex items-center justify-center gap-2 rounded-xl bg-purple-500/25 py-2.5 text-[11px] font-bold text-purple-300 transition-colors hover:bg-purple-500/40"
            >
              <BookMarked size={12} />Save to Library
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
