"use client";

import { GlobalSearch } from "@/components/feed/global-search";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { useMemo } from "react";

/** Sticky top-center search pill. Wraps GlobalSearch in a glass-pill shell so
 *  the autocomplete UX is one-click-less than the old overlay. Stays inside
 *  <main> so the lg:pl-20 Rail offset applies — it never overlaps the Rail.
 *
 *  Posts filter mirrors app/(consumption)/page.tsx line 140 exactly:
 *    userPosts.filter((p) => !p.type || p.type === "video")
 *  so autocomplete sees the same content set as the discovery feed. */
export function TopSearchPill() {
  const userPosts = useFeedStore((s) => s.userPosts);
  const posts: FeedPost[] = useMemo(
    () => userPosts.filter((p) => !p.type || p.type === "video"),
    [userPosts],
  );
  return (
    <div className="sticky top-0 z-20 flex justify-center px-4 pt-3 pb-2">
      <div className="glass-pill w-full max-w-xl px-3 py-1.5">
        <GlobalSearch posts={posts} />
      </div>
    </div>
  );
}
