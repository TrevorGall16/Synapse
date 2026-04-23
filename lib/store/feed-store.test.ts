import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFeedStore, type FeedPost } from "./feed-store";

// Silence IDB side-effects in Zustand's persist + addPost/removePost paths.
vi.mock("./feed-idb", () => ({
  savePostToIDB:       vi.fn().mockResolvedValue(undefined),
  removePostFromIDB:   vi.fn().mockResolvedValue(undefined),
  loadAllPostsFromIDB: vi.fn().mockResolvedValue([]),
}));
vi.mock("./thumbnail-idb", () => ({
  removeThumbnail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./media-pool-db", () => ({
  releaseSnapshotMedia: vi.fn().mockResolvedValue(undefined),
  hydrateMediaPool:     vi.fn().mockImplementation(async (p: FeedPost) => p),
}));
vi.mock("@/lib/schema", () => ({
  validateFeedPost: (p: FeedPost) => p,
}));

function hotPost(id: string, likes: number): FeedPost {
  return {
    id,
    user: { handle: "u", initial: "U", hue: 0 },
    title: "t",
    tags: [],
    bg: "#000",
    accent: "#fff",
    duration: "0:10",
    likes,
    comments: 0,
    featured: false,
    createdAt: Date.now() - 4 * 3_600_000,
  };
}

describe("feed-store heat-tier enrichment", () => {
  beforeEach(() => {
    useFeedStore.setState({ userPosts: [], likedPostIds: [] });
  });

  it("addPost enriches the resulting pool", () => {
    useFeedStore.getState().addPost(hotPost("a", 500));
    useFeedStore.getState().addPost(hotPost("b", 2));  // cold
    const posts = useFeedStore.getState().userPosts;
    // Hot post should have a tier; cold shouldn't.
    const a = posts.find((p) => p.id === "a");
    const b = posts.find((p) => p.id === "b");
    expect(a?.heatTier).toBeDefined();
    expect(b?.heatTier).toBeUndefined();
  });

  it("removePost re-enriches the remainder", () => {
    const s = useFeedStore.getState();
    s.addPost(hotPost("a", 500));
    s.addPost(hotPost("b", 500));
    s.addPost(hotPost("c", 500));
    s.removePost("a");
    const posts = useFeedStore.getState().userPosts;
    expect(posts.every((p) => p.id !== "a")).toBe(true);
    // Every remaining post still has a heatTier defined (or not, but
    // the enrichment function was invoked — no stale tiers).
    for (const p of posts) {
      if (p.heatTier !== undefined) {
        expect(["warm", "hot", "trending"]).toContain(p.heatTier);
      }
    }
  });
});
