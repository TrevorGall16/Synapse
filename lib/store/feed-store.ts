"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track, ProjectSettings, MediaPoolItem } from "./types";
import { cleanupSnapshotMedia, hydrateMediaPool } from "./media-pool-db";
import { savePostToIDB, removePostFromIDB, loadAllPostsFromIDB } from "./feed-idb";

export type FeedPostType = "video" | "preset";

export interface PresetData {
  effectType: string;
  fxParams: Record<string, unknown>;
  /** Human-readable label shown on the preset card */
  label?: string;
  /** Broad category for filtering in the Explore/Presets panels */
  category?: "blur" | "distortion" | "color" | "glitch" | "other";
  /** Pre-computed CSS so cards can render a live preview without running fxParams helpers */
  previewCss?: { filter: string; transform: string; animation?: string };
}

export interface FeedPost {
  id: string;
  /** Discriminator — defaults to "video" when absent (backward-compatible) */
  type?: FeedPostType;
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
  /** Present on type="preset" posts — the draggable FX recipe */
  presetData?: PresetData;
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
  /** For preset demo videos: the second offset to start looping from (default 0) */
  demoStartTime?: number;
  /** Duration of the demo loop window in seconds — if set, video loops demoStartTime…demoStartTime+demoDuration */
  demoDuration?: number;
  /** Content category — used for feed filtering */
  category?: "high-sensation" | "aesthetic" | "cinematic" | "glitch" | "slow-mo";
}

interface FeedState {
  userPosts: FeedPost[];
  /** Set of post IDs the current user has liked — persisted to localStorage */
  likedPostIds: string[];
  addPost:    (post: FeedPost) => void;
  removePost: (id: string) => void;
  toggleLike: (postId: string) => void;
  hydrateAllPosts: () => Promise<void>;
}

/** True if the URL is a Blob (local-session only, breaks on refresh) */
export function isBlobUrl(url?: string): boolean { return !!url?.startsWith("blob:"); }

export const useFeedStore = create<FeedState>()(
  persist(
    (set, get) => ({
      userPosts: [],
      likedPostIds: [],

      addPost: (post) => {
        set((s) => ({ userPosts: [post, ...s.userPosts] }));
        // Persist to IDB asynchronously — blob URLs stripped in savePostToIDB
        savePostToIDB(post).catch((err) => console.error("[FeedStore] addPost IDB save threw unexpectedly:", err));
      },

      toggleLike: (postId) => set((s) => ({
        likedPostIds: s.likedPostIds.includes(postId)
          ? s.likedPostIds.filter((id) => id !== postId)
          : [...s.likedPostIds, postId],
      })),

      removePost: (id) => {
        const post = get().userPosts.find((p) => p.id === id);
        if (post?.projectSnapshot?.mediaPool?.length) {
          cleanupSnapshotMedia(post.projectSnapshot.mediaPool).catch(console.warn);
        }
        set((s) => ({ userPosts: s.userPosts.filter((p) => p.id !== id) }));
        removePostFromIDB(id).catch(console.warn);
      },

      /**
       * Boot hydration: load all posts from IDB (source of truth), then
       * recover blob URLs for any mediaPool items still in media-pool-db.
       * Called by GlobalHydrator after persist rehydration completes.
       */
      hydrateAllPosts: async () => {
        const idbPosts = await loadAllPostsFromIDB();
        if (!idbPosts.length) return;

        // Hydrate each post independently — one failure must not drop the others.
        const hydrated = await Promise.all(
          idbPosts.map(async (post): Promise<FeedPost> => {
            try {
              if (!post.projectSnapshot?.mediaPool?.length) return post;
              const pool = await hydrateMediaPool(post.projectSnapshot.mediaPool);
              // Restore videoUrl from first hydrated video (was stripped on IDB save).
              const firstVideo = pool.find((m) => m.type === "video");
              return {
                ...post,
                videoUrl: post.videoUrl ?? firstVideo?.previewUrl,
                projectSnapshot: { ...post.projectSnapshot, mediaPool: pool },
              };
            } catch (err) {
              console.error("[FeedStore] hydrateAllPosts: failed to hydrate post", post.id, err);
              return post; // return the post without blob URLs rather than dropping it
            }
          }),
        );

        // Merge: keep any in-memory posts not yet persisted to IDB (e.g. addPost
        // called during the same tick as hydration) so they are never silently dropped.
        const idbIds = new Set(hydrated.map((p) => p.id));
        const unpersistedInMemory = get().userPosts.filter((p) => !idbIds.has(p.id));
        set({ userPosts: [...unpersistedInMemory, ...hydrated] });
      },
    }),
    {
      name: "synapse-feed-posts",
      // userPosts excluded from localStorage — all post data lives in IDB via feed-idb.ts.
      // likedPostIds is lightweight (array of UUIDs) and safe to keep in localStorage.
      partialize: (s) => ({ likedPostIds: s.likedPostIds }),
    },
  ),
);
