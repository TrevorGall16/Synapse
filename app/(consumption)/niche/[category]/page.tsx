"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Zap, SlidersHorizontal } from "lucide-react";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { TheaterMode } from "@/components/feed/theater-mode";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { getRemixMode } from "@/lib/policy";
import { NICHE_CATEGORY_BY_SLUG as CATEGORY_META, isValidNicheCategory as isValidCategory } from "@/lib/config/taxonomy";
import { navigateToCreator } from "@/lib/nav/theater-nav";

type MediaType = "all" | "videos" | "gifs" | "images";

const MEDIA_TYPES: { id: MediaType; label: string }[] = [
  { id: "all",    label: "All" },
  { id: "videos", label: "Videos" },
  { id: "gifs",   label: "GIFs" },
  { id: "images", label: "Images" },
];

// ---------------------------------------------------------------------------
// NicheCard — lazy-loads video only when inside (or near) the viewport
// ---------------------------------------------------------------------------
function NicheCard({ post, onClick }: { post: FeedPost; onClick: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "100px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = "";
    }
  }, [isVisible]);

  return (
    <article
      ref={ref}
      data-testid="niche-card"
      onClick={onClick}
      className="group cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-all hover:scale-[1.02] hover:border-white/20"
    >
      <div className="relative" style={{ aspectRatio: "9/16", background: post.bg }}>
        {isVisible && post.videoUrl && (
          <video
            ref={videoRef}
            src={post.videoUrl}
            preload="metadata"
            data-testid="niche-card-video"
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
            onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => {
              const v = e.target as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80" />
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="truncate text-[10px] font-medium text-white/55">{post.title}</p>
          <p className="text-[8px] text-white/30">@{post.user.handle}</p>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function NichePage() {
  const params = useParams();
  const router = useRouter();
  const rawCategory = Array.isArray(params.category) ? params.category[0] : (params.category ?? "");
  const allPosts = useFeedStore((s) => s.userPosts);
  const [theaterPost, setTheaterPost] = useState<FeedPost | null>(null);
  const [mediaType, setMediaType] = useState<MediaType>("all");

  const valid = isValidCategory(rawCategory);
  const meta = valid ? CATEGORY_META[rawCategory] : null;

  // Filter posts whose channels[] includes this category's label, then apply media type
  const filtered = useMemo(() => {
    if (!valid || !meta) return [];
    const byCategory = allPosts.filter((p) => p.channels?.includes(meta.label));
    if (mediaType === "all") return byCategory;
    if (mediaType === "videos") return byCategory.filter((p) => !p.type || p.type === "video");
    // GIFs / Images: not yet modeled in FeedPostType — return empty to keep
    // the filter UI consistent for when those types land in a future data model update.
    return [];
  }, [allPosts, valid, meta, mediaType]);

  const handleStudioLoad = (p: FeedPost) => {
    if (getRemixMode(p) === "snapshot") {
      usePlaybackStore.getState().loadSnapshot(p.projectSnapshot!, {
        remixedFromHandle: p.user.handle,
        parentPostId: p.id,
        rootParentId: p.rootParentId,
        rootParentHandle: p.rootParentHandle,
        demoStartTime: p.demoStartTime,
        demoDuration: p.demoDuration,
        post: p,
      });
    }
    setTheaterPost(null);
    router.push("/studio");
  };

  if (!valid) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#121014] text-center">
        <p className="text-sm font-bold text-white/40">Unknown category</p>
        <p className="mt-1 text-[11px] text-white/25">Browse to /explore to see all categories.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-lg bg-white/8 px-3 py-1.5 text-xs text-white/60 hover:bg-white/14">
          <ArrowLeft size={11} className="mr-1 inline" />Back to Feed
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#121014]">
      {theaterPost && (
        <TheaterMode
          post={theaterPost}
          onClose={() => setTheaterPost(null)}
          onRemix={handleStudioLoad}
          onCreator={(activePost) => navigateToCreator(router, activePost, () => setTheaterPost(null))}
          allPosts={filtered}
          lockedQueue={filtered}
          onNavigate={setTheaterPost}
        />
      )}

      {/* Header */}
      <div className="shrink-0 border-b border-white/8 px-6 pb-3 pt-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/14 hover:text-white">
            <ArrowLeft size={11} />Back
          </button>
          <div>
            <h1 className="text-base font-bold text-white" style={{ color: meta!.accent }}>{meta!.label}</h1>
            <p className="text-[11px] text-white/40">{meta!.description}</p>
          </div>
        </div>

        {/* Media type filter pills */}
        <div className="mt-3 flex items-center gap-2">
          <SlidersHorizontal size={11} className="shrink-0 text-white/25" />
          <div className="flex gap-1.5">
            {MEDIA_TYPES.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setMediaType(id)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                  mediaType === id
                    ? "ring-1"
                    : "bg-white/6 text-white/45 hover:bg-white/10 hover:text-white/75"
                }`}
                style={mediaType === id ? { background: `${meta!.accent}22`, color: meta!.accent, boxShadow: `inset 0 0 0 1px ${meta!.accent}55` } : undefined}
              >{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Zap size={28} className="mb-3 text-white/15" />
            <p className="text-sm font-semibold text-white/30">No posts in this niche yet</p>
            <p className="mt-1 text-[11px] text-white/20">Publish an edit with the <span className="font-bold" style={{ color: meta!.accent }}>{meta!.label}</span> category.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((post) => (
              <NicheCard key={post.id} post={post} onClick={() => setTheaterPost(post)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
