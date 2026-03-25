import { get, set, del, createStore } from "idb-keyval";

const socialDb = createStore("synapse-social-db", "following");

/** Follow a creator handle. No-op if already following. */
export async function followCreator(handle: string): Promise<void> {
  await set(handle, true, socialDb);
}

/** Unfollow a creator handle. */
export async function unfollowCreator(handle: string): Promise<void> {
  await del(handle, socialDb);
}

/** Returns true if the current user follows this handle. */
export async function isFollowing(handle: string): Promise<boolean> {
  const v = await get<boolean>(handle, socialDb);
  return !!v;
}

/** Load all followed handles (for initializing UI state on mount). */
export async function loadFollowedHandles(): Promise<string[]> {
  const { keys } = await import("idb-keyval");
  const all = await keys(socialDb);
  return all as string[];
}
