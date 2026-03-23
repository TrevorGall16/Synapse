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
  const [url, setUrl] = useState<string | null>(() => {
    // Immediately use non-blob URLs (remote / data URI)
    if (previewUrl && !previewUrl.startsWith("blob:")) return previewUrl;
    return null;
  });

  useEffect(() => {
    if (!mediaId) return;

    // Non-blob URLs need no IDB lookup
    if (previewUrl && !previewUrl.startsWith("blob:")) {
      setUrl(previewUrl);
      return;
    }

    let cancelled = false;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        obs.disconnect();
        refreshMediaUrl(mediaId).then((fresh) => {
          if (!cancelled && fresh) setUrl(fresh);
        }).catch(() => {});
      },
      { rootMargin: "200px" },
    );

    if (nodeRef.current) obs.observe(nodeRef.current);
    return () => { cancelled = true; obs.disconnect(); };
  }, [mediaId, previewUrl]);

  return { ref: nodeRef, url };
}
