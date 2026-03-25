"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserProfile {
  username: string;
  displayName: string;
  bio: string;
  hue: number;
  followers: number;
  following: number;
}

export const DEFAULT_PROFILE: UserProfile = {
  username: "you",
  displayName: "Your Name",
  bio: "Making edits in Synapse",
  hue: 270,
  followers: 0,
  following: 0,
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
  setProfile: (patch: Partial<UserProfile>) => void;
  addXp: (amount: number) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      profile: null,
      hasHydrated: false,
      xp: 0,
      level: 0,
      rankName: "Novice",
      streak: 0,
      setProfile: (patch) =>
        set((s) => ({ profile: { ...(s.profile ?? DEFAULT_PROFILE), ...patch } })),
      addXp: (amount) =>
        set((s) => {
          const xp = s.xp + amount;
          return { xp, level: Math.floor(xp / 100), rankName: rankFromXp(xp) };
        }),
    }),
    {
      name: "synapse-user-profile",
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn("[user-store] rehydrate error:", error);
        // Migrate old flat-field format that had no nested `profile` key
        const stored = state as Record<string, unknown> | undefined;
        const migratedProfile: UserProfile =
          (stored?.profile as UserProfile | undefined) ??
          (stored?.username
            ? {
                username: stored.username as string,
                displayName: stored.displayName as string,
                bio: stored.bio as string,
                hue: stored.hue as number,
                followers: (stored.followers as number) ?? 0,
                following: (stored.following as number) ?? 0,
              }
            : DEFAULT_PROFILE);
        const s = state as (UserState & Record<string, unknown>) | undefined;
        useUserStore.setState({
          hasHydrated: true,
          profile: migratedProfile,
          xp:       (s?.xp       as number) ?? 0,
          level:    (s?.level    as number) ?? 0,
          rankName: (s?.rankName as string) ?? "Novice",
          streak:   (s?.streak   as number) ?? 0,
        });
      },
    }
  )
);
