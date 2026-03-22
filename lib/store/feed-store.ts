"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Shared post type — used by the feed page, theater mode, and upload modal
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
}

interface FeedState {
  userPosts: FeedPost[];
  addPost:    (post: FeedPost) => void;
  removePost: (id: string) => void;
}

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
