// lib/store/flush-registry.ts
// Neutral holder for the IDB flush function.
// GlobalHydrator registers the implementation; all callers import from here.
// This breaks the GlobalHydrator ↔ project-store circular dependency.

let _flushFn: (() => Promise<void>) | null = null;

/** Called once by GlobalHydrator to register the concrete flush implementation. */
export function registerFlush(fn: () => Promise<void>): void {
  _flushFn = fn;
}

/** Deregister (called on GlobalHydrator cleanup). */
export function deregisterFlush(): void {
  _flushFn = null;
}

/**
 * Immediately persist active project + all open tabs to IDB, bypassing the debounce.
 * Returns a Promise that resolves only after all IDB writes are physically complete.
 * Safe to await before navigating or in beforeunload handlers.
 */
export async function flushProjectToIDB(): Promise<void> {
  if (_flushFn) await _flushFn();
}
