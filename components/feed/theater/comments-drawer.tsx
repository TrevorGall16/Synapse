"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Send, ChevronUp, ChevronDown, CornerDownRight, Trash2,
  X, AlertCircle, ArrowUp, Minus, Plus, MessageCircleOff,
} from "lucide-react";
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

// ── CommentsDrawer ───────────────────────────────────────────────────────────

interface CommentsDrawerProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
  commentsEnabled?: boolean;
}

export function CommentsDrawer({ postId, isOpen, onClose, commentsEnabled = true }: CommentsDrawerProps) {
  const fetchComments = useCommentStore((s) => s.fetchComments);
  const addComment = useCommentStore((s) => s.addComment);
  // Subscribe directly to the array for this post — Zustand shallow compare
  // catches the new array ref produced by addComment's immutable spread.
  const postComments = useCommentStore(
    useCallback((s) => s.commentsByPost[postId] ?? [], [postId]),
  );
  const hasMore = useCommentStore((s) => s.hasMore);
  const userId = useUserStore((s) => s.commentUserId);

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Single shared timestamp ticker at drawer level — no per-comment intervals
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [isOpen]);

  // Track collapsed comment IDs at the drawer level for thread-aware rendering
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Highlight pulse target — set after jump-to-parent
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Load comments on first open
  useEffect(() => {
    if (isOpen && commentsEnabled) fetchComments(postId);
  }, [isOpen, postId, fetchComments, commentsEnabled]);

  // Focus input when reply target changes
  useEffect(() => {
    if (replyTo !== null) inputRef.current?.focus();
  }, [replyTo]);

  // Sort by path for threaded display — recomputes when postComments ref changes
  const sortedComments = useMemo(
    () => [...postComments].sort((a, b) => a.path.localeCompare(b.path)),
    [postComments],
  );

  // Filter out comments whose ancestor is collapsed
  const visibleComments = useMemo(() => {
    if (collapsedIds.size === 0) return sortedComments;
    // Build a set of collapsed paths for fast prefix matching
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

    // Expand ancestors: for each collapsed ID, check if target's path starts with it
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

    // Scroll after React re-renders the expanded thread
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`#comment-${CSS.escape(targetId)}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightId(targetId);
        setTimeout(() => setHighlightId(null), 1500);
      }
    });
  }, [postComments]);

  const handleSubmit = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed || !userId) return;
    addComment(postId, userId, trimmed, replyTo);
    setBody("");
    setReplyTo(null);
    // Scroll to bottom after insert
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }, [body, userId, postId, replyTo, addComment]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleLoadMore = () => {
    const last = sortedComments[sortedComments.length - 1];
    if (last) fetchComments(postId, last.created_at);
  };

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
            {postComments.filter((c) => !c.is_deleted).length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
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
          <div className="space-y-1 py-2">
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
            {hasMore[postId] && (
              <button
                onClick={handleLoadMore}
                className="mx-4 my-2 rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-white/50 transition-colors hover:bg-white/10"
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
          <div className="flex items-center gap-2 border-t border-purple-400/20 bg-purple-500/10 px-4 py-2">
            <CornerDownRight size={12} className="shrink-0 text-purple-400/60" />
            <div className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-purple-300">Replying to @{authorName}</span>
              <p className="truncate text-xs text-white/40">
                {replyTarget.body.slice(0, 60)}
                {replyTarget.body.length > 60 ? "..." : ""}
              </p>
            </div>
            <button
              onClick={() => jumpToComment(replyTo)}
              title="Jump to comment"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-purple-400/60 transition-colors hover:bg-white/10 hover:text-purple-300"
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
          <div className="flex items-end gap-2 rounded-lg bg-white/8 px-3 py-2">
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
                  ? "bg-purple-500 text-white hover:bg-purple-400"
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
  /** Shared timestamp from drawer — avoids per-comment intervals */
  tick: number;
}

function CommentNode({
  comment, postId, userId, onReply, isReplyTarget, isHighlighted,
  allComments, collapsedIds, onToggleCollapse, onJumpToComment, tick,
}: CommentNodeProps) {
  const getScore = useCommentStore((s) => s.getScore);
  const getUserVote = useCommentStore((s) => s.getUserVote);
  const handleVote = useCommentStore((s) => s.handleVote);
  const deleteComment = useCommentStore((s) => s.deleteComment);
  const dismissFailedComment = useCommentStore((s) => s.dismissFailedComment);
  const getAuthor = useCommentStore((s) => s.getAuthor);

  const score = getScore(comment.id);
  const userVote = getUserVote(comment.id, userId);
  const author = getAuthor(comment.author_id);
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

  const timestamp = timeAgo(comment.created_at, tick);

  if (comment.is_deleted) {
    return (
      <div
        id={`comment-${comment.id}`}
        className="flex items-center gap-2 py-2 text-xs italic text-white/25"
        style={{ paddingLeft: `${indent * 16 + 12}px` }}
      >
        <span>[deleted]</span>
      </div>
    );
  }

  return (
    <div
      id={`comment-${comment.id}`}
      data-comment-id={comment.id}
      className={`group relative py-3 transition-all duration-300
        ${isPending ? "opacity-60" : isFailed ? "opacity-40" : ""}
        ${isReplyTarget ? "ring-1 ring-purple-400/50 bg-purple-500/10 rounded-lg" : ""}
        ${isHighlighted ? "bg-purple-500/15 ring-1 ring-purple-400/40 rounded-lg animate-pulse" : ""}
      `}
      style={{ paddingLeft: `${indent * 16 + 12}px`, paddingRight: 12 }}
    >
      {/* Clickable thread guide line — thicker and higher contrast */}
      {indent > 0 && (
        <button
          onClick={() => onToggleCollapse(comment.id)}
          className="absolute top-0 bottom-0 flex items-stretch group/thread"
          style={{ left: `${indent * 16}px`, width: 14, padding: "0 5px" }}
          title={isCollapsed ? "Expand thread" : "Collapse thread"}
        >
          <div className={`w-[2px] rounded-full transition-colors ${isCollapsed ? "bg-purple-400/60" : "bg-white/15 group-hover/thread:bg-white/40"}`} />
        </button>
      )}

      {/* Header row */}
      <div className="mb-1 flex items-center gap-2">
        {/* Collapse/expand toggle */}
        {hasChildren && (
          <button
            onClick={() => onToggleCollapse(comment.id)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
            title={isCollapsed ? "Expand thread" : "Collapse thread"}
          >
            {isCollapsed ? <Plus size={12} /> : <Minus size={12} />}
          </button>
        )}
        {/* Avatar */}
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{ background: `hsl(${hue} 50% 30%)` }}
        >
          {displayName[0]?.toUpperCase()}
        </div>
        <span className="text-sm font-semibold text-white/80">{displayName}</span>
        <span className="text-xs text-white/30">{timestamp}</span>
        {isCollapsed && hasChildren && (
          <span className="text-xs text-white/20">[{childComments.length} hidden]</span>
        )}
        {isPending && <span className="text-xs text-yellow-400/60">sending...</span>}
        {isFailed && (
          <button
            onClick={() => dismissFailedComment(postId, comment.id)}
            className="flex h-8 items-center gap-1 rounded-full px-2 text-xs text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-300"
          >
            <AlertCircle size={12} /> Failed — tap to dismiss
          </button>
        )}
      </div>

      {/* Body */}
      {!isCollapsed && (
        <p className="mb-2 text-sm leading-relaxed text-white/75">{comment.body}</p>
      )}

      {/* Action row — always visible for accessibility */}
      {!isCollapsed && (
        <div className="flex items-center gap-3">
          {/* Votes with framer-motion */}
          <div className="flex items-center gap-1">
            <motion.button
              whileTap={{ scale: 0.8 }}
              whileHover={{ scale: 1.1 }}
              onClick={() => handleVote(comment.id, userId, 1)}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${userVote === 1 ? "text-orange-500 bg-orange-500/10" : "text-white/30 hover:bg-white/10 hover:text-white/60"}`}
            >
              <ChevronUp size={16} />
            </motion.button>
            <span className={`min-w-[20px] text-center text-xs tabular-nums font-medium ${score > 0 ? "text-orange-500" : score < 0 ? "text-indigo-400" : "text-white/30"}`}>
              {score}
            </span>
            <motion.button
              whileTap={{ scale: 0.8 }}
              whileHover={{ scale: 1.1 }}
              onClick={() => handleVote(comment.id, userId, -1)}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${userVote === -1 ? "text-indigo-400 bg-indigo-500/10" : "text-white/30 hover:bg-white/10 hover:text-white/60"}`}
            >
              <ChevronDown size={16} />
            </motion.button>
          </div>

          {/* Reply */}
          {comment.depth < 8 && (
            <button
              onClick={() => onReply(comment.id)}
              className="flex h-8 items-center gap-1 rounded-full px-2 text-xs text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
            >
              <CornerDownRight size={12} /> Reply
            </button>
          )}

          {/* Jump to parent */}
          {comment.parent_id && (
            <button
              onClick={() => onJumpToComment(comment.parent_id!)}
              title="Jump to parent"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/20 transition-colors hover:bg-white/10 hover:text-white/50"
            >
              <ArrowUp size={12} />
            </button>
          )}

          {/* Delete (own only) */}
          {isOwn && !isPending && (
            <button
              onClick={() => deleteComment(postId, comment.id)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/20 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
