"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useCallback } from "react";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { TheaterMode } from "@/components/feed/theater-mode";

// ── Same mock posts as the discovery feed — keep in sync with app/page.tsx ──
const MOCK_POSTS: FeedPost[] = [
  { id: "1", user: { handle: "aurora_vj",    initial: "A", hue: 270 }, title: "Strobing Bass Drop Edit",   tags: ["#techno","#hypnotic"],    bg: "#1a0a2e", accent: "#7c3aed", duration: "0:42", likes: 2847, comments: 142, featured: true  },
  { id: "2", user: { handle: "neon_cut",     initial: "N", hue: 340 }, title: "RGB Glitch Cascade",        tags: ["#glitch","#edm"],         bg: "#1a0818", accent: "#ec4899", duration: "0:30", likes: 1923, comments: 88,  featured: false },
  { id: "3", user: { handle: "spectral_x",  initial: "S", hue: 200 }, title: "Hypno Tunnel Loop",         tags: ["#psy","#loop"],           bg: "#071a1a", accent: "#06b6d4", duration: "1:04", likes: 3410, comments: 211, featured: false },
  { id: "4", user: { handle: "hue.shift",   initial: "H", hue: 30  }, title: "Chromatic Aberration Pack", tags: ["#vfx","#bass"],           bg: "#1a1100", accent: "#f59e0b", duration: "0:55", likes: 891,  comments: 47,  featured: false },
  { id: "5", user: { handle: "deep.freq",   initial: "D", hue: 150 }, title: "Pixel Sort Waveform",       tags: ["#experimental","#lo-fi"], bg: "#051a0a", accent: "#22c55e", duration: "0:37", likes: 2104, comments: 93,  featured: false },
  { id: "6", user: { handle: "void_signal", initial: "V", hue: 0   }, title: "Infrared Strobe Cut",       tags: ["#industrial","#harsh"],   bg: "#1a0500", accent: "#ef4444", duration: "0:28", likes: 1650, comments: 72,  featured: false },
  { id: "7", user: { handle: "prismatic",   initial: "P", hue: 300 }, title: "Kaleidoscope Crossfade",    tags: ["#ambient","#visual"],     bg: "#160a1a", accent: "#a855f7", duration: "2:10", likes: 4201, comments: 317, featured: true  },
  { id: "8", user: { handle: "lo.form",     initial: "L", hue: 185 }, title: "Scan Line Retro Mix",       tags: ["#retrowave","#vhs"],      bg: "#071018", accent: "#38bdf8", duration: "1:20", likes: 1389, comments: 61,  featured: false },
  { id: "9", user: { handle: "bpmviz",      initial: "B", hue: 45  }, title: "Beat-Sync Flash Grid",      tags: ["#dnb","#reactive"],       bg: "#180e00", accent: "#fb923c", duration: "0:48", likes: 3027, comments: 184, featured: false },
];

export default function VideoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userPosts = useFeedStore((s) => s.userPosts);

  const allPosts = useMemo(
    () => [...userPosts.filter((p) => !p.type || p.type === "video"), ...MOCK_POSTS],
    [userPosts],
  );

  const post = useMemo(
    () => allPosts.find((p) => p.id === params.id) ?? null,
    [allPosts, params.id],
  );

  const handleClose = useCallback(() => {
    router.push("/");
  }, [router]);

  const handleRemix = useCallback(() => {
    router.push("/");
  }, [router]);

  const handleCreator = useCallback(() => {
    if (post) router.push(`/profile/${post.user.handle}`);
  }, [router, post]);

  if (!post) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="text-center">
          <p className="text-lg font-bold text-white/60">Video not found</p>
          <p className="mt-1 text-sm text-white/30">ID: {params.id}</p>
          <button
            onClick={() => router.push("/")}
            className="mt-4 rounded-lg bg-brand/20 px-4 py-2 text-sm font-semibold text-brand-text transition-colors hover:bg-brand/30"
          >
            Back to Discovery
          </button>
        </div>
      </div>
    );
  }

  return (
    <TheaterMode
      post={post}
      onClose={handleClose}
      onRemix={handleRemix}
      onCreator={handleCreator}
      allPosts={allPosts}
    />
  );
}
