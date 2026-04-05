/**
 * Centralized comment hierarchy logic — mirrors the DB trigger exactly.
 * Used by the mock store; will be replaced by server-side trigger in production.
 */

/** Generate a v4-style UUID using crypto.randomUUID */
export function genId(): string {
  return crypto.randomUUID();
}

export interface CommentHierarchy {
  root_id: string;
  depth: number;
  path: string;
}

const MAX_DEPTH = 8;

/**
 * Compute root_id, depth, and path for a new comment.
 * Mirrors the `compute_comment_hierarchy` Postgres trigger.
 *
 * @param commentId - The new comment's UUID
 * @param parent - The parent comment (null for top-level)
 * @throws If depth would exceed MAX_DEPTH
 */
export function computeHierarchy(
  commentId: string,
  parent: { root_id: string; depth: number; path: string } | null
): CommentHierarchy {
  if (!parent) {
    return { root_id: commentId, depth: 0, path: commentId };
  }
  const depth = parent.depth + 1;
  if (depth > MAX_DEPTH) {
    throw new Error(`Maximum comment depth (${MAX_DEPTH}) exceeded`);
  }
  return {
    root_id: parent.root_id,
    depth,
    path: `${parent.path}.${commentId}`,
  };
}
