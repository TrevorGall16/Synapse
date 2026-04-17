import { describe, it, expect } from "vitest";
import type { FeedPost } from "@/lib/store/feed-store";
import { buildAutocompleteSuggestions } from "@/lib/search-autocomplete";

// Minimal FeedPost factory — only fields the helper reads.
function mk(handle: string, id = handle): FeedPost {
  return {
    id,
    user: { handle, initial: handle[0]?.toUpperCase() ?? "X", hue: 0 },
    title: `post by ${handle}`,
    tags: [],
    bg: "#000",
    accent: "#fff",
    duration: "0:10",
    likes: 0,
    comments: 0,
    featured: false,
  } as FeedPost;
}

const posts: FeedPost[] = [
  mk("aurora_vj"),
  mk("aurora_vj", "dup"), // duplicate handle to exercise dedup
  mk("neon_cut"),
  mk("spectral_x"),
  mk("hue.shift"),
];

describe("buildAutocompleteSuggestions", () => {
  it("returns empty arrays for an empty query", () => {
    expect(buildAutocompleteSuggestions(posts, "")).toEqual({ channels: [], creators: [] });
    expect(buildAutocompleteSuggestions(posts, "   ")).toEqual({ channels: [], creators: [] });
  });

  it("matches channels case-insensitively", () => {
    const { channels } = buildAutocompleteSuggestions(posts, "blo");
    expect(channels).toContain("Blonde");
  });

  it("strips a leading # before matching channels", () => {
    const { channels } = buildAutocompleteSuggestions(posts, "#anal");
    expect(channels[0]).toBe("Anal"); // exact match wins
  });

  it("strips a leading @ before matching creators", () => {
    const { creators } = buildAutocompleteSuggestions(posts, "@aurora");
    expect(creators[0]).toBe("aurora_vj");
  });

  it("ranks exact > prefix > substring for channels", () => {
    // 'as' is a substring of 'Asian' (prefix) and 'PAWG' is unrelated.
    // 'Asian' starts with 'as', no channel equals 'as' exactly.
    const { channels } = buildAutocompleteSuggestions(posts, "as");
    expect(channels[0]).toBe("Asian"); // prefix beats any substring
  });

  it("ranks exact > prefix > substring for creators", () => {
    const extra: FeedPost[] = [
      ...posts,
      mk("au"),            // exact match for query 'au'
      mk("auburn"),        // prefix match for 'au'
      mk("blauburn"),      // substring match for 'au'
    ];
    const { creators } = buildAutocompleteSuggestions(extra, "au");
    expect(creators[0]).toBe("au");
    expect(creators.indexOf("auburn")).toBeLessThan(creators.indexOf("blauburn"));
  });

  it("dedupes duplicate creator handles", () => {
    const { creators } = buildAutocompleteSuggestions(posts, "aurora");
    expect(creators.filter((c) => c === "aurora_vj")).toHaveLength(1);
  });

  it("caps each section at 8 items", () => {
    const many: FeedPost[] = Array.from({ length: 30 }, (_, i) => mk(`creator_${i}`));
    const { creators } = buildAutocompleteSuggestions(many, "creator");
    expect(creators.length).toBeLessThanOrEqual(8);
  });

  it("returns no channels/creators when nothing matches", () => {
    const { channels, creators } = buildAutocompleteSuggestions(posts, "zxqvw_nope");
    expect(channels).toEqual([]);
    expect(creators).toEqual([]);
  });
});
