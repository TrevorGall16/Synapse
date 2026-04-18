"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { startTransition } from "react";

type Mutate = (params: URLSearchParams) => void;

/**
 * Pure helper — exported for testing. Reads `currentSearch` verbatim (caller
 * always passes `window.location.search`), applies `mutate`, and returns:
 *   - `null` when the mutation produced no delta vs `currentSearch` (equality
 *     guard — the caller must skip navigation),
 *   - the next `URLSearchParams.toString()` otherwise.
 *
 * The caller is responsible for deciding heavy (router) vs lightweight
 * (history) dispatch. This function never touches the DOM or the router.
 */
export function mergeAndGuard(currentSearch: string, mutate: Mutate): string | null {
  const before = new URLSearchParams(currentSearch);
  const after = new URLSearchParams(currentSearch);
  mutate(after);
  const beforeStr = before.toString();
  const afterStr = after.toString();
  if (beforeStr === afterStr) return null;
  return afterStr;
}

/**
 * Unified URL-sync hook. All four methods:
 *   1. Read `window.location.search` at call time — NOT `useSearchParams()`.
 *      Next's hook can trail lightweight history.*State writes, so any merge
 *      based on it loses params Theater pushed via raw history.
 *   2. Merge the caller's `mutate` over the current search.
 *   3. Skip the navigation entirely when the result equals current (IPC
 *      throttling prevention).
 *
 * Heavy variants go through `router.push`/`router.replace` — use when the
 * downstream layout depends on Next.js server-route awareness (e.g. segment
 * change, SSR props).
 *
 * Lightweight variants use `history.pushState`/`replaceState` — use for
 * overlays and filter chips where we only want the URL to reflect UI state
 * without retriggering Next.js route matching.
 */
export function useSafeUrlSync(basePath = "/") {
  const router = useRouter();

  const heavyReplace = useCallback((mutate: Mutate) => {
    const next = mergeAndGuard(window.location.search, mutate);
    if (next === null) return;
    const qs = next ? `?${next}` : "";
    startTransition(() => router.replace(`${basePath}${qs}`));
  }, [router, basePath]);

  const heavyPush = useCallback((mutate: Mutate) => {
    const next = mergeAndGuard(window.location.search, mutate);
    if (next === null) return;
    const qs = next ? `?${next}` : "";
    startTransition(() => router.push(`${basePath}${qs}`));
  }, [router, basePath]);

  const lightweightReplace = useCallback((nextPath: string, mutate: Mutate) => {
    const next = mergeAndGuard(window.location.search, mutate);
    // Even when params are unchanged, allow a pathname-only change through.
    if (next === null && window.location.pathname === nextPath) return;
    const qs = next !== null && next ? `?${next}` : (next === "" ? "" : window.location.search);
    window.history.replaceState(window.history.state, "", `${nextPath}${qs}`);
  }, []);

  const lightweightPush = useCallback((nextPath: string, mutate: Mutate) => {
    const next = mergeAndGuard(window.location.search, mutate);
    if (next === null && window.location.pathname === nextPath) return;
    const qs = next !== null && next ? `?${next}` : (next === "" ? "" : window.location.search);
    window.history.pushState(window.history.state, "", `${nextPath}${qs}`);
  }, []);

  return { heavyReplace, heavyPush, lightweightReplace, lightweightPush };
}
