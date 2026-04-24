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
          className="flex w-full max-w-[460px] items-center justify-center py-3"
          style={{ height: "100svh", scrollSnapAlign: "start" }}
        >
          {/* FeedPostCard owns aspect-[9/16] on its root <article>; render
              it full-width inside the constrained column. */}
          <div className="w-full">
            <FeedPostCard
              post={post}
              pool={posts}
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
