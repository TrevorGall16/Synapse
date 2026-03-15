"use client";

import { useState, useEffect } from "react";
import type { ClipEvent, MediaPoolItem } from "@/lib/store/types";
import { extractVideoFrames } from "@/lib/utils/media-extractor";

interface ClipFilmstripProps {
  clip: ClipEvent;
  media: MediaPoolItem;
  clipWidthPx: number;
}

export function ClipFilmstrip({ clip, media, clipWidthPx }: ClipFilmstripProps) {
  const thumbCount = Math.min(10, Math.max(1, Math.ceil(clipWidthPx / 80)));
  const thumbWidth = clipWidthPx / thumbCount;

  // Image clips: tile the source image
  if (media.type === "image") {
    return (
      <div className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-40">
        {Array.from({ length: thumbCount }, (_, i) => (
          <img
            key={i}
            src={media.previewUrl}
            alt=""
            className="h-full shrink-0 object-cover"
            style={{ width: thumbWidth }}
          />
        ))}
      </div>
    );
  }

  // Video clips: extract static JPEG frames via canvas (no <video> in DOM)
  const [frames, setFrames] = useState<string[]>([]);

  useEffect(() => {
    if (!media.previewUrl) return;
    let cancelled = false;
    extractVideoFrames(media.previewUrl, thumbCount).then((f) => {
      if (!cancelled) setFrames(f);
    });
    return () => {
      cancelled = true;
    };
  }, [media.previewUrl, thumbCount]);

  if (frames.length === 0) {
    return <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/5" />;
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-40">
      {frames.map((src, i) => (
        <img
          key={i}
          src={src}
          alt=""
          className="h-full shrink-0 object-cover"
          style={{ width: thumbWidth }}
        />
      ))}
    </div>
  );
}
