"use client";

import { create } from "zustand";
import { genId, computeHierarchy } from "@/lib/utils/comment-helpers";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  root_id: string;
  body: string;
  depth: number;
  path: string;
  is_deleted: boolean;
  created_at: string; // ISO timestamp
  updated_at: string;
  /** Client-only: tracks optimistic insert status */
  _status?: "pending" | "confirmed" | "failed";
  /** Client-only: temporary ID before server confirms */
  _temp_id?: string;
}

export interface CommentVote {
  comment_id: string;
  user_id: string;
  value: -1 | 1;
}

export interface CommentAuthor {
  id: string;
  username: string;
  displayName: string;
  hue: number;
}

const PAGE_SIZE = 20;

// ── Mock seed data ──────────────────────────────────────────────────────────

function buildMockComments(postId: string): Comment[] {
  const now = new Date();
  const authors = [
    { id: "a1", name: "aurora_vj" },
    { id: "a2", name: "neon_cut" },
    { id: "a3", name: "spectral_x" },
    { id: "a4", name: "deep.freq" },
  ];

  const comments: Comment[] = [];

  // Root comment 1
  const c1Id = "c-mock-001";
  comments.push({
    id: c1Id, post_id: postId, author_id: authors[0].id, parent_id: null,
    root_id: c1Id, body: "This edit is insane, the beat sync is perfectly timed", depth: 0, path: c1Id,
    is_deleted: false, created_at: new Date(now.getTime() - 3600_000).toISOString(), updated_at: new Date(now.getTime() - 3600_000).toISOString(),
  });

  // Reply to c1
  const c2Id = "c-mock-002";
  comments.push({
    id: c2Id, post_id: postId, author_id: authors[1].id, parent_id: c1Id,
    root_id: c1Id, body: "Right?? The transition at 0:04 is butter smooth", depth: 1, path: `${c1Id}.${c2Id}`,
    is_deleted: false, created_at: new Date(now.getTime() - 3000_000).toISOString(), updated_at: new Date(now.getTime() - 3000_000).toISOString(),
  });

  // Nested reply
  const c3Id = "c-mock-003";
  comments.push({
    id: c3Id, post_id: postId, author_id: authors[0].id, parent_id: c2Id,
    root_id: c1Id, body: "Thanks! Used the phase-shift preset for that one", depth: 2, path: `${c1Id}.${c2Id}.${c3Id}`,
    is_deleted: false, created_at: new Date(now.getTime() - 2400_000).toISOString(), updated_at: new Date(now.getTime() - 2400_000).toISOString(),
  });

  // Root comment 2
  const c4Id = "c-mock-004";
  comments.push({
    id: c4Id, post_id: postId, author_id: authors[2].id, parent_id: null,
    root_id: c4Id, body: "How did you get that glitch effect? Is that a custom shader?", depth: 0, path: c4Id,
    is_deleted: false, created_at: new Date(now.getTime() - 1800_000).toISOString(), updated_at: new Date(now.getTime() - 1800_000).toISOString(),
  });

  // Reply to c4
  const c5Id = "c-mock-005";
  comments.push({
    id: c5Id, post_id: postId, author_id: authors[3].id, parent_id: c4Id,
    root_id: c4Id, body: "Looks like the RGB Split preset from the community library", depth: 1, path: `${c4Id}.${c5Id}`,
    is_deleted: false, created_at: new Date(now.getTime() - 1200_000).toISOString(), updated_at: new Date(now.getTime() - 1200_000).toISOString(),
  });

  // Root comment 3
  const c6Id = "c-mock-006";
  comments.push({
    id: c6Id, post_id: postId, author_id: authors[1].id, parent_id: null,
    root_id: c6Id, body: "The color grading on this is chef's kiss", depth: 0, path: c6Id,
    is_deleted: false, created_at: new Date(now.getTime() - 600_000).toISOString(), updated_at: new Date(now.getTime() - 600_000).toISOString(),
  });

  return comments;
}

const MOCK_AUTHORS: CommentAuthor[] = [
  { id: "a1", username: "aurora_vj",  displayName: "Aurora VJ",  hue: 270 },
  { id: "a2", username: "neon_cut",   displayName: "Neon Cut",   hue: 340 },
  { id: "a3", username: "spectral_x", displayName: "Spectral X", hue: 200 },
  { id: "a4", username: "deep.freq",  displayName: "Deep Freq",  hue: 150 },
];

// ── Store ───────────────────────────────────────────────────────────────────

interface CommentState {
  /** Comments keyed by post_id */
  commentsByPost: Record<string, Comment[]>;
  /** Votes keyed by `${comment_id}:${user_id}` */
  votes: Record<string, CommentVote>;
  /** Author cache — keyed by author_id */
  authors: Record<string, CommentAuthor>;
  /** Cursor-based pagination: has more pages per post */
  hasMore: Record<string, boolean>;
  /** Track which posts have been initially loaded */
  loadedPosts: Set<string>;

  /** Fetch a page of comments for a post (cursor = last comment's created_at) */
  fetchComments: (postId: string, cursor?: string) => Comment[];
  /** Add a comment optimistically */
  addComment: (postId: string, authorId: string, body: string, parentId: string | null) => Comment;
  /** Confirm an optimistic comment (replace temp_id) */
  confirmComment: (postId: string, tempId: string, serverId?: string) => void;
  /** Mark an optimistic comment as failed */
  failComment: (postId: string, tempId: string) => void;
  /** Remove a failed comment from local state */
  dismissFailedComment: (postId: string, tempId: string) => void;
  /** Soft-delete a comment */
  deleteComment: (postId: string, commentId: string) => void;
  /** Atomic vote toggle: same value removes, different value flips */
  handleVote: (commentId: string, userId: string, newValue: -1 | 1) => void;
  /** Get net score for a comment */
  getScore: (commentId: string) => number;
  /** Get user's vote on a comment */
  getUserVote: (commentId: string, userId: string) => -1 | 1 | 0;
  /** Get author by ID */
  getAuthor: (authorId: string) => CommentAuthor | undefined;
}

export const useCommentStore = create<CommentState>()((set, get) => ({
  commentsByPost: {},
  votes: {},
  authors: Object.fromEntries(MOCK_AUTHORS.map((a) => [a.id, a])),
  hasMore: {},
  loadedPosts: new Set(),

  fetchComments: (postId, cursor) => {
    const state = get();

    // Initialize with mock data on first load
    if (!state.loadedPosts.has(postId)) {
      const mockComments = buildMockComments(postId);
      set((s) => ({
        loadedPosts: new Set([...s.loadedPosts, postId]),
        commentsByPost: { ...s.commentsByPost, [postId]: mockComments },
        hasMore: { ...s.hasMore, [postId]: false }, // mock data is complete
      }));
      return mockComments;
    }

    const all = state.commentsByPost[postId] ?? [];
    if (!cursor) {
      // First page: return sorted by path for threaded display
      const sorted = [...all].sort((a, b) => a.path.localeCompare(b.path));
      return sorted.slice(0, PAGE_SIZE);
    }

    // Cursor-based: return comments created after cursor
    const sorted = [...all]
      .sort((a, b) => a.path.localeCompare(b.path))
      .filter((c) => c.created_at > cursor);
    return sorted.slice(0, PAGE_SIZE);
  },

  addComment: (postId, authorId, body, parentId) => {
    const state = get();
    const tempId = `temp-${genId()}`;
    const now = new Date().toISOString();
    const allComments = state.commentsByPost[postId] ?? [];

    // Find parent for hierarchy computation
    const parent = parentId
      ? allComments.find((c) => c.id === parentId) ?? null
      : null;

    if (parentId && !parent) {
      console.warn(`[comment-store] Parent comment ${parentId} not found`);
    }

    const hierarchy = computeHierarchy(tempId, parent ? {
      root_id: parent.root_id,
      depth: parent.depth,
      path: parent.path,
    } : null);

    const comment: Comment = {
      id: tempId,
      post_id: postId,
      author_id: authorId,
      parent_id: parentId,
      root_id: hierarchy.root_id,
      body,
      depth: hierarchy.depth,
      path: hierarchy.path,
      is_deleted: false,
      created_at: now,
      updated_at: now,
      _status: "pending",
      _temp_id: tempId,
    };

    set((s) => ({
      commentsByPost: {
        ...s.commentsByPost,
        [postId]: [...(s.commentsByPost[postId] ?? []), comment],
      },
    }));

    // Simulate server confirmation after a short delay
    setTimeout(() => {
      get().confirmComment(postId, tempId);
    }, 300);

    return comment;
  },

  confirmComment: (postId, tempId, serverId) => {
    set((s) => {
      const comments = s.commentsByPost[postId] ?? [];
      return {
        commentsByPost: {
          ...s.commentsByPost,
          [postId]: comments.map((c) =>
            c.id === tempId
              ? { ...c, _status: "confirmed" as const, id: serverId ?? c.id }
              : c
          ),
        },
      };
    });
  },

  failComment: (postId, tempId) => {
    set((s) => {
      const comments = s.commentsByPost[postId] ?? [];
      return {
        commentsByPost: {
          ...s.commentsByPost,
          [postId]: comments.map((c) =>
            c.id === tempId ? { ...c, _status: "failed" as const } : c
          ),
        },
      };
    });
  },

  dismissFailedComment: (postId, tempId) => {
    set((s) => ({
      commentsByPost: {
        ...s.commentsByPost,
        [postId]: (s.commentsByPost[postId] ?? []).filter((c) => c.id !== tempId),
      },
    }));
  },

  deleteComment: (postId, commentId) => {
    set((s) => ({
      commentsByPost: {
        ...s.commentsByPost,
        [postId]: (s.commentsByPost[postId] ?? []).map((c) =>
          c.id === commentId ? { ...c, is_deleted: true, body: "[deleted]" } : c
        ),
      },
    }));
  },

  handleVote: (commentId, userId, newValue) => {
    const key = `${commentId}:${userId}`;
    const current = get().votes[key]?.value ?? 0;
    if (current === newValue) {
      // Same vote → remove (un-toggle)
      set((s) => {
        const { [key]: _, ...rest } = s.votes;
        return { votes: rest };
      });
    } else {
      // Different or no vote → set new value
      set((s) => ({
        votes: { ...s.votes, [key]: { comment_id: commentId, user_id: userId, value: newValue } },
      }));
    }
  },

  getScore: (commentId) => {
    const state = get();
    let score = 0;
    for (const [key, vote] of Object.entries(state.votes)) {
      if (key.startsWith(`${commentId}:`)) score += vote.value;
    }
    return score;
  },

  getUserVote: (commentId, userId) => {
    const key = `${commentId}:${userId}`;
    return get().votes[key]?.value ?? 0;
  },

  getAuthor: (authorId) => get().authors[authorId],
}));
