// lib/policy.test.ts — canRemix + getRemixMode gate verification
import { describe, it, expect } from "vitest";
import { canRemix, getRemixMode } from "./policy";
import type { FeedPost } from "./store/feed-store";

// Minimal FeedPost factory — only fields relevant to policy gates
function makePost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: "post-1",
    userId: "user-1",
    videoUrl: "./test.mp4",
    caption: "test",
    likes: 0,
    comments: 0,
    username: "testuser",
    userHue: 270,
    allowRemix: undefined,
    projectSnapshot: undefined,
    ...overrides,
  } as FeedPost;
}

describe("canRemix", () => {
  it("defaults to true when allowRemix is absent (backward-compatible)", () => {
    const post = makePost({ allowRemix: undefined });
    expect(canRemix(post)).toBe(true);
  });

  it("returns true when allowRemix is explicitly true", () => {
    const post = makePost({ allowRemix: true });
    expect(canRemix(post)).toBe(true);
  });

  it("returns false when allowRemix is explicitly false", () => {
    const post = makePost({ allowRemix: false });
    expect(canRemix(post)).toBe(false);
  });
});

describe("getRemixMode", () => {
  it("returns 'snapshot' when projectSnapshot is present", () => {
    const post = makePost({
      projectSnapshot: { projectId: "p1", name: "Test", tracks: [], duration: 0, projectSettings: { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1, gammaTag: "sRGB" } } as never,
    });
    expect(getRemixMode(post)).toBe("snapshot");
  });

  it("returns 'legacy' when projectSnapshot is absent", () => {
    const post = makePost({ projectSnapshot: undefined });
    expect(getRemixMode(post)).toBe("legacy");
  });

  it("returns 'legacy' when projectSnapshot is null", () => {
    const post = makePost({ projectSnapshot: null as never });
    expect(getRemixMode(post)).toBe("legacy");
  });
});
