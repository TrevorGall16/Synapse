// lib/schema.test.ts
import { describe, it, expect } from "vitest";
// These imports will fail until the schema exports are added — that is the point of TDD.
import {
  UserProfileSchema,
  validateUserProfile,
  coerceUserProfile,
  DISPLAY_NAME_MAX,
  BIO_MAX,
} from "./schema";

describe("UserProfileSchema", () => {
  it("accepts a valid profile", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "Trevor",
      bio: "Making edits",
      hue: 270,
      followers: 100,
      following: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a displayName longer than DISPLAY_NAME_MAX", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "A".repeat(DISPLAY_NAME_MAX + 1),
      bio: "hi",
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bio longer than BIO_MAX", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "Trevor",
      bio: "B".repeat(BIO_MAX + 1),
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects hue outside 0-359", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "Trevor",
      bio: "hi",
      hue: 400,
      followers: 0,
      following: 0,
    });
    expect(result.success).toBe(false);
  });

  it("strips unknown extra fields", () => {
    const result = UserProfileSchema.safeParse({
      username: "trev",
      displayName: "Trevor",
      bio: "hi",
      hue: 270,
      followers: 0,
      following: 0,
      unknownField: "should be stripped",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBeUndefined();
    }
  });
});

describe("validateUserProfile", () => {
  it("returns null for invalid data", () => {
    expect(validateUserProfile(null)).toBeNull();
    expect(validateUserProfile({ displayName: 123 })).toBeNull();
  });

  it("returns ValidatedUserProfile for valid data", () => {
    const result = validateUserProfile({
      username: "trev",
      displayName: "Trevor",
      bio: "Making edits",
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result).not.toBeNull();
    expect(result?.displayName).toBe("Trevor");
  });
});

describe("coerceUserProfile", () => {
  it("returns DEFAULT_PROFILE when input is null/undefined", () => {
    const result = coerceUserProfile(null);
    expect(result.username).toBe("you");
  });

  it("truncates displayName exceeding DISPLAY_NAME_MAX", () => {
    const longName = "A".repeat(DISPLAY_NAME_MAX + 10);
    const result = coerceUserProfile({
      username: "trev",
      displayName: longName,
      bio: "hi",
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result.displayName.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    expect(result.displayName).toBe("A".repeat(DISPLAY_NAME_MAX));
  });

  it("truncates bio exceeding BIO_MAX", () => {
    const longBio = "B".repeat(BIO_MAX + 20);
    const result = coerceUserProfile({
      username: "trev",
      displayName: "Trevor",
      bio: longBio,
      hue: 270,
      followers: 0,
      following: 0,
    });
    expect(result.bio.length).toBeLessThanOrEqual(BIO_MAX);
    expect(result.bio).toBe("B".repeat(BIO_MAX));
  });

  it("clamps hue to 0-359 range", () => {
    const result = coerceUserProfile({
      username: "trev",
      displayName: "Trevor",
      bio: "hi",
      hue: 400,
      followers: 0,
      following: 0,
    });
    expect(result.hue).toBe(359);
  });

  it("clamps negative hue to 0", () => {
    const result = coerceUserProfile({
      username: "trev",
      displayName: "Trevor",
      bio: "hi",
      hue: -10,
      followers: 0,
      following: 0,
    });
    expect(result.hue).toBe(0);
  });

  it("preserves valid data unchanged", () => {
    const result = coerceUserProfile({
      username: "trev",
      displayName: "Trevor",
      bio: "Short bio",
      hue: 270,
      followers: 10,
      following: 5,
    });
    expect(result.displayName).toBe("Trevor");
    expect(result.bio).toBe("Short bio");
    expect(result.hue).toBe(270);
  });
});
