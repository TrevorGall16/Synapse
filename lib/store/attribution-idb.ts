// ── Attribution Lock IDB Layer ──────────────────────────────
// Writes remix attribution at fork time so the publish flow can
// read the locked values instead of trusting the mutable Zustand store.
// Key: projectId (the new remix project's ID)

import { get, del, createStore } from "idb-keyval";
import { idbSafeSet } from "./idb-safe-write";

const attributionDb = createStore("synapse-attribution-db", "attribution");

export interface LockedAttribution {
  parentProjectId?: string;
  remixedFromHandle?: string;
  rootParentId?: string;
  rootParentHandle?: string;
  lockedAt: number;
}

export async function saveAttributionLock(
  projectId: string,
  attr: LockedAttribution,
): Promise<void> {
  await idbSafeSet(projectId, attr, attributionDb);
}

export async function getAttributionLock(
  projectId: string,
): Promise<LockedAttribution | null> {
  return (await get<LockedAttribution>(projectId, attributionDb)) ?? null;
}

export async function deleteAttributionLock(projectId: string): Promise<void> {
  await del(projectId, attributionDb);
}
