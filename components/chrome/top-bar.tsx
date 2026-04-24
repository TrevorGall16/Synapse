"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Upload, User, Zap } from "lucide-react";
import { GlobalSearch } from "@/components/feed/global-search";
import { useFeedStore, type FeedPost } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";

/** Slim, unified top chrome for the Consumption shell.
 *
 *  Layout: [ spacer ]  [ centered Ghost search ]  [ Upload / Profile / Studio ]
 *  - Sits inside <main>, so the lg:pl-20 Glass Rail offset naturally applies
 *    and the bar starts to the right of the rail on desktop.
 *  - Ghost glass surface + hairline so it floats over the scrolling feed
 *    without stealing visual weight.
 *  - Right-side actions are desktop-only; the mobile GlassIsland handles
 *    primary navigation on small viewports. */
export function TopBar() {
  const userPosts = useFeedStore((s) => s.userPosts);
  const profile = useUserStore((s) => s.profile);
  const posts: FeedPost[] = useMemo(
    () => userPosts.filter((p) => !p.type || p.type === "video"),
    [userPosts],
  );

  const profileHref = profile ? `/profile/${profile.username}` : "/login";
  const action =
    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white";
  const studio =
    "flex items-center gap-1.5 rounded-full bg-brand/20 px-3 py-1.5 text-[11px] font-bold text-brand-text transition-colors hover:bg-brand/30";

  return (
    <header
      aria-label="Top bar"
      className="glass-surface-ghost sticky top-0 z-20 flex h-[52px] w-full items-center gap-3 px-4"
    >
      {/* Left spacer — keeps the search optically centered in the main column
          (which is already offset by lg:pl-20 for the Glass Rail). */}
      <div className="min-w-0 flex-1" />

      <div className="flex min-w-0 flex-1 justify-center">
        <div className="w-full max-w-xl">
          <GlobalSearch posts={posts} />
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 items-center justify-end gap-1 lg:flex">
        <Link href="/upload" className={action} aria-label="Upload">
          <Upload size={13} />
          Upload
        </Link>
        <Link href={profileHref} className={action} aria-label="Profile">
          <User size={13} />
          Profile
        </Link>
        <Link href="/studio" className={studio} aria-label="Studio">
          <Zap size={13} />
          Studio
        </Link>
      </div>
    </header>
  );
}
