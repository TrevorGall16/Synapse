// ── Project State IndexedDB Layer ──────────────────────────
// Stores the heavy project state (tracks, history) in IDB to
// avoid the 5MB localStorage limit from Zustand persist.
//
// Two custom stores:
//   "synapse-projects-db"  → full project records (tracks, markers, etc.)
//   "synapse-history-db"   → undo/redo snapshots per projectId

import { get, del, keys, createStore } from "idb-keyval";
import { idbSafeSet } from "./idb-safe-write";
import type { Track, Marker, HistorySnapshot, ProjectSettings } from "./types";

const projectsDb = createStore("synapse-projects-db", "projects");
const historyDb  = createStore("synapse-history-db",  "history");

export interface IDBProjectRecord {
  projectId: string;
  name: string;
  tracks: Track[];
  duration: number;
  markers: Marker[];
  projectSettings: ProjectSettings;
  parentProjectId?: string;
  remixedFromHandle?: string;
  rootParentId?: string;
  rootParentHandle?: string;
  updatedAt: number;
}

export async function saveProjectToIDB(record: IDBProjectRecord): Promise<void> {
  await idbSafeSet(record.projectId, record, projectsDb);
}

export async function loadProjectFromIDB(projectId: string): Promise<IDBProjectRecord | null> {
  return (await get<IDBProjectRecord>(projectId, projectsDb)) ?? null;
}

export async function deleteProjectFromIDB(projectId: string): Promise<void> {
  await del(projectId, projectsDb);
}

export async function getAllProjectIds(): Promise<string[]> {
  const k = await keys<string>(projectsDb);
  return k.filter((v): v is string => typeof v === "string");
}

export async function saveHistoryToIDB(
  projectId: string,
  past: HistorySnapshot[],
  future: HistorySnapshot[],
): Promise<void> {
  await idbSafeSet(projectId, { past, future }, historyDb);
}

export async function loadHistoryFromIDB(
  projectId: string,
): Promise<{ past: HistorySnapshot[]; future: HistorySnapshot[] } | null> {
  return (await get<{ past: HistorySnapshot[]; future: HistorySnapshot[] }>(projectId, historyDb)) ?? null;
}

export async function deleteHistoryFromIDB(projectId: string): Promise<void> {
  await del(projectId, historyDb);
}
