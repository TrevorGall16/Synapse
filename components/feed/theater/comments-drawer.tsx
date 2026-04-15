"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, ChevronUp, ChevronDown, CornerDownRight, Trash2,
  X, AlertCircle, ArrowUp, Minus, Plus, MessageCircleOff,
  Flame, Clock,
} from "lucide-react";
import Link from "next/link";
import { useCommentStore, type Comment } from "@/lib/store/comment-store";
import { useUserStore } from "@/lib/store/user-store";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string, _tick: number): string {
  const ms = _tick - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

/** Visual indent caps at 5 to prevent narrow comments */
const MAX_INDENT_DEPTH = 5;

/** Stable empty array — avoids new [] on every selector read when no comments exist */
const EMPTY_COMMENTS: Comment[] = [];

type SortMode = "top" | "new";

// ── CommentsDrawer ───────────────────────────────────────────────────────────

interface CommentsDrawerProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
  commentsEnabled?: boolean;
}

export function CommentsDrawer({ postId, isOpen, onClose, commentsEnabled = true }: CommentsDrawerProps) {
  // State-only selectors — no action subscriptions to avoid re-render loops.
  const postComments = useCommentStore((s) => s.commentsByPost[postId] ?? EMPTY_COMMENTS);
  const hasMore = useCommentStore((s) => !!s.hasMore[postId]);
  const userId = useUserStore((s) => s.commentUserId);

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("new");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Single shared timestamp ticker at drawer level — no per-comment intervals.
  // Initialized to 0 so the render stays pure; seeded from Date.now() on the
  // microtask after mount (off the effect body) and refreshed every 30s while
  // open. Sub-millisecond seed delay is imperceptible for relative-time
  // labels ("2m ago") which are the only consumers.
  const [tick, setTick] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) setTick(Date.now()); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [isOpen]);

  // Track collapsed comment IDs at the drawer level for thread-aware rendering
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Highlight pulse target — set after jump-to-parent
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Load comments on first open — access action via getState() to avoid selector subscription.
  useEffect(() => {
    if (!isOpen || !postId || !commentsEnabled) return;
    useCommentStore.getState().fetchComments(postId);
  }, [isOpen, postId, commentsEnabled]);

  // Focus input when reply target changes
  useEffect(() => {
    if (replyTo !== null) inputRef.current?.focus();
  }, [replyTo]);

  // Subscribe to votes map so we can sort by score reactively
  const votes = useCommentStore((s) => s.votes);

  // Sort comments based on mode
  const sortedComments = useMemo(() => {
    const byPath = [...postComments].sort((a, b) => a.path.localeCompare(b.path));

    if (sortMode === "new") {
      // Group threads by root, sort roots by newest, keep thread order within
      const rootOrder = new Map<string, string>(); // root_id -> newest created_at
      for (const c of byPath) {
        const existing = rootOrder.get(c.root_id);
        if (!existing || c.created_at > existing) {
          rootOrder.set(c.root_id, c.created_at);
        }
      }
      return [...byPath].sort((a, b) => {
        // Different roots: sort by newest in root
        if (a.root_id !== b.root_id) {
          const aNewest = rootOrder.get(a.root_id) ?? a.created_at;
          const bNewest = rootOrder.get(b.root_id) ?? b.created_at;
          return bNewest.localeCompare(aNewest);
        }
        // Same root: preserve path order for threading
        return a.path.localeCompare(b.path);
      });
    }

    // "top" mode: sort root threads by total score, tie-break by newest
    const rootScores = new Map<string, number>();
    for (const c of byPath) {
      let score = 0;
      for (const [key, vote] of Object.entries(votes)) {
        if (key.startsWith(`${c.id}:`)) score += vote.value;
      }
      rootScores.set(c.root_id, (rootScores.get(c.root_id) ?? 0) + score);
    }
    const rootNewest = new Map<string, string>();
    for (const c of byPath) {
      const existing = rootNewest.get(c.root_id);
      if (!existing || c.created_at > existing) rootNewest.set(c.root_id, c.created_at);
    }

    return [...byPath].sort((a, b) => {
      if (a.root_id !== b.root_id) {
        const aScore = rootScores.get(a.root_id) ?? 0;
        const bScore = rootScores.get(b.root_id) ?? 0;
        if (bScore !== aScore) return bScore - aScore;
        // Tie-break by newest
        const aTime = rootNewest.get(a.root_id) ?? a.created_at;
        const bTime = rootNewest.get(b.root_id) ?? b.created_at;
        return bTime.localeCompare(aTime);
      }
      return a.path.localeCompare(b.path);
    });
  }, [postComments, sortMode, votes]);

  // Filter out comments whose ancestor is collapsed
  const visibleComments = useMemo(() => {
    if (collapsedIds.size === 0) return sortedComments;
    const collapsedPaths: string[] = [];
    for (const id of collapsedIds) {
      const c = postComments.find((x) => x.id === id);
      if (c) collapsedPaths.push(c.path + ".");
    }
    if (collapsedPaths.length === 0) return sortedComments;
    return sortedComments.filter(
      (c) => !collapsedPaths.some((prefix) => c.path.startsWith(prefix)),
    );
  }, [sortedComments, collapsedIds, postComments]);

  // Find reply target comment for display
  const replyTarget = replyTo ? postComments.find((c) => c.id === replyTo) : null;

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Expand all ancestors of a comment, then scroll to it and pulse-highlight */
  const jumpToComment = useCallback((targetId: string) => {
    const target = postComments.find((c) => c.id === targetId);
    if (!target) return;

    // Expand ancestors
    setCollapsedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      for (const id of prev) {
        const collapsed = postComments.find((x) => x.id === id);
        if (collapsed && target.path.startsWith(collapsed.path + ".")) {
          next.delete(id);
        }
      }
      return next.size === prev.size ? prev : next;
    });

    // Double rAF to ensure React has committed expanded children
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = scrollRef.current;
        if (!container) return;
        const el = container.querySelector(`#comment-${CSS.escape(targetId)}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setHighlightId(targetId);
          setTimeout(() => setHighlightId(null), 1800);
        }
      });
    });
  }, [postComments]);

  const handleSubmit = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed || !userId) return;
    useCommentStore.getState().addComment(postId, userId, trimmed, replyTo);
    setBody("");
    setReplyTo(null);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }, [body, userId, postId, replyTo]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleLoadMore = () => {
    const last = sortedComments[sortedComments.length - 1];
    if (last) useCommentStore.getState().fetchComments(postId, last.created_at);
  };

  const activeCount = postComments.filter((c) => !c.is_deleted).length;

  return (
    <div
      className={`flex h-full flex-col transition-all duration-300 ease-out overflow-hidden
        ${isOpen
          ? "border-l border-white/10 opacity-100 max-md:fixed max-md:inset-0 max-md:z-[60] max-md:w-full max-md:border-l-0 md:w-[350px]"
          : "w-0 opacity-0 pointer-events-none border-l-0"
        }`}
      style={{
        background: isOpen ? "rgba(18,18,18,0.95)" : "transparent",
        backdropFilter: isOpen ? "blur(12px)" : "none",
        WebkitBackdropFilter: isOpen ? "blur(12px)" : "none",
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white/90">Comments</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums text-white/50">
            {activeCount}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Sort toggle */}
          {commentsEnabled && activeCount > 0 && (
            <div className="mr-1 flex items-center rounded-full bg-white/5 p-0.5">
              <button
                onClick={() => setSortMode("top")}
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors ${
                  sortMode === "top"
                    ? "bg-white/10 text-orange-400"
                    : "text-white/30 hover:text-white/50"
                }`}
                title="Sort by top score"
              >
                <Flame size={10} /> Top
              </button>
              <button
                onClick={() => setSortMode("new")}
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors ${
                  sortMode === "new"
                    ? "bg-white/10 text-brand-accent"
                    : "text-white/30 hover:text-white/50"
                }`}
                title="Sort by newest"
              >
                <Clock size={10} /> New
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Comment list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
      >
        {!commentsEnabled ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
            <MessageCircleOff size={32} className="text-white/20" />
            <p className="text-center text-sm text-white/30">Comments are turned off for this post</p>
          </div>
        ) : visibleComments.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-white/25">No comments yet. Be the first!</p>
          </div>
        ) : (
          <div className="space-y-3 px-2 py-3">
            {visibleComments.map((c) => (
              <CommentNode
                key={c.id}
                comment={c}
                postId={postId}
                userId={userId ?? ""}
                onReply={setReplyTo}
                isReplyTarget={replyTo === c.id}
                isHighlighted={highlightId === c.id}
                allComments={sortedComments}
                collapsedIds={collapsedIds}
                onToggleCollapse={toggleCollapse}
                onJumpToComment={jumpToComment}
                tick={tick}
              />
            ))}
            {hasMore && (
              <button
                onClick={handleLoadMore}
                className="mx-2 my-1 rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-white/50 transition-colors hover:bg-white/10"
              >
                Load more...
              </button>
            )}
          </div>
        )}
      </div>

      {/* Reply context banner */}
      {commentsEnabled && replyTo && replyTarget && (() => {
        const replyAuthor = useCommentStore.getState().getAuthor(replyTarget.author_id);
        const authorName = replyAuthor?.username ?? replyAuthor?.displayName ?? "unknown";
        return (
          <div className="flex items-center gap-2 border-t border-brand-accent/20 bg-brand/10 px-4 py-2">
            <CornerDownRight size={12} className="shrink-0 text-brand-accent/60" />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-brand-text">Replying to @{authorName}</span>
              <p className="truncate text-xs text-white/40">
                {replyTarget.body.slice(0, 60)}
                {replyTarget.body.length > 60 ? "..." : ""}
              </p>
            </div>
            <button
              onClick={() => jumpToComment(replyTo)}
              title="Jump to comment"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-brand-accent/60 transition-colors hover:bg-white/10 hover:text-brand-text"
            >
              <ArrowUp size={14} />
            </button>
            <button
              onClick={() => setReplyTo(null)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
            >
              <X size={12} />
            </button>
          </div>
        );
      })()}

      {/* Input area — hidden when comments disabled */}
      {commentsEnabled ? (
        <div className="shrink-0 border-t border-white/10 px-3 py-2.5">
          <div className="flex items-end gap-2 rounded-xl bg-white/8 px-3 py-2 border border-white/5">
            <textarea
              ref={inputRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={replyTo ? "Write a reply..." : "Add a comment..."}
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-white/80 placeholder-white/25 outline-none"
              style={{ maxHeight: 80 }}
            />
            <button
              onClick={handleSubmit}
              disabled={!body.trim()}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                body.trim()
                  ? "bg-brand text-white hover:bg-brand-accent"
                  : "bg-white/10 text-white/20"
              }`}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 border-t border-white/10 px-4 py-3">
          <p className="text-center text-xs text-white/25">Comments are turned off</p>
        </div>
      )}
    </div>
  );
}

// ── CommentNode ─────────────────────────────────────────────────────────────

interface CommentNodeProps {
  comment: Comment;
  postId: string;
  userId: string;
  onReply: (parentId: string) => void;
  isReplyTarget?: boolean;
  isHighlighted?: boolean;
  allComments: Comment[];
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onJumpToComment: (id: string) => void;
  tick: number;
}

function CommentNode({
  comment, postId, userId, onReply, isReplyTarget, isHighlighted,
  allComments, collapsedIds, onToggleCollapse, onJumpToComment, tick,
}: CommentNodeProps) {
  // Reactive selectors for vote display — primitives are stable, no loop risk.
  const score = useCommentStore((s) => {
    let sc = 0;
    for (const [key, vote] of Object.entries(s.votes)) {
      if (key.startsWith(`${comment.id}:`)) sc += vote.value;
    }
    return sc;
  });
  const userVote = useCommentStore(
    (s) => s.votes[`${comment.id}:${userId}`]?.value ?? 0,
  );

  // Author data is static — safe to read once via getState()
  const author = useCommentStore.getState().getAuthor(comment.author_id);
  const isOwn = comment.author_id === userId;
  const isPending = comment._status === "pending";
  const isFailed = comment._status === "failed";
  const indent = Math.min(comment.depth, MAX_INDENT_DEPTH);

  const profile = useUserStore((s) => s.profile);
  const displayName = isOwn
    ? (profile?.displayName ?? profile?.username ?? "You")
    : (author?.displayName ?? author?.username ?? "Unknown");
  const hue = isOwn ? (profile?.hue ?? 270) : (author?.hue ?? 200);

  const childComments = allComments.filter(
    (c) => c.path.startsWith(comment.path + ".") && c.id !== comment.id,
  );
  const hasChildren = childComments.length > 0;
  const isCollapsed = collapsedIds.has(comment.id);
  const isRoot = comment.depth === 0;

  const timestamp = timeAgo(comment.created_at, tick);

  if (comment.is_deleted) {
    return (
      <div
        id={`comment-${comment.id}`}
        className="flex items-center gap-2 py-2 text-xs italic text-white/20"
        style={{ marginLeft: `${indent * 16}px` }}
      >
        <span>[deleted]</span>
      </div>
    );
  }

  return (
    <div
      id={`comment-${comment.id}`}
      data-comment-id={comment.id}
      className={`group relative transition-all duration-300
        ${isRoot ? "" : "ml-3"}
        ${isPending ? "opacity-60" : isFailed ? "opacity-40" : ""}
      `}
      style={{ marginLeft: indent > 0 ? `${indent * 16}px` : undefined }}
    >
      {/* Glassmorphism bubble */}
      <div
        className={`relative rounded-2xl border px-3.5 py-3 transition-all duration-300 drop-shadow-sm
          ${isHighlighted
            ? "border-brand-accent/40 bg-brand/15 shadow-[0_0_20px_color-mix(in_oklch,var(--color-brand)_15%,transparent)]"
            : isReplyTarget
              ? "border-brand-accent/30 bg-brand/8"
              : isOwn
                ? "border-brand-accent/15 bg-brand/[0.06] hover:bg-brand/[0.09]"
                : "border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.06]"
          }
        `}
        style={{
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* Thread guide line for nested comments */}
        {indent > 0 && (
          <button
            onClick={() => onToggleCollapse(comment.id)}
            className="absolute -left-3 top-0 bottom-0 flex items-stretch group/thread"
            style={{ width: 14, padding: "0 5px" }}
            title={isCollapsed ? "Expand thread" : "Collapse thread"}
          >
            <div className={`w-[2px] rounded-full transition-colors ${isCollapsed ? "bg-brand-accent/60" : "bg-white/10 group-hover/thread:bg-white/30"}`} />
          </button>
        )}

        {/* Header row */}
        <div className="mb-1.5 flex items-center gap-2">
          {hasChildren && (
            <button
              onClick={() => onToggleCollapse(comment.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/25 transition-colors hover:bg-white/10 hover:text-white/50"
              title={isCollapsed ? "Expand thread" : "Collapse thread"}
            >
              {isCollapsed ? <Plus size={11} /> : <Minus size={11} />}
            </button>
          )}
          {/* Avatar + name — link to profile */}
          <Link
            href={isOwn ? "/profile/you" : `/profile/${author?.username ?? comment.author_id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 cursor-pointer group/author"
          >
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white/90 transition-transform group-hover/author:scale-110 ${isOwn ? "ring-1 ring-brand-accent/40" : ""}`}
              style={{ background: `hsl(${hue} 45% 28%)` }}
            >
              {displayName[0]?.toUpperCase()}
            </div>
            <span className="text-xs font-semibold text-white/75 group-hover/author:text-white transition-colors">{displayName}</span>
          </Link>
          {isOwn && <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand-text/80">You</span>}
          <span className="text-[10px] text-white/25">{timestamp}</span>
          {isCollapsed && hasChildren && (
            <span className="text-[10px] text-white/15">[{childComments.length} hidden]</span>
          )}
          {isPending && <span className="text-[10px] text-yellow-400/50">sending...</span>}
          {isFailed && (
            <button
              onClick={() => useCommentStore.getState().dismissFailedComment(postId, comment.id)}
              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-red-400/70 transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              <AlertCircle size={10} /> Failed — dismiss
            </button>
          )}
        </div>

        {/* Body */}
        <AnimatePresence>
          {!isCollapsed && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-2 text-[13px] leading-relaxed text-white/65"
            >
              {comment.body}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Action row */}
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            {/* Votes */}
            <div className="flex items-center gap-0.5 rounded-full bg-white/[0.03] px-1">
              <motion.button
                whileTap={{ scale: 0.8 }}
                onClick={() => useCommentStore.getState().handleVote(comment.id, userId, 1)}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  userVote === 1
                    ? "text-orange-400 bg-orange-500/10"
                    : "text-white/20 hover:bg-white/10 hover:text-white/50"
                }`}
              >
                <ChevronUp size={14} />
              </motion.button>
              <span className={`min-w-[18px] text-center text-[11px] tabular-nums font-semibold ${
                score > 0 ? "text-orange-400" : score < 0 ? "text-indigo-400" : "text-white/20"
              }`}>
                {score}
              </span>
              <motion.button
                whileTap={{ scale: 0.8 }}
                onClick={() => useCommentStore.getState().handleVote(comment.id, userId, -1)}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
                  userVote === -1
                    ? "text-indigo-400 bg-indigo-500/10"
                    : "text-white/20 hover:bg-white/10 hover:text-white/50"
                }`}
              >
                <ChevronDown size={14} />
              </motion.button>
            </div>

            {/* Reply */}
            {comment.depth < 8 && (
              <button
                onClick={() => onReply(comment.id)}
                className="flex h-7 items-center gap-1 rounded-full px-2 text-[10px] text-white/25 transition-colors hover:bg-white/8 hover:text-white/50"
              >
                <CornerDownRight size={10} /> Reply
              </button>
            )}

            {/* Jump to parent */}
            {comment.parent_id && (
              <button
                onClick={() => onJumpToComment(comment.parent_id!)}
                title="Jump to parent"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/15 transition-colors hover:bg-white/8 hover:text-white/40"
              >
                <ArrowUp size={11} />
              </button>
            )}

            {/* Delete (own only) */}
            {isOwn && !isPending && (
              <button
                onClick={() => useCommentStore.getState().deleteComment(postId, comment.id)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/15 transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 size={10} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
