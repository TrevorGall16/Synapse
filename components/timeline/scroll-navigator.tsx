"use client";

import { useEffect, useRef, type RefObject } from "react";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";

interface ScrollNavigatorProps {
  /** The horizontally-scrollable timeline container */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

/**
 * DOM-only horizontal scroll navigator.
 * Reads and writes scrollLeft via a GlobalTicker callback — zero React state,
 * zero rerenders on pan or zoom.
 */
export function ScrollNavigator({ scrollContainerRef }: ScrollNavigatorProps) {
  const rangeRef = useRef<HTMLInputElement>(null);
  const tickIdRef = useRef<number | null>(null);

  useEffect(() => {
    // Register a GlobalTicker callback to keep the range in sync with native scroll
    tickIdRef.current = registerTickCallback(() => {
      const container = scrollContainerRef.current;
      const range = rangeRef.current;
      if (!container || !range) return;

      const maxScroll = container.scrollWidth - container.clientWidth;
      if (maxScroll <= 0) {
        range.style.display = "none";
        return;
      }
      range.style.display = "";

      // Update range value to reflect current scroll position
      range.value = String((container.scrollLeft / maxScroll) * 100);

      // Update thumb width to visually represent the visible viewport fraction
      const frac = container.clientWidth / container.scrollWidth;
      range.style.setProperty("--thumb-width", `${Math.max(frac * 100, 4)}%`);
    });

    return () => {
      if (tickIdRef.current !== null) {
        unregisterTickCallback(tickIdRef.current);
        tickIdRef.current = null;
      }
    };
  }, [scrollContainerRef]);

  const onInput = (e: React.FormEvent<HTMLInputElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const pct = parseFloat((e.target as HTMLInputElement).value) / 100;
    const maxScroll = container.scrollWidth - container.clientWidth;
    container.scrollLeft = pct * maxScroll;
  };

  return (
    <div className="flex items-center px-2 py-1 border-t border-white/8 bg-[#151515]">
      <input
        ref={rangeRef}
        type="range"
        min={0}
        max={100}
        step={0.1}
        defaultValue={0}
        onInput={onInput}
        className="h-1 w-full cursor-pointer"
        aria-label="Timeline horizontal scroll position"
        style={{
          accentColor: "#3b82f6",
          // --thumb-width is set by the tick callback to show viewport fraction
        }}
      />
    </div>
  );
}
