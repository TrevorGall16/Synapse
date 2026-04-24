"use client";

import { useEffect, useState } from "react";
import type { FeedPost } from "@/lib/store/feed-store";
import { loadThumbnailUrl } from "@/lib/store/thumbnail-idb";
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

/** Blurred, opacity-dimmed thumbnail stretched behind each 9:16 card so the
 *  empty letterbox on wide desktop screens feels cinematic rather than dead.
 *
 *  Perf guardrails:
 *    - Image, not a second <video> — zero decoder cost, zero additional GPU
 *      compositing layers beyond the cheap blur filter.
 *    - `hidden lg:block` so mobile (where the card already fills the width)
 *      pays nothing.
 *    - Reuses the same durable IDB thumbnail the <FeedPostCard> already
 *      primes, so no extra decode work when the card mounts. */
function AmbientGlow({ postId }: { postId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadThumbnailUrl(postId).then((u) => {
      if (!cancelled && u) setUrl(u);
    });
    return () => { cancelled = true; };
  }, [postId]);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      className="pointer-events-none absolute inset-0 hidden h-full w-full scale-110 object-cover opacity-30 blur-3xl lg:block"
    />
  );
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
          className="relative flex w-full items-center justify-center overflow-hidden px-3 py-3"
          style={{ height: "calc(100svh - 112px)", scrollSnapAlign: "start" }}
        >
          <AmbientGlow postId={post.id} />
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
  );
}
