"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useCallback } from "react";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { TheaterMode } from "@/components/feed/theater-mode";
import { navigateToCreator } from "@/lib/nav/theater-nav";

export default function VideoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userPosts = useFeedStore((s) => s.userPosts);

  // Mock catalog wiped for launch — only user-published posts are addressable.
  // Unknown ids fall through to the "Video not found" branch below.
  const allPosts = useMemo(
    () => userPosts.filter((p) => !p.type || p.type === "video"),
    [userPosts],
  );

  const post = useMemo(
    () => allPosts.find((p) => p.id === params.id) ?? null,
    [allPosts, params.id],
  );

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleRemix = useCallback(() => {
    router.push("/");
  }, [router]);

  // IMPORTANT: closeTheater must be a NO-OP here.
  //
  // navigateToCreator() pushes `/profile/[handle]` then invokes closeTheater.
  // On this page, closing Theater used to `router.push("/")`, which raced the
  // profile push and landed users on Home instead. VideoPage unmounts as soon
  // as the profile route commits, so no explicit teardown is required.
  const handleCreator = useCallback(
    (activePost: FeedPost) => navigateToCreator(router, activePost, () => {}),
    [router],
  );

  if (!post) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
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
