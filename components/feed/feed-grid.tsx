"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

/** Measure the grid's column count from its actual rendered width. */
function useColumnCount(ref: React.RefObject<HTMLDivElement | null>): number {
  const [cols, setCols] = useState(6);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      // Matches the Tailwind breakpoint ladder previously inline in app/page.tsx
      if (w < 640) setCols(2);
      else if (w < 768) setCols(3);
      else if (w < 1024) setCols(4);
      else if (w < 1280) setCols(5);
      else setCols(6);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

/** One virtual row = one horizontal strip of `cols` cards. */
export function FeedGrid({ posts, scrollRef, currentUsername, onOpen, onRemix, onImport, onCreator, onDelete }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cols = useColumnCount(gridRef);
  const rowCount = Math.ceil(posts.length / cols);

  // Card aspect ratio is 9/16 and the grid has gap-4 (16px). Derive the row
  // height from the measured column width so virtual-scroll math stays
  // accurate across breakpoints without a per-row measureElement round-trip.
  const rowHeight = useMemo(() => {
    const el = gridRef.current;
    const width = el?.clientWidth ?? 1200;
    const gap = 16;
    const cardWidth = (width - gap * (cols - 1)) / cols;
    return Math.round(cardWidth * (16 / 9)) + gap;
  }, [cols]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 2,
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={gridRef}
      style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
    >
      {virtualItems.map((row) => {
        const start = row.index * cols;
        const slice = posts.slice(start, start + cols);
        return (
          <div
            key={row.key}
            data-row-index={row.index}
            className="absolute left-0 right-0 grid gap-4"
            style={{
              top: 0,
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              height: row.size,
            }}
          >
            {slice.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                pool={posts}
                onOpen={() => onOpen(post)}
                onRemix={() => onRemix(post)}
                onImport={() => onImport(post)}
                onCreator={() => onCreator(post)}
                onDelete={post.authorUsername && post.authorUsername === currentUsername
                  ? () => onDelete(post)
                  : undefined}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
