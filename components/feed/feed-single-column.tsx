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
            style={{ height: "calc(100svh - 116px)", scrollSnapAlign: "center" }}
          >
            {/* Inner wrapper clamps the 9:16 card to grow until it either hits
                720px or is bounded by the viewport height, whichever comes first.
                This prevents the card from letterboxing on landscape monitors. */}
            <div
              className="relative w-full"
              style={{ maxWidth: "min(calc((100svh - 112px) * 9 / 16 - 2rem), 720px)" }}
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
    </>
  );
}
