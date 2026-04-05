/** Canonical share URL for a feed post. */
export function buildPostShareUrl(postId: string): string {
  return `${window.location.origin}/video/${postId}`;
}
