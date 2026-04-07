"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { coerceUserProfile } from "@/lib/schema";

export interface SocialLinks {
  instagram?: string;
  x?: string;
  youtube?: string;
  website?: string;
}

export interface UserProfile {
  username: string;
  displayName: string;
  bio: string;
  hue: number;
  followers: number;
  following: number;
  socialLinks: SocialLinks;
}

export const DEFAULT_PROFILE: UserProfile = {
  username: "you",
  displayName: "Your Name",
  bio: "Making edits in Synapse",
  hue: 270,
  followers: 0,
  following: 0,
  socialLinks: {},
};

// ── XP / Rank thresholds ───────────────────────────────────────────────────────
const RANK_THRESHOLDS: Array<{ min: number; name: string }> = [
  { min: 5000, name: "Legend"    },
  { min: 2000, name: "Architect" },
  { min: 500,  name: "Creator"   },
  { min: 0,    name: "Novice"    },
];

export function rankFromXp(xp: number): string {
  return RANK_THRESHOLDS.find((r) => xp >= r.min)?.name ?? "Novice";
}

/** XP awards for key user actions */
export const XP_AWARDS = { publish: 100, remix: 50, savePreset: 20 } as const;

interface UserState {
  /** null until localStorage has been read — gate UI renders on this */
  profile: UserProfile | null;
  hasHydrated: boolean;
  /** Total lifetime XP */
  xp: number;
  /** Floor(xp / 100) */
  level: number;
  /** Human rank name derived from xp thresholds */
  rankName: string;
  /** Days in a row the user has published/remixed — placeholder for future streak logic */
  streak: number;
  /** Stable UUID for comment authorship — persisted across reloads */
  commentUserId: string;
  /** Identity graph — creator handles the viewer currently follows. Persisted
   *  here (in zustand + localStorage) so reads are sync; social-idb is written
   *  asynchronously as a backup/secondary store. */
  following: string[];
  /** Optimistic deltas applied on top of each creator's base follower count.
   *  Indexed by creator handle. Lets us bump "8,420 followers" → "8,421"
   *  instantly on click without waiting for (or needing) a server round-trip. */
  followerDeltas: Record<string, number>;
  setProfile: (patch: Partial<UserProfile>) => void;
  addXp: (amount: number) => void;
  /** Optimistic follow: updates `following`, bumps target creator's delta by
   *  +1, and increments the viewer's own `profile.following` count. Idempotent. */
  followCreator: (handle: string) => void;
  /** Optimistic unfollow: inverse of followCreator. Idempotent. */
  unfollowCreator: (handle: string) => void;
  /** Selector-friendly: true if the viewer follows this handle (sync). */
  isFollowing: (handle: string) => boolean;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      profile: null,
      hasHydrated: false,
      xp: 0,
      level: 0,
      rankName: "Novice",
      streak: 0,
      commentUserId: crypto.randomUUID(),
      following: [],
      followerDeltas: {},
      setProfile: (patch) =>
        set((s) => ({ profile: { ...(s.profile ?? DEFAULT_PROFILE), ...patch } })),
      addXp: (amount) =>
        set((s) => {
          const xp = s.xp + amount;
          return { xp, level: Math.floor(xp / 100), rankName: rankFromXp(xp) };
        }),
      followCreator: (handle) =>
        set((s) => {
          if (s.following.includes(handle)) return s; // idempotent
          const profile = s.profile ?? DEFAULT_PROFILE;
          return {
            following: [...s.following, handle],
            followerDeltas: { ...s.followerDeltas, [handle]: (s.followerDeltas[handle] ?? 0) + 1 },
            profile: { ...profile, following: profile.following + 1 },
          };
        }),
      unfollowCreator: (handle) =>
        set((s) => {
          if (!s.following.includes(handle)) return s;
          const profile = s.profile ?? DEFAULT_PROFILE;
          const nextDeltas = { ...s.followerDeltas, [handle]: (s.followerDeltas[handle] ?? 0) - 1 };
          return {
            following: s.following.filter((h) => h !== handle),
            followerDeltas: nextDeltas,
            profile: { ...profile, following: Math.max(0, profile.following - 1) },
          };
        }),
      isFollowing: (handle) => get().following.includes(handle),
    }),
    {
      name: "synapse-user-profile",
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn("[user-store] rehydrate error:", error);
        // Migrate old flat-field format that had no nested `profile` key
        const stored = state as Record<string, unknown> | undefined;
        // Build raw candidate: prefer nested `profile` object, fall back to old flat format.
        const rawProfile: unknown =
          stored?.profile ??
          (stored?.username
            ? {
                username: stored.username,
                displayName: stored.displayName,
                bio: stored.bio,
                hue: stored.hue,
                followers: stored.followers ?? 0,
                following: stored.following ?? 0,
              }
            : null);
        // coerceUserProfile never throws and never resets to default silently —
        // it truncates over-limit fields so the user's actual data is preserved.
        const migratedProfile = coerceUserProfile(rawProfile);
        const s = state as (UserState & Record<string, unknown>) | undefined;
        // queueMicrotask defers until after create() returns and useUserStore is
        // fully assigned — prevents TDZ ReferenceError when localStorage
        // rehydration fires synchronously during store initialization.
        queueMicrotask(() => {
          useUserStore.setState({
            hasHydrated: true,
            profile: migratedProfile,
            xp:       (s?.xp       as number) ?? 0,
            level:    (s?.level    as number) ?? 0,
            rankName: (s?.rankName as string) ?? "Novice",
            streak:   (s?.streak   as number) ?? 0,
            commentUserId: (s?.commentUserId as string) || crypto.randomUUID(),
            following: Array.isArray(s?.following) ? (s.following as string[]) : [],
            followerDeltas: (s?.followerDeltas && typeof s.followerDeltas === "object")
              ? (s.followerDeltas as Record<string, number>)
              : {},
          });
        });
      },
    }
  )
);
