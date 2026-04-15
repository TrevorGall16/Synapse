"use client";

import { useEffect, useRef, useState } from "react";
import { refreshMediaUrl } from "@/lib/store/media-pool-db";

/**
 * Returns a live blob URL for a media item, hydrated lazily on viewport entry.
 *
 * - If `previewUrl` is a non-blob URL (remote CDN, data URI) it is returned immediately.
 * - If `previewUrl` is a stale blob: URL or empty string, we wait until the
 *   attached ref's element enters the viewport (+ 200px rootMargin) and then
 *   call refreshMediaUrl(mediaId) to reconstruct from IDB.
 *
 * Usage:
 *   const { ref, url } = useLazyMediaUrl(item.id, item.previewUrl);
 *   <div ref={ref}><video src={url || undefined} /></div>
 */
export function useLazyMediaUrl(
  mediaId: string | undefined,
  previewUrl: string | undefined,
): { ref: React.RefObject<HTMLDivElement | null>; url: string | null } {
  const nodeRef = useRef<HTMLDivElement>(null);
  // Only tracks IDB-reconstructed blob URLs. Non-blob URLs flow through the
  // derived return below — no effect-setState needed.
  const [hydratedUrl, setHydratedUrl] = useState<string | null>(null);

  const isBlobSource = !previewUrl || previewUrl.startsWith("blob:");

  useEffect(() => {
    if (!mediaId) return;
    // Non-blob URLs are returned directly below; skip the IO watcher entirely.
    if (!isBlobSource) return;

    let cancelled = false;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        obs.disconnect();
        refreshMediaUrl(mediaId).then((fresh) => {
          if (!cancelled && fresh) setHydratedUrl(fresh);
        }).catch(() => {});
      },
      { rootMargin: "200px" },
    );

    if (nodeRef.current) obs.observe(nodeRef.current);
    return () => { cancelled = true; obs.disconnect(); };
  }, [mediaId, isBlobSource]);

  const url = !isBlobSource ? (previewUrl as string) : hydratedUrl;
  return { ref: nodeRef, url };
}
