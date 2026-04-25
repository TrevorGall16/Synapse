"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ScrollLockWhileModal } from "@/components/chrome/scroll-lock-while-modal";
import VideoIdPage from "../../../video/[id]/page";

/** Intercepted overlay variant of /video/[id]. The Feed stays mounted beneath —
 *  that is the entire point of intercepting routes. Spec 2 will replace the
 *  outer div with motion.div + layoutId={params.id} for the card morph. */
export default function InterceptedVideoPage() {
  const router = useRouter();
  const dismiss = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  return (
    <div
      data-testid="intercepted-theater-overlay"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-3xl"
      onClick={dismiss}
    >
      {/* Stop propagation so clicks inside Theater don't bubble to backdrop */}
      <div className="h-full w-full" onClick={(e) => e.stopPropagation()}>
        <ScrollLockWhileModal />
        <VideoIdPage />
      </div>
    </div>
  );
}
