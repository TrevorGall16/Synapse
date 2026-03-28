/**
 * components/feed/theater-gesture.ts
 *
 * Module-level gesture state shared between TheaterMode and TheaterCell.
 * Must live outside React so it persists across re-renders and fires within
 * the browser's synchronous gesture trust window.
 */

// Set synchronously in the click handler (before React batches the state update)
// so the matching TheaterCell's useLayoutEffect fires within the gesture trust window.
let _gesturePendingId: string | null = null;

/** Prime the gesture lock for `postId`. Call synchronously inside a click handler. */
export function primeTheaterGesture(postId: string): void {
  _gesturePendingId = postId;
}

/**
 * Consume the pending gesture for `postId`.
 * Returns true if the gesture was pending and clears the lock.
 * Idempotent — safe to call even when no gesture is pending.
 */
export function consumeTheaterGesture(postId: string): boolean {
  if (_gesturePendingId !== postId) return false;
  _gesturePendingId = null;
  return true;
}

/** True after first explicit tap-to-play; subsequent cells can autoplay without muted fallback. */
export let hasInteracted = false;
export function markInteracted(): void { hasInteracted = true; }
