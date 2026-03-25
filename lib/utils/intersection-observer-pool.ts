// ── Shared IntersectionObserver pool ────────────────────────────────────────
// Instead of each VideoPreviewCard creating its own IntersectionObserver
// (which spawns a separate layout-query thread per card), all cards share a
// single observer instance per rootMargin configuration.
//
// Cost at 20 cards: 1 observer, 1 root intersection query.
// Cost without this: 20 observers, 20 root intersection queries.
//
// Usage:
//   const unobserve = observeViewport(el, callback, "0px");
//   // call unobserve() in cleanup

type ViewportCallback = (isIntersecting: boolean) => void;

const observerCache = new Map<string, IntersectionObserver>();
const callbackMap = new Map<Element, ViewportCallback>();

function getObserver(rootMargin: string, threshold: number): IntersectionObserver {
  const key = `${rootMargin}::${threshold}`;
  if (observerCache.has(key)) return observerCache.get(key)!;

  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const cb = callbackMap.get(entry.target);
        if (cb) cb(entry.isIntersecting);
      }
    },
    { rootMargin, threshold },
  );

  observerCache.set(key, obs);
  return obs;
}

/**
 * Observe `el` with a shared IntersectionObserver.
 * Returns an unobserve function to call in useEffect cleanup.
 */
export function observeViewport(
  el: Element,
  callback: ViewportCallback,
  rootMargin = "0px",
  threshold = 0,
): () => void {
  const obs = getObserver(rootMargin, threshold);
  callbackMap.set(el, callback);
  obs.observe(el);

  return () => {
    obs.unobserve(el);
    callbackMap.delete(el);
  };
}
