"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Zap } from "lucide-react";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { TheaterMode } from "@/components/feed/theater-mode";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { getRemixMode } from "@/lib/policy";

/** Valid category values — matches FeedPostSchema.category enum */
const VALID_CATEGORIES = ["high-sensation", "aesthetic", "cinematic", "glitch", "slow-mo"] as const;
type NicheCategory = (typeof VALID_CATEGORIES)[number];

function isValidCategory(v: string): v is NicheCategory {
  return (VALID_CATEGORIES as readonly string[]).includes(v);
}

const CATEGORY_META: Record<NicheCategory, { label: string; description: string; accent: string; tagAliases: string[] }> = {
  "high-sensation": { label: "High Sensation", description: "Strobing, rapid-cut, beat-synced intensity.", accent: "#ec4899", tagAliases: ["#HighSensation", "#highsensation"] },
  aesthetic:        { label: "Aesthetic",       description: "Dreamy palettes, soft grading, lo-fi vibes.", accent: "#a855f7", tagAliases: ["#Aesthetic", "#aesthetic"] },
  cinematic:        { label: "Cinematic",       description: "Wide aspect, film grain, color science.",      accent: "#06b6d4", tagAliases: ["#Cinematic", "#cinematic"] },
  glitch:           { label: "Glitch",          description: "Data-bent, pixel-sorted, RGB split chaos.",    accent: "#22c55e", tagAliases: ["#Glitch", "#glitch"] },
  "slow-mo":        { label: "Slow Mo",         description: "Time-stretch, optical flow, high-fps glass.", accent: "#f59e0b", tagAliases: ["#SlowMo", "#slowmo", "#slow-mo"] },
};

// ---------------------------------------------------------------------------
// NicheCard — lazy-loads video only when inside (or near) the viewport
// ---------------------------------------------------------------------------
function NicheCard({ post, onClick }: { post: FeedPost; onClick: () => void }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);

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

  const valid = isValidCategory(rawCategory);
  const meta = valid ? CATEGORY_META[rawCategory] : null;

  // Filter posts by category enum OR matching hashtag in tags[] — bridges both systems
  const filtered = useMemo(() => {
    if (!valid) return [];
    const aliases = CATEGORY_META[rawCategory].tagAliases;
    return allPosts.filter(
      (p) => p.category === rawCategory || p.tags.some((t) => aliases.includes(t))
    );
  }, [allPosts, rawCategory, valid]);

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
      <div className="flex h-full flex-col items-center justify-center bg-[#141414] text-center">
        <p className="text-sm font-bold text-white/40">Unknown category</p>
        <p className="mt-1 text-[11px] text-white/25">Valid: {VALID_CATEGORIES.join(", ")}</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-lg bg-white/8 px-3 py-1.5 text-xs text-white/60 hover:bg-white/14">
          <ArrowLeft size={11} className="mr-1 inline" />Back to Feed
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      {theaterPost && (
        <TheaterMode
          post={theaterPost}
          onClose={() => setTheaterPost(null)}
          onRemix={handleStudioLoad}
          onCreator={() => { setTheaterPost(null); router.push(`/profile/${theaterPost.user.handle}`); }}
          allPosts={filtered}
          onNavigate={setTheaterPost}
        />
      )}

      {/* Header */}
      <div className="shrink-0 border-b border-white/8 px-6 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/14 hover:text-white">
            <ArrowLeft size={11} />Back
          </button>
          <div>
            <h1 className="text-base font-bold text-white" style={{ color: meta!.accent }}>{meta!.label}</h1>
            <p className="text-[11px] text-white/40">{meta!.description}</p>
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
