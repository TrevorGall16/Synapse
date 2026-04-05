"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, ChevronUp, ChevronDown, CornerDownRight, Trash2, X, AlertCircle, ArrowUp } from "lucide-react";
import { useCommentStore, type Comment } from "@/lib/store/comment-store";
import { useUserStore } from "@/lib/store/user-store";

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}

const MAX_INDENT_DEPTH = 4; // visual indent caps at 4, deeper replies are flat

// ── CommentNode ──────────────────────────────────────────────────────────────

interface CommentNodeProps {
  comment: Comment;
  postId: string;
  userId: string;
  onReply: (parentId: string) => void;
  isReplyTarget?: boolean;
}

function CommentNode({ comment, postId, userId, onReply, isReplyTarget }: CommentNodeProps) {
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

  // Author display — use local profile for own comments
  const profile = useUserStore((s) => s.profile);
  const displayName = isOwn
    ? (profile?.displayName ?? profile?.username ?? "You")
    : (author?.displayName ?? author?.username ?? "Unknown");
  const hue = isOwn ? (profile?.hue ?? 270) : (author?.hue ?? 200);

  if (comment.is_deleted) {
    return (
      <div
        className="flex items-center gap-2 py-1.5 text-[10px] italic text-white/25"
        style={{ paddingLeft: `${indent * 16 + 12}px` }}
      >
        <span>[deleted]</span>
      </div>
    );
  }

  return (
    <div
      data-comment-id={comment.id}
      className={`group relative py-2 transition-opacity ${isPending ? "opacity-60" : isFailed ? "opacity-40" : ""} ${isReplyTarget ? "ring-1 ring-purple-400/50 bg-purple-500/10 rounded" : ""}`}
      style={{ paddingLeft: `${indent * 16 + 12}px`, paddingRight: 12 }}
    >
      {/* Thread line */}
      {indent > 0 && (
        <div
          className="absolute top-0 bottom-0 w-px bg-white/10"
          style={{ left: `${indent * 16 + 4}px` }}
        />
      )}

      {/* Header row */}
      <div className="mb-0.5 flex items-center gap-1.5">
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
          style={{ background: `hsl(${hue} 50% 30%)` }}
        >
          {displayName[0]?.toUpperCase()}
        </div>
        <span className="text-[11px] font-semibold text-white/80">{displayName}</span>
        <span className="text-[9px] text-white/30">{timeAgo(comment.created_at)}</span>
        {isPending && <span className="text-[8px] text-yellow-400/60">sending...</span>}
        {isFailed && (
          <button
            onClick={() => dismissFailedComment(postId, comment.id)}
            className="flex items-center gap-0.5 text-[8px] text-red-400/80 hover:text-red-300"
          >
            <AlertCircle size={8} /> Failed — tap to dismiss
          </button>
        )}
      </div>

      {/* Body */}
      <p className="mb-1 text-[12px] leading-relaxed text-white/75">{comment.body}</p>

      {/* Action row */}
      <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        {/* Votes */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleVote(comment.id, userId, 1)}
            className={`rounded p-0.5 transition-colors ${userVote === 1 ? "text-emerald-400" : "text-white/30 hover:text-white/60"}`}
          >
            <ChevronUp size={12} />
          </button>
          <span className={`min-w-[16px] text-center text-[10px] tabular-nums ${score > 0 ? "text-emerald-400" : score < 0 ? "text-red-400" : "text-white/30"}`}>
            {score}
          </span>
          <button
            onClick={() => handleVote(comment.id, userId, -1)}
            className={`rounded p-0.5 transition-colors ${userVote === -1 ? "text-red-400" : "text-white/30 hover:text-white/60"}`}
          >
            <ChevronDown size={12} />
          </button>
        </div>

        {/* Reply */}
        {comment.depth < 8 && (
          <button
            onClick={() => onReply(comment.id)}
            className="flex items-center gap-0.5 text-[10px] text-white/30 transition-colors hover:text-white/60"
          >
            <CornerDownRight size={10} /> Reply
          </button>
        )}

        {/* Delete (own only) */}
        {isOwn && !isPending && (
          <button
            onClick={() => deleteComment(postId, comment.id)}
            className="text-white/20 transition-colors hover:text-red-400"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── CommentsDrawer ───────────────────────────────────────────────────────────

interface CommentsDrawerProps {
  postId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CommentsDrawer({ postId, isOpen, onClose }: CommentsDrawerProps) {
  const fetchComments = useCommentStore((s) => s.fetchComments);
  const addComment = useCommentStore((s) => s.addComment);
  const commentsByPost = useCommentStore((s) => s.commentsByPost);
  const hasMore = useCommentStore((s) => s.hasMore);
  const userId = useUserStore((s) => s.commentUserId);

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load comments on first open
  useEffect(() => {
    if (isOpen) fetchComments(postId);
  }, [isOpen, postId, fetchComments]);

  // Focus input when reply target changes
  useEffect(() => {
    if (replyTo !== null) inputRef.current?.focus();
  }, [replyTo]);

  const allComments = commentsByPost[postId] ?? [];
  // Sort by path for threaded display
  const sortedComments = [...allComments].sort((a, b) => a.path.localeCompare(b.path));

  // Find reply target comment for display
  const replyTarget = replyTo ? allComments.find((c) => c.id === replyTo) : null;

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
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tabular-nums text-white/50">
            {allComments.filter((c) => !c.is_deleted).length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {/* Comment list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}
      >
        {sortedComments.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-[12px] text-white/25">No comments yet. Be the first!</p>
          </div>
        ) : (
          <>
            {sortedComments.map((c) => (
              <CommentNode
                key={c.id}
                comment={c}
                postId={postId}
                userId={userId ?? ""}
                onReply={setReplyTo}
                isReplyTarget={replyTo === c.id}
              />
            ))}
            {hasMore[postId] && (
              <button
                onClick={handleLoadMore}
                className="mx-4 my-2 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/50 transition-colors hover:bg-white/10"
              >
                Load more...
              </button>
            )}
          </>
        )}
      </div>

      {/* Reply context banner */}
      {replyTo && replyTarget && (() => {
        const replyAuthor = useCommentStore.getState().getAuthor(replyTarget.author_id);
        const authorName = replyAuthor?.username ?? replyAuthor?.displayName ?? "unknown";
        return (
          <div className="flex items-center gap-2 border-t border-purple-400/20 bg-purple-500/10 px-4 py-1.5">
            <CornerDownRight size={10} className="shrink-0 text-purple-400/60" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-semibold text-purple-300">Replying to @{authorName}</span>
              <p className="truncate text-[10px] text-white/40">
                {replyTarget.body.slice(0, 60)}
                {replyTarget.body.length > 60 ? "..." : ""}
              </p>
            </div>
            <button
              onClick={() => {
                const el = scrollRef.current?.querySelector(`[data-comment-id="${replyTo}"]`);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              title="Jump to comment"
              className="shrink-0 rounded p-0.5 text-purple-400/60 transition-colors hover:text-purple-300"
            >
              <ArrowUp size={12} />
            </button>
            <button onClick={() => setReplyTo(null)} className="shrink-0 text-white/30 hover:text-white/60">
              <X size={10} />
            </button>
          </div>
        );
      })()}

      {/* Input area */}
      <div className="shrink-0 border-t border-white/10 px-3 py-2.5">
        <div className="flex items-end gap-2 rounded-lg bg-white/8 px-3 py-2">
          <textarea
            ref={inputRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={replyTo ? "Write a reply..." : "Add a comment..."}
            rows={1}
            className="flex-1 resize-none bg-transparent text-[12px] text-white/80 placeholder-white/25 outline-none"
            style={{ maxHeight: 80 }}
          />
          <button
            onClick={handleSubmit}
            disabled={!body.trim()}
            className={`shrink-0 rounded-full p-1.5 transition-all ${
              body.trim()
                ? "bg-purple-500 text-white hover:bg-purple-400"
                : "bg-white/10 text-white/20"
            }`}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
