import { buildPostCanonicalUrl, getCanonicalBaseUrl } from "@/lib/canonical";

/**
 * Canonical share URL for a feed post.
 *
 * Uses the environment-aware base URL in all contexts except the browser,
 * where `window.location.origin` is preferred so that localhost/preview
 * users get a URL that actually works on their own machine. Safe to call
 * from both client and server.
 */
export function buildPostShareUrl(postId: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/video/${postId}`;
  }
  return buildPostCanonicalUrl(postId);
}

export { getCanonicalBaseUrl };
