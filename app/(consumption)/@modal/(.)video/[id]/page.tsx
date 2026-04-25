"use client";

import { useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ScrollLockWhileModal } from "@/components/chrome/scroll-lock-while-modal";
import VideoIdPage from "../../../video/[id]/page";

/** Intercepted overlay variant of /video/[id]. The Feed stays mounted beneath —
 *  that is the entire point of intercepting routes.
 *
 *  Architecture notes:
 *  - `transform: translateZ(0)` on the inner container forces a CSS containing
 *    block, so TheaterMode's `position: fixed; inset: 0` is relative to this
 *    box (not the viewport). On desktop the box is a centered 9:16 portrait;
 *    the surrounding backdrop area is therefore clickable to dismiss.
 *  - `usePathname()` self-clear: router.back() reliably updates the URL but
 *    Next.js parallel route slots don't always re-render synchronously.
 *    Returning null when pathname no longer matches /video/* makes the overlay
 *    vanish immediately without depending on the slot update.
 *  - Esc uses capture phase + stopImmediatePropagation so only this handler
 *    fires; TheaterMode also listens for Escape on onClose, which would double-
 *    dismiss without the capture intercept.
 *
 *  Spec 2: replace outer div with motion.div + layoutId={params.id} for the
 *  card morph animation. */
export default function InterceptedVideoPage() {
  const router   = useRouter();
  const pathname = usePathname();
  const dismiss  = useCallback(() => router.back(), [router]);

  // Capture-phase Esc intercept — fires before TheaterMode's bubble-phase listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation(); // prevent TheaterMode's own handler from also calling onClose
      dismiss();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [dismiss]);

  // Self-clear: once router.back() changes the URL away from /video/*, return
  // null immediately. This handles Next.js not always re-rendering @modal slot.
  if (!pathname.startsWith("/video/")) return null;

  return (
    <div
      data-testid="intercepted-theater-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-3xl"
      onClick={dismiss}
    >
      {/* transform: translateZ(0) creates a CSS containing block so TheaterMode's
          position:fixed is confined to this portrait box, not the full viewport.
          On desktop this leaves visible backdrop edges left/right that are
          clickable to dismiss. lg:rounded-3xl clips TheaterMode to the box. */}
      <div
        className="relative h-screen w-full overflow-hidden lg:w-auto lg:aspect-[9/16] lg:rounded-3xl"
        style={{ transform: "translateZ(0)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <ScrollLockWhileModal />
        <VideoIdPage />
      </div>
    </div>
  );
}
