"use client";

// ── useMediaPoolUrl ──────────────────────────────────────────────────────────
// Resolves a live blob URL for a single MediaPool item by ID.
//
// Resolution order:
//   1. If the project store already holds a live previewUrl, use it directly —
//      zero IDB I/O for the common case.
//   2. If the previewUrl is missing or stale (empty string), reconstruct it
//      from IndexedDB via refreshMediaUrl(). The reconstructed URL is *not*
//      written back to the store so this component owns its own lifecycle.
//   3. Any object URL created here is revoked on unmount to prevent leaks.
//      (Object URLs owned by the project store are managed separately by the
//       store and must NOT be revoked here.)
//
// Returns:
//   { url }  — null until resolved; a stable string once ready.

import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import { refreshMediaUrl } from "@/lib/store/media-pool-db";

export function useMediaPoolUrl(clipId: string): { url: string | null } {
  // Read the previewUrl from the store once; selector is stable per clipId.
  const storePreviewUrl = useProjectStore((s) => {
    const item = s.mediaPool.find((m) => m.id === clipId);
    return item?.previewUrl ?? null;
  });

  // Track whether the URL we hold was created locally (needs revocation on cleanup).
  const ownedBlobRef = useRef<string | null>(null);
  // Only tracks IDB-reconstructed URLs. Store-owned URLs flow through the
  // derived return below — no effect-setState needed for the common case.
  const [hydratedUrl, setHydratedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!clipId) return;
    // Store already has a live URL — rendered directly; skip IDB.
    if (storePreviewUrl) return;

    let cancelled = false;
    refreshMediaUrl(clipId)
      .then((fresh) => {
        if (cancelled || !fresh) return;
        // Mark as locally owned so we revoke on cleanup.
        ownedBlobRef.current = fresh;
        setHydratedUrl(fresh);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      // Revoke only URLs we created — never touch store-owned blob URLs.
      if (ownedBlobRef.current) {
        URL.revokeObjectURL(ownedBlobRef.current);
        ownedBlobRef.current = null;
      }
    };
  }, [clipId, storePreviewUrl]);

  const url = storePreviewUrl ?? hydratedUrl;
  return { url };
}
