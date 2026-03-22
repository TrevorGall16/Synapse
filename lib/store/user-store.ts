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

interface UserState {
  /** null until localStorage has been read — gate UI renders on this */
  profile: UserProfile | null;
  hasHydrated: boolean;
  setProfile: (patch: Partial<UserProfile>) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      profile: null,
      hasHydrated: false,
      setProfile: (patch) =>
        set((s) => ({ profile: { ...(s.profile ?? DEFAULT_PROFILE), ...patch } })),
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
        useUserStore.setState({ hasHydrated: true, profile: migratedProfile });
      },
    }
  )
);
