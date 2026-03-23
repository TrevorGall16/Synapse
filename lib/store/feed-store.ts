"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track, ProjectSettings, MediaPoolItem } from "./types";
import { cleanupSnapshotMedia, hydrateMediaPool } from "./media-pool-db";

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
  /** The root (first) post in the remix chain — set if this is a remix-of-a-remix */
  rootParentId?: string;
  rootParentHandle?: string;
  /** Unix ms timestamp of publication — used for sorting on Profile page */
  createdAt?: number;
}

interface FeedState {
  userPosts: FeedPost[];
  addPost:    (post: FeedPost) => void;
  removePost: (id: string) => void;
  hydrateAllPosts: () => Promise<void>;
}

/** True if the URL is a Blob (local-session only, breaks on refresh) */
export function isBlobUrl(url?: string): boolean { return !!url?.startsWith("blob:"); }

export const useFeedStore = create<FeedState>()(
  persist(
    (set, get) => ({
      userPosts: [],
      addPost:    (post) => set((s) => ({ userPosts: [post, ...s.userPosts] })),
      removePost: (id) => {
        const post = get().userPosts.find((p) => p.id === id);
        if (post?.projectSnapshot?.mediaPool?.length) {
          cleanupSnapshotMedia(post.projectSnapshot.mediaPool).catch(console.warn);
        }
        set((s) => ({ userPosts: s.userPosts.filter((p) => p.id !== id) }));
      },
      hydrateAllPosts: async () => {
        const posts = get().userPosts;
        if (!posts.length) return;
        const updated = await Promise.all(
          posts.map(async (post) => {
            if (!post.projectSnapshot?.mediaPool?.length) return post;
            const pool = await hydrateMediaPool(post.projectSnapshot.mediaPool);
            return { ...post, projectSnapshot: { ...post.projectSnapshot, mediaPool: pool } };
          })
        );
        set({ userPosts: updated });
        console.log(`IDB Recovery [feed]: ${posts.length} post(s) scanned`);
      },
    }),
    { name: "synapse-feed-posts" }
  )
);
