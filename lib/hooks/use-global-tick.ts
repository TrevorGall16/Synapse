"use client";

/**
 * lib/hooks/use-global-tick.ts — React hook for GlobalTicker
 *
 * Subscribes a callback to the shared rAF master clock for the lifetime of the
 * component. Automatically unregisters on unmount.
 *
 * The callback is called with a DOMHighResTimeStamp on every animation frame.
 * Use a ref to hold mutable values that the callback reads/writes to avoid
 * stale closure issues.
 *
 * @example
 * const progressRef = useRef(0);
 * useGlobalTick((ts) => {
 *   progressRef.current = (ts % 1000) / 1000;
 * });
 */

import { useEffect, useRef } from "react";
import { registerTickCallback, unregisterTickCallback, type TickCallback } from "@/lib/store/global-ticker";

/**
 * Subscribe `callback` to the global rAF loop.
 * The callback reference may change across renders — the hook always calls the
 * latest version without re-registering.
 */
export function useGlobalTick(callback: TickCallback): void {
  // Keep a stable ref so the registered closure always sees the latest callback
  // without needing to re-register on every render. The assignment runs in an
  // effect (not render) to satisfy react-hooks/refs.
  const cbRef = useRef<TickCallback>(callback);
  useEffect(() => { cbRef.current = callback; }, [callback]);

  useEffect(() => {
    const id = registerTickCallback((ts) => cbRef.current(ts));
    return () => unregisterTickCallback(id);
  }, []); // empty — register once, cleanup on unmount
}
