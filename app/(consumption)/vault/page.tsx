"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Heart } from "lucide-react";
import { useFeedStore } from "@/lib/store/feed-store";
import { FeedPostCard } from "@/components/feed/feed-post-card";

export default function VaultPage() {
  const router = useRouter();
  const userPosts    = useFeedStore((s) => s.userPosts);
  const likedPostIds = useFeedStore((s) => s.likedPostIds);

  const savedPosts = useMemo(
    () => userPosts.filter((p) => likedPostIds.includes(p.id) && (!p.type || p.type === "video")),
    [userPosts, likedPostIds],
  );

  return (
    <div className="px-6 py-5">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-icon-heart/15 ring-1 ring-icon-heart/30">
            <Bookmark size={18} className="text-icon-heart" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Vault</h1>
            <p className="text-[11px] text-white/35">
              {savedPosts.length} saved post{savedPosts.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-white/30">
          Posts you&apos;ve liked are collected here. Like posts on the feed to add them.
        </p>
      </div>

      {savedPosts.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {savedPosts.map((post) => (
            <FeedPostCard
              key={post.id}
              post={post}
              pool={savedPosts}
              onOpen={() => router.push(`/video/${post.id}`)}
              onRemix={() => router.push(`/studio`)}
              onCreator={() => router.push(`/profile/${post.user.handle}`)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-28 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-icon-heart/10 ring-1 ring-icon-heart/20">
            <Heart size={28} className="text-icon-heart/50" />
          </div>
          <p className="text-base font-bold text-white/40">Nothing saved yet</p>
          <p className="mt-2 max-w-[220px] text-sm text-white/25">
            Tap the heart on any post in the feed and it will appear here.
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-6 rounded-2xl bg-white/8 px-5 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/14 hover:text-white"
          >
            Browse the feed
          </button>
        </div>
      )}
    </div>
  );
}
