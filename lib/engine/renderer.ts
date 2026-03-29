// lib/engine/renderer.ts
//
// RendererSyncAdapter — bridges GlobalTicker (display frame scheduling) with
// MasterClock (AudioContext-anchored canonical time).
//
// Design rules (Constitution):
//   - NO performance.now() — time source is exclusively MasterClock.getCurrentTimeMicros()
//   - NO logic-driven rAF — all frame scheduling goes through GlobalTicker
//   - Zero React/DOM dependencies — this is a pure engine module

import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";
import type { MasterClock } from "./master-clock";
import type { MicrosecondTime } from "./types";

export type RenderFrameCallback = (timeMicros: MicrosecondTime, displayTimestamp: DOMHighResTimeStamp) => void;

/**
 * Combines GlobalTicker (display frame rate) with MasterClock (AudioContext time).
 *
 * On each rAF tick from GlobalTicker:
 *   - `displayTimestamp` = raw DOMHighResTimeStamp from the browser's rAF (for smooth UI)
 *   - `timeMicros` = MasterClock.getCurrentTimeMicros() (AudioContext-anchored, the canonical clock)
 *
 * Consumers receive both so they can use AudioContext time for sync decisions while
 * using displayTimestamp for sub-frame interpolation if needed.
 */
export class RendererSyncAdapter {
  private tickId: number | null = null;
  private callbacks = new Set<RenderFrameCallback>();
  private clock: MasterClock;

  constructor(clock: MasterClock) {
    this.clock = clock;
  }

  /** Start forwarding GlobalTicker frames to registered callbacks. */
  start(): void {
    if (this.tickId !== null) return; // idempotent
    this.tickId = registerTickCallback((displayTimestamp: DOMHighResTimeStamp) => {
      // AudioContext.currentTime is the canonical source of truth (via MasterClock).
      // displayTimestamp from GlobalTicker is used only for smooth display interpolation.
      const timeMicros = this.clock.getCurrentTimeMicros();
      for (const cb of this.callbacks) {
        cb(timeMicros, displayTimestamp);
      }
    });
  }

  /** Stop forwarding frames. Callbacks remain registered for re-use after restart. */
  stop(): void {
    if (this.tickId === null) return;
    unregisterTickCallback(this.tickId);
    this.tickId = null;
  }

  /**
   * Register a frame callback. Returns an unsubscribe function.
   * The adapter must be `start()`ed for callbacks to receive frames.
   */
  onFrame(cb: RenderFrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  /** True when the adapter is actively forwarding frames. */
  get isRunning(): boolean {
    return this.tickId !== null;
  }

  destroy(): void {
    this.stop();
    this.callbacks.clear();
  }
}
