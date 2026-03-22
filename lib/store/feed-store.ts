"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track, ProjectSettings, MediaPoolItem } from "./types";

export interface FeedPost {
  id: string;
  user: { handle: string; initial: string; hue: number };
  title: string;
  description?: string;
  tags: string[];
  bg: string;
  accent: string;
  duration: string;
  likes: number;
  comments: number;
  featured: boolean;
  videoUrl?: string;
  /** Full project snapshot — present when published from Studio */
  projectSnapshot?: { tracks: Track[]; duration: number; projectSettings: ProjectSettings; mediaPool?: MediaPoolItem[] };
  /** Handle of the publishing user — used to filter posts on Profile page */
  authorUsername?: string;
  /** Whether others are allowed to Remix this post (set in PublishModal) */
  allowRemix?: boolean;
  /** ID of the FeedPost this was remixed from */
  remixedFromPostId?: string;
  /** Handle of the original creator this was remixed from */
  remixedFromHandle?: string;
  /** Unix ms timestamp of publication — used for sorting on Profile page */
  createdAt?: number;
}

interface FeedState {
  userPosts: FeedPost[];
  addPost:    (post: FeedPost) => void;
  removePost: (id: string) => void;
}

/** True if the URL is a Blob (local-session only, breaks on refresh) */
export function isBlobUrl(url?: string): boolean { return !!url?.startsWith("blob:"); }

export const useFeedStore = create<FeedState>()(
  persist(
    (set) => ({
      userPosts: [],
      addPost:    (post) => set((s) => ({ userPosts: [post, ...s.userPosts] })),
      removePost: (id)   => set((s) => ({ userPosts: s.userPosts.filter((p) => p.id !== id) })),
    }),
    { name: "synapse-feed-posts" }
  )
);
