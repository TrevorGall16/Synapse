"use client";

// ── VideoPreviewCard ─────────────────────────────────────────────────────────
// Feed card that loads a video from the MediaPool (IndexedDB), loops it
// between [loopStart, loopEnd] seconds, and auto-plays when scrolled into view.
//
// Video Lifecycle Compliance:
//   Rule 1 — Autoplay: `muted` + `playsInline` on the element; `.play()` is
//                       called directly from the IntersectionObserver callback,
//                       which runs as a native browser callback outside React's
//                       async commit cycle, keeping it as close to synchronous
//                       as the browser permits for muted autoplay.
//   Rule 2 — Stable Src: URL is resolved once from the store/IDB via clipId
//                         (stable string primitive). useMediaPoolUrl owns the
//                         URL lifecycle and calls revokeObjectURL on cleanup.
//   Rule 3 — Frame Loop: Loop uses requestAnimationFrame behind an
//                         onLoadedMetadata guard. onTimeUpdate is NOT used.
//   Rule 4 — Memory:     No URL.createObjectURL() in this component.
//                         useMediaPoolUrl handles creation and revocation.
//
// Performance contract (20+ cards on screen):
//   - One shared IntersectionObserver per rootMargin config (observeViewport pool).
//   - `preload="none"` until in-view; switches to `preload="metadata"` on entry
//     (fetches duration/dimensions only, not the full video). Resets to `preload="none"`
//     on exit to free connection slots for the Chrome 6-connection limit.
//   - rAF loop is stopped when the card leaves the viewport.
//   - play() Promises are tracked and awaited before any pause() call to prevent
//     the "play() interrupted by pause()" DOMException.

import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaPoolUrl } from "@/lib/hooks/use-media-pool-url";
import { observeViewport } from "@/lib/utils/intersection-observer-pool";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";

// ── Types ────────────────────────────────────────────────────────────────────

interface VideoPreviewCardProps {
  /** ID of the MediaPool item to load. */
  clipId: string;
  /** Seconds at which the loop restarts. Defaults to 8. */
  loopEnd?: number;
  /** Seconds from which the loop begins. Defaults to 0. */
  loopStart?: number;
  /** Optional CSS class applied to the outer wrapper div. */
  className?: string;
  /** Aspect ratio for the card wrapper. Defaults to "9/16" (vertical). */
  aspectRatio?: string;
  /** Called when the card is clicked — typically opens Theater Mode. */
  onClick?: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function VideoPreviewCard({
  clipId,
  loopEnd = 8,
  loopStart = 0,
  className = "",
  aspectRatio = "9/16",
  onClick,
}: VideoPreviewCardProps) {
  // Rule 2: stable URL resolved by the hook; never derived here.
  const { url } = useMediaPoolUrl(clipId);

  const videoRef    = useRef<HTMLVideoElement>(null);
  const wrapperRef  = useRef<HTMLDivElement>(null);

  // Rule 1: track in-flight play() Promise so pause() is never called before
  // it resolves, which would throw "play() interrupted by pause()".
  const playPromiseRef  = useRef<Promise<void> | null>(null);

  // Rule 3: GlobalTicker callback ID and metadata-ready guard.
  const tickIdRef       = useRef<number | null>(null);
  const metaReadyRef    = useRef(false);

  // Tracks whether the card is currently in view — drives the rAF loop.
  const inViewRef       = useRef(false);

  const [hasError, setHasError] = useState(false);
  // Reset hasError when the source url changes — prev-value-in-render pattern
  // avoids a setState-in-effect cascade (see React docs: "Resetting state when a prop changes").
  const [prevUrl, setPrevUrl] = useState(url);
  if (prevUrl !== url) {
    setPrevUrl(url);
    setHasError(false);
  }

  // ── Rule 3: frame-accurate loop via GlobalTicker ─────────────────────────
  // Runs at ~16ms (60fps) — far more precise than onTimeUpdate's ~250ms.
  // Registered/unregistered on the centralized GlobalTicker instead of
  // spawning an independent rAF chain per card.
  const loopFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || !metaReadyRef.current || !inViewRef.current) return;

    const end = Math.min(loopEnd, v.duration);
    if (v.currentTime >= end || v.currentTime < loopStart) {
      v.currentTime = loopStart;
    }
  }, [loopEnd, loopStart]);

  const stopLoop = useCallback(() => {
    if (tickIdRef.current !== null) {
      unregisterTickCallback(tickIdRef.current);
      tickIdRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    tickIdRef.current = registerTickCallback(loopFrame);
  }, [loopFrame, stopLoop]);

  // ── Rule 3: onLoadedMetadata guard ───────────────────────────────────────
  // `duration` is only a valid finite number after this event fires.
  // We cannot call Math.min(loopEnd, v.duration) safely before this point.
  const handleLoadedMetadata = useCallback(() => {
    metaReadyRef.current = true;
    // If IntersectionObserver already set the card as in-view before metadata
    // arrived, start the rAF loop now.
    if (inViewRef.current) startLoop();
  }, [startLoop]);

  // ── Error handler ─────────────────────────────────────────────────────────
  const handleError = useCallback(() => setHasError(true), []);

  // ── IntersectionObserver (shared pool, Rule 1) ───────────────────────────
  // The observeViewport callback fires as a native browser callback — NOT
  // inside a React commit. This is the closest we can get to a synchronous
  // context for muted autoplay without requiring an explicit user gesture.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const unobserve = observeViewport(
      wrapper,
      (intersecting) => {
        const v = videoRef.current;
        inViewRef.current = intersecting;

        if (intersecting && v && url) {
          // Fetch only metadata (duration, dimensions) — not the full video.
          // Avoids saturating Chrome's 6-connection limit on a 7-column grid.
          v.preload = "metadata";

          // Rule 1: .play() called directly from the observer callback.
          playPromiseRef.current = v.play();
          playPromiseRef.current?.catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") return;
            if (err instanceof DOMException && err.name === "NotAllowedError") return;
            console.warn("[VideoPreviewCard] play() failed:", err);
          });

          // Only start the rAF loop if metadata is already known.
          if (metaReadyRef.current) startLoop();
        } else if (!intersecting && v) {
          // Pause safely — wait for any in-flight play() Promise first.
          stopLoop();
          if (playPromiseRef.current) {
            playPromiseRef.current.then(() => v.pause()).catch(() => {});
          } else {
            v.pause();
          }
          playPromiseRef.current = null;
          // Signal browser to stop buffering off-screen cards.
          // This frees connection slots for visible cards and reduces memory pressure.
          v.preload = "none";
        }
      },
      "0px",
      0,
    );

    return () => {
      unobserve();
      stopLoop();
    };
  // `url` and `startLoop`/`stopLoop` are intentionally in deps: if the URL
  // resolves after the first mount the observer needs to re-evaluate.
  }, [url, startLoop, stopLoop]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapperRef}
      className={`relative overflow-hidden rounded-xl bg-[#1a1a1a] ${className}`}
      style={{ aspectRatio }}
      onClick={onClick}
    >
      {/* Placeholder shimmer while URL resolves */}
      {!url && !hasError && (
        <div className="absolute inset-0 animate-pulse bg-white/5" aria-hidden />
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-[10px] font-semibold text-white/30">Media unavailable</p>
        </div>
      )}

      {/*
       * Rule 1: `muted` + `playsInline` set declaratively.
       * `preload="none"` until the IntersectionObserver flips it to "auto"
       *   so the browser does not buffer all 20+ off-screen cards at once.
       * `loop` is intentionally omitted — the rAF loop controls the window
       *   [loopStart, loopEnd]; the native loop would reset to 0, not loopStart.
       */}
      {url && (
        <video
          ref={videoRef}
          src={url}
          preload="none"
          muted
          playsInline
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error — fetchpriority is a valid HTML attribute not yet in React types
          fetchpriority="low"
          className="absolute inset-0 h-full w-full object-cover"
          onLoadedMetadata={handleLoadedMetadata}
          onError={handleError}
        />
      )}
    </div>
  );
}
