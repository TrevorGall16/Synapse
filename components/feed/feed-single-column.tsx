"use client";

import { useEffect } from "react";
import type { FeedPost } from "@/lib/store/feed-store";
import { FeedPostCard } from "./feed-post-card";

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

/**
 * Single-column vertical-snap feed. Each card fills the viewport height so it
 * snaps one-post-at-a-time like RedGIF / TikTok. The parent scroll container
 * (owned by the feed page) is promoted to a snap container while this
 * component is mounted; snap-type is cleared on unmount.
 *
 * FeedPostCard already owns `aspect-[9/16]` on its <article>, so we let it
 * fill the width of the constrained column rather than wrapping it in a second
 * aspect-ratio div.
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
  // Promote / demote the parent scroll container to a snap container.
  useEffect(() => {
    const parent = scrollRef.current;
    if (!parent) return;
    parent.style.scrollSnapType = "y mandatory";
    return () => {
      parent.style.scrollSnapType = "";
    };
  }, [scrollRef]);

  return (
    <div className="flex flex-col items-center">
      {posts.map((post) => (
        <div
          key={post.id}
          className="flex w-full items-center justify-center px-3 py-3"
          style={{ height: "calc(100svh - 160px)", scrollSnapAlign: "start" }}
        >
          {/* Inner wrapper clamps the 9:16 card to grow until it either hits
              720px or is bounded by the viewport height, whichever comes first.
              This prevents the card from letterboxing on landscape monitors. */}
          <div
            className="w-full"
            style={{ maxWidth: "min(calc((100svh - 160px) * 9 / 16 - 2rem), 720px)" }}
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
        </div>
      ))}
    </div>
  );
}
