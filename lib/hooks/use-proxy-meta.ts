// lib/hooks/use-proxy-meta.ts
// React hook that reads ProxyMeta for a list of media IDs.
// Loads on mount; does NOT poll — call refresh() after generate/clear.

"use client";

import { useState, useCallback, useEffect } from "react";
import { batchGetProxyMeta, type ProxyMeta } from "@/lib/store/proxy-registry";

export function useProxyMeta(ids: string[]): {
  proxyMap: Record<string, ProxyMeta>;
  refresh: () => Promise<void>;
} {
  const [proxyMap, setProxyMap] = useState<Record<string, ProxyMeta>>({});

  // Stable string key — rebuild when IDs list changes
  const idsKey = ids.join(",");

  const refresh = useCallback(async () => {
    if (ids.length === 0) { setProxyMap({}); return; }
    const map = await batchGetProxyMeta(ids);
    setProxyMap(map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { proxyMap, refresh };
}
