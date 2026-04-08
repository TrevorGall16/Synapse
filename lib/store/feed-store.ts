"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track, ProjectSettings, MediaPoolItem } from "./types";
import { releaseSnapshotMedia, hydrateMediaPool } from "./media-pool-db";
import { savePostToIDB, removePostFromIDB, loadAllPostsFromIDB } from "./feed-idb";
import { validateFeedPost } from "@/lib/schema";

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
  /** Playback start offset in MICROSECONDS (1s = 1_000_000) */
  demoStartTime?: number;
  /** Duration of the demo loop window in MICROSECONDS — Theater Mode loops demoStartTime…demoStartTime+demoDuration */
  demoDuration?: number;
  /** Visual style niche — used for the niche/* pages and explore grouping. */
  category?: "high-sensation" | "aesthetic" | "cinematic" | "glitch" | "slow-mo";
  /** Content channel — single-select bucket from lib/config/taxonomy.CHANNELS.
   *  Orthogonal to `category` (visual style) and `tags` (free-form keywords). */
  channel?: string;
  /** Creator toggle — when false, comments are disabled on this post */
  comments_enabled?: boolean;
}

interface FeedState {
  userPosts: FeedPost[];
  /** Set of post IDs the current user has liked — persisted to localStorage */
  likedPostIds: string[];
  addPost:    (post: FeedPost) => void;
  removePost: (id: string) => void;
  /** Batch remove — awaits all IDB deletes before updating Zustand state.
   *  Throws if any IDB delete fails; state is left unchanged on error. */
  removePosts: (ids: string[]) => Promise<void>;
  toggleLike: (postId: string) => void;
  hydrateAllPosts: () => Promise<void>;
}

/** True if the URL is a Blob (local-session only, breaks on refresh) */
export function isBlobUrl(url?: string): boolean { return !!url?.startsWith("blob:"); }

/**
 * Stable HQ placeholder video used when local blob URLs are irrecoverable.
 * Keeps the post testable in the feed instead of showing "Media Offline."
 */
export const FALLBACK_VIDEO_URL = "https://videos.pexels.com/video-files/3129671/3129671-uhd_2560_1440_30fps.mp4";

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
          releaseSnapshotMedia(post.projectSnapshot.mediaPool).catch(console.warn);
        }
        set((s) => ({ userPosts: s.userPosts.filter((p) => p.id !== id) }));
        removePostFromIDB(id).catch(console.warn);
      },

      removePosts: async (ids) => {
        if (ids.length === 0) return;
        const posts = get().userPosts.filter((p) => ids.includes(p.id));
        // Release OPFS blobs — non-durable cleanup, failures are swallowed.
        await Promise.all(
          posts
            .filter((p) => p.projectSnapshot?.mediaPool?.length)
            .map((p) => releaseSnapshotMedia(p.projectSnapshot!.mediaPool!).catch(console.warn))
        );
        // Durability: NO per-item .catch() — any IDB failure throws, state stays unchanged.
        await Promise.all(ids.map((id) => removePostFromIDB(id)));
        // State updates only after all IDB deletes have landed.
        const idSet = new Set(ids);
        set((s) => ({ userPosts: s.userPosts.filter((p) => !idSet.has(p.id)) }));
      },

      /**
       * Boot hydration: load all posts from IDB (source of truth), then
       * recover blob URLs for any mediaPool items still in media-pool-db.
       * Called by GlobalHydrator after persist rehydration completes.
       */
      hydrateAllPosts: async () => {
        const idbPosts = await loadAllPostsFromIDB();
        if (!idbPosts.length) return;

        // Validate + hydrate each post independently — one failure must not drop the others.
        const hydrated = await Promise.all(
          idbPosts.map(async (raw): Promise<FeedPost | null> => {
            // Bouncer: reject structurally invalid posts before they reach the store.
            const post = validateFeedPost(raw, `post ${(raw as { id?: string })?.id ?? "?"}`);
            if (!post) return null;
            try {
              if (!post.projectSnapshot?.mediaPool?.length) {
                // Layer 2: no media pool to recover — use fallback if videoUrl is missing/blob
                return {
                  ...post,
                  videoUrl: post.videoUrl && !isBlobUrl(post.videoUrl) ? post.videoUrl : FALLBACK_VIDEO_URL,
                } as FeedPost;
              }
              // Layer 1: attempt to restore blob URLs from media-pool-db
              const pool = await hydrateMediaPool(post.projectSnapshot.mediaPool);
              const firstVideo = pool.find((m) => m.type === "video");
              const restoredUrl = post.videoUrl ?? firstVideo?.previewUrl;
              return {
                ...post,
                // Layer 2: if blob recovery yielded nothing, fall back to placeholder
                videoUrl: restoredUrl && !isBlobUrl(restoredUrl) ? restoredUrl : (firstVideo?.previewUrl ?? FALLBACK_VIDEO_URL),
                projectSnapshot: { ...post.projectSnapshot, mediaPool: pool },
              } as FeedPost;
            } catch (err) {
              console.error("[FeedStore] hydrateAllPosts: failed to hydrate post", post.id, err);
              // Layer 2 fallback: post stays in feed with placeholder video
              return { ...post, videoUrl: FALLBACK_VIDEO_URL } as FeedPost;
            }
          }),
        ).then((results) => results.filter((p): p is FeedPost => p !== null));

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
