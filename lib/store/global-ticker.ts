/**
 * lib/store/global-ticker.ts — Centralized rAF master clock
 *
 * Single requestAnimationFrame loop that broadcasts a DOMHighResTimeStamp to
 * all registered consumers. Replaces N independent rAF loops with one, reducing
 * GPU wake-up overhead and allowing future frame-budget coordination.
 *
 * Usage:
 *   const id = registerTickCallback((ts) => { ... });
 *   // later:
 *   unregisterTickCallback(id);
 *
 * In React components, use the `useGlobalTick` hook from lib/hooks/use-global-tick.ts.
 *
 * Design notes:
 *  - The loop only runs while at least one callback is registered (lazy start, eager stop).
 *  - Callbacks are called synchronously within the rAF — keep them cheap.
 *  - Not a Zustand store: module-level state is more appropriate for a single rAF loop.
 */

export type TickCallback = (timestamp: DOMHighResTimeStamp) => void;

let _rafId: number | null = null;
const _callbacks = new Map<number, TickCallback>();
let _nextId = 1;

function loop(ts: DOMHighResTimeStamp) {
  for (const cb of _callbacks.values()) {
    try { cb(ts); } catch (e) { console.error("[GlobalTicker] callback threw", e); }
  }
  if (_callbacks.size > 0) {
    _rafId = requestAnimationFrame(loop);
  } else {
    _rafId = null;
  }
}

function ensureRunning() {
  if (_rafId === null && _callbacks.size > 0) {
    _rafId = requestAnimationFrame(loop);
  }
}

/** Register a callback to receive every rAF tick. Returns an opaque ID for unregistering. */
export function registerTickCallback(cb: TickCallback): number {
  const id = _nextId++;
  _callbacks.set(id, cb);
  ensureRunning();
  return id;
}

/** Remove a previously registered callback. No-op if the ID is unknown. */
export function unregisterTickCallback(id: number): void {
  _callbacks.delete(id);
  // Loop will stop itself naturally on the next tick when it sees callbacks.size === 0.
}

/** Number of currently registered callbacks — useful for debugging. */
export function tickCallbackCount(): number {
  return _callbacks.size;
}
