"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface UserProfile {
  username: string;
  displayName: string;
  bio: string;
  hue: number;       // HSL hue for avatar background colour
  followers: number;
  following: number;
}

interface UserState extends UserProfile {
  setProfile: (patch: Partial<UserProfile>) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      username: "you",
      displayName: "Your Name",
      bio: "Making edits in Synapse",
      hue: 270,
      followers: 0,
      following: 0,
      setProfile: (patch) => set((s) => ({ ...s, ...patch })),
    }),
    { name: "synapse-user-profile" }
  )
);
