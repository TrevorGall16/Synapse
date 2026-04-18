"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

const GRID_GAP = 16; // matches Tailwind gap-4 / mb-4 rhythm in the rest of the feed.

// useLayoutEffect warns during SSR; the typeof check is evaluated once at
// module load (stable for the component's lifetime), so the hook identity
// never changes across renders — Rules-of-Hooks safe.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Column count breakpoint ladder — matches the pre-virtualization
 *  `sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6` classes. */
function breakpointCols(width: number): number {
  if (width < 640) return 2;
  if (width < 768) return 3;
  if (width < 1024) return 4;
  if (width < 1280) return 5;
  return 6;
}

/** Measure the grid's rendered width AND column count. Both are state so
 *  rowHeight recomputes when the user resizes within a breakpoint — the
 *  previous cols-only version went stale because cardWidth depends on the
 *  full container width, not just the breakpoint bucket.
 *
 *  SSR-safe: the lazy initializer checks `typeof window` so Next.js server
 *  render gets the 1200 fallback instead of crashing on `window.innerWidth`.
 *  We also use `useLayoutEffect` on the client so the first real measurement
 *  lands before paint — otherwise cards render at the wrong column count for
 *  one frame on narrow viewports (the visible "snap" users reported on Ctrl+R). */
function useGridMetrics(ref: React.RefObject<HTMLDivElement | null>): { cols: number; width: number } {
  const [metrics, setMetrics] = useState(() => {
    if (typeof window === "undefined") return { cols: 6, width: 1200 };
    const w = window.innerWidth;
    return { cols: breakpointCols(w), width: w };
  });
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      const cols = breakpointCols(w);
      setMetrics((prev) => (prev.cols === cols && prev.width === w ? prev : { cols, width: w }));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return metrics;
}

/** One virtual row = one horizontal strip of `cols` cards. */
export function FeedGrid({ posts, scrollRef, currentUsername, onOpen, onRemix, onImport, onCreator, onDelete }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const { cols, width } = useGridMetrics(gridRef);
  const rowCount = Math.ceil(posts.length / cols);

  // Card aspect ratio is 9/16 (portrait) — height = cardWidth × (16/9).
  // rowHeight includes one gap so the virtualizer's translateY stacks rows
  // with a visible gap between them; the row container below renders at
  // `row.size - GRID_GAP` so the gap lives in the empty area after the card.
  const rowHeight = useMemo(() => {
    const cardWidth = (width - GRID_GAP * (cols - 1)) / cols;
    return Math.round(cardWidth * (16 / 9)) + GRID_GAP;
  }, [cols, width]);

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
              height: row.size - GRID_GAP,
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
