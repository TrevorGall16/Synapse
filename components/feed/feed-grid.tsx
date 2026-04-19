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

/** Measure the grid's rendered width AND column count. Both default to 0 on
 *  first render — the ResizeObserver in useIsoLayoutEffect captures the real
 *  container width before paint, and the FeedGrid mount-guard skips the
 *  virtualizer entirely while width === 0. This kills the Ctrl+R "gap shift"
 *  that previously happened when the lazy init seeded `window.innerWidth`
 *  (the outer window, not the inner scroll container) and the virtualizer
 *  computed rowHeight against the wrong width for the first frame. */
function useGridMetrics(ref: React.RefObject<HTMLDivElement | null>): { cols: number; width: number } {
  const [metrics, setMetrics] = useState<{ cols: number; width: number }>({ cols: 0, width: 0 });
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
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
  // Strict math from column width — never DOM-measured. Card aspect is 9/16
  // (portrait), so cardHeight = floor((columnWidth × 16) / 9). rowHeight adds
  // exactly one GRID_GAP so the vertical gap matches the horizontal gap-4
  // (16 px). The row container below renders at `row.size - GRID_GAP` so the
  // gap lives in the empty area after the card.
  const columnWidth = cols > 0 ? (width - GRID_GAP * (cols - 1)) / cols : 0;
  const rowHeight = useMemo(() => {
    if (columnWidth <= 0) return 0;
    return Math.floor((columnWidth * 16) / 9) + GRID_GAP;
  }, [columnWidth]);
  const rowCount = cols > 0 ? Math.ceil(posts.length / cols) : 0;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 2,
  });

  // Mount guard: until the ResizeObserver lands a real container width, render
  // an empty ref-bearing div. Mounting the virtualizer with a 0-width estimate
  // produces a stack of zero-height rows that visibly snap into place once the
  // first real measurement arrives — the "gap shift" users see on Ctrl+R.
  if (columnWidth <= 0) {
    return <div ref={gridRef} className="w-full" />;
  }

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
