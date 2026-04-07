/**
 * lib/canonical.ts
 *
 * Single source of truth for the site's canonical base URL. Used by:
 *   • Next.js server layouts for metadata/canonical/OpenGraph URLs
 *   • Share-sheet clipboard + social intent link generators
 *   • Any feature that needs a fully-qualified, environment-aware URL
 *
 * Resolution order (strictest → loosest):
 *   1. NEXT_PUBLIC_SITE_URL          — production / deploys
 *   2. NEXT_PUBLIC_VERCEL_URL        — Vercel preview (no protocol)
 *   3. VERCEL_URL                    — server-side Vercel preview
 *   4. http://localhost:3000         — dev fallback
 *
 * Safe to import from server components, client components, and metadata
 * generators — has no browser globals, no imports of client-only code.
 */

/** Returns the canonical base URL (protocol + host, no trailing slash). */
export function getCanonicalBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  const withProto = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return withProto.replace(/\/+$/, "");
}

/** Build a fully-qualified URL from a path. `path` should start with '/'. */
export function absoluteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${getCanonicalBaseUrl()}${p}`;
}

/** Canonical share URL for a feed post — used by ShareSheet and buildPostShareUrl. */
export function buildPostCanonicalUrl(postId: string): string {
  return absoluteUrl(`/video/${postId}`);
}

/** Canonical profile URL for a creator handle. */
export function buildProfileCanonicalUrl(handle: string): string {
  return absoluteUrl(`/profile/${handle}`);
}
