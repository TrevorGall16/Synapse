// ── Custom Preset Library IndexedDB Layer ──────────────────────────────────────
// Store: "synapse-custom-presets" / "presets"
// Each record is a CustomPreset saved by the user via "Save to Library".

import { get, del, keys, createStore } from "idb-keyval";
import { idbSafeSet } from "./idb-safe-write";

export interface CustomPreset {
  id: string;
  label: string;
  category: "blur" | "distortion" | "color" | "glitch" | "other";
  effectType: string;
  fxParams: Record<string, unknown>;
  savedAt: number;
  authorHandle?: string;
}

const presetsDb = createStore("synapse-custom-presets", "presets");

export async function saveCustomPreset(preset: CustomPreset): Promise<void> {
  const ok = await idbSafeSet(preset.id, preset, presetsDb);
  if (!ok) {
    console.error("[CustomPresetsIDB] saveCustomPreset failed for", preset.id, `"${preset.label}"`);
  }
}

export async function loadAllCustomPresets(): Promise<CustomPreset[]> {
  const allKeys = await keys<string>(presetsDb);
  const records = await Promise.all(
    allKeys
      .filter((k): k is string => typeof k === "string")
      .map((k) => get<CustomPreset>(k, presetsDb)),
  );
  return records
    .filter((p): p is CustomPreset => !!p)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function removeCustomPreset(id: string): Promise<void> {
  await del(id, presetsDb);
}
