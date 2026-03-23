// ── IDB Safe Write ─────────────────────────────────────────
// Wraps idb-keyval set() with QuotaExceededError handling.
// Call registerIdbToast() once in the root layout to wire in the UI toast.

import { set as idbSet } from "idb-keyval";
import type { UseStore } from "idb-keyval";

type ToastFn = (msg: string) => void;
let _toast: ToastFn | null = null;

export function registerIdbToast(fn: ToastFn): void {
  _toast = fn;
}

export async function idbSafeSet(
  key: IDBValidKey,
  value: unknown,
  store?: UseStore,
): Promise<boolean> {
  try {
    await idbSet(key, value, store);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      _toast?.("Storage full — clear old media to free space.");
      console.error("[IDB QuotaExceeded]", key);
    } else {
      _toast?.("Failed to save — storage error.");
      console.error("[IDB Write Error]", key, err);
    }
    return false;
  }
}
