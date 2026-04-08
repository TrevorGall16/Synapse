/**
 * Shared navigation helper for TheaterMode → creator profile transitions.
 *
 * The callback chain is intentional:
 *   1. router.push('/profile/[handle]') fires FIRST while TheaterMode is still
 *      mounted — this lets the Next.js router commit the route transition
 *      before any unmount cleanup (popstate listeners, URL restore) can race
 *      us back to "/".
 *   2. closeTheater() tears down overlay state AFTER the push.
 *
 * Every consumer of TheaterMode's onCreator callback MUST go through this
 * helper instead of inlining the same logic. Inlined versions have drifted in
 * the past (forgotten ordering, missed setState) — centralizing fixes that.
 */

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { FeedPost } from "@/lib/store/feed-store";

/**
 * Route to a creator profile from within TheaterMode.
 *
 * @param router       Next.js app router instance (from `useRouter()`).
 * @param post         The currently-active post whose creator was clicked.
 * @param closeTheater Callback that clears theater overlay state in the parent.
 */
export function navigateToCreator(
  router: Pick<AppRouterInstance, "push">,
  post: FeedPost,
  closeTheater: () => void,
): void {
  // Router push must happen BEFORE closeTheater so the URL transition commits
  // while TheaterMode is still in the tree. See file-header comment.
  router.push(`/profile/${post.user.handle}`);
  // closeTheater is expected to do STATE teardown only (e.g.
  // setTheaterPostId(null)). Callers MUST NOT call router.push() from here —
  // a second push races the profile push and has caused "→ /" regressions in
  // the past (see /video/[id]/page.tsx history).
  try {
    closeTheater();
  } catch {
    /* swallow — caller teardown must not block profile navigation */
  }
}
