"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Compass } from "lucide-react";
import { NICHE_CATEGORIES, NICHE_TAGS, type NicheCategory } from "@/lib/config/taxonomy";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";

type SortOption = "trending" | "latest" | "top";

const SORT_OPTIONS: SortOption[] = ["trending", "latest", "top"];

// ── Category card with hover-play video preview ───────────────────────────────

function CategoryCard({ cat, previewPost }: { cat: NicheCategory; previewPost: FeedPost | undefined }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleEnter = () => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
  };

  const handleLeave = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };

  return (
    <Link
      href={`/niche/${cat.slug}`}
      className="group relative aspect-square overflow-hidden rounded-xl border border-white/8 transition-all duration-300 hover:scale-[1.03] hover:border-white/20"
      style={{ background: cat.bg }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Video preview — fades in on hover, invisible at rest */}
      {previewPost?.videoUrl && (
        <video
          ref={videoRef}
          src={previewPost.videoUrl}
          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-400 group-hover:opacity-100"
          muted
          loop
          playsInline
          preload="none"
        />
      )}

      {/* Accent glow blob — fades out when video takes over */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-30 blur-2xl transition-opacity duration-300 group-hover:opacity-0"
        style={{ background: cat.accent }}
      />

      {/* Bottom scrim + label */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-3 pt-10">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cat.accent }} />
          <span className="truncate text-[12px] font-bold text-white">{cat.label}</span>
        </div>
      </div>
    </Link>
  );
}

// ── Browse / Explore Page ─────────────────────────────────────────────────────

export default function BrowsePage() {
  const [sort, setSort] = useState<SortOption>("trending");
  const allPosts = useFeedStore((s) => s.userPosts);

  // First post per category for the video preview
  const previewBySlug = new Map<string, FeedPost>();
  for (const cat of NICHE_CATEGORIES) {
    const match = allPosts.find((p) => p.channels?.includes(cat.label));
    if (match) previewBySlug.set(cat.slug, match);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#121014]">
      {/* Header */}
      <div className="z-10 shrink-0 border-b border-white/10 bg-[#121014]/95 px-6 py-3 backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Compass size={15} className="text-brand-accent" />
            <h1 className="text-base font-bold text-white">Explore</h1>
          </div>
          <div className="flex items-center gap-1">
            {SORT_OPTIONS.map((id) => (
              <button
                key={id}
                onClick={() => setSort(id)}
                className={`rounded-full px-3 py-1 text-[10px] font-semibold capitalize transition-all ${
                  sort === id
                    ? "bg-[#ff007a]/20 text-[#ff007a] ring-1 ring-[#ff007a]/40"
                    : "text-white/35 hover:text-white/65"
                }`}
              >{id}</button>
            ))}
          </div>
        </div>

      </div>

      {/* Scrollable content */}
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* Categories — square cards with hover video previews */}
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Categories</p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {NICHE_CATEGORIES.map((cat) => (
              <CategoryCard
                key={cat.slug}
                cat={cat}
                previewPost={previewBySlug.get(cat.slug)}
              />
            ))}
          </div>
        </section>

        {/* Trending tags */}
        <section>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">Trending Tags</p>
          <div className="flex flex-wrap gap-2">
            {NICHE_TAGS.map((tag) => (
              <Link
                key={tag}
                href={`/?tag=${encodeURIComponent(tag.slice(1))}`}
                className="rounded-full border border-[#ff007a]/20 bg-[#ff007a]/8 px-4 py-2 text-sm font-semibold text-white/70 transition-all hover:border-[#ff007a]/45 hover:bg-[#ff007a]/15 hover:text-[#ff007a]"
              >{tag}</Link>
            ))}
          </div>
        </section>

        {/* Creators (coming soon) */}
        <section>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-white/30">Creators</p>
          <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/3 px-5 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/6 ring-1 ring-white/12">
              <Compass size={18} className="text-white/30" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white/40">Creator profiles coming soon</p>
              <p className="text-[11px] text-white/25">Follow creators from their profile pages or any post in your feed.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
