"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  registerTickCallback,
  unregisterTickCallback,
} from "@/lib/store/global-ticker";

const HYSTERESIS_PX = 20;
const FLOOR_PX      = 8;

/** Returns `true` when the Glass Island should be in its compressed form.
 *  `scrollRef` is optional; when omitted or null, the hook listens on
 *  `document.documentElement`. */
export function useGlassIslandState(
  scrollRef?: RefObject<HTMLElement | null>,
): boolean {
  const [compressed, setCompressed] = useState(false);
  const lastY       = useRef(0);
  const accumulator = useRef(0);
  const dirty       = useRef(false);

  useEffect(() => {
    // Resolve target: explicit ref > document scrolling element > <html>.
    const el: HTMLElement =
      scrollRef?.current ??
      (document.scrollingElement as HTMLElement | null) ??
      document.documentElement;

    lastY.current       = el.scrollTop;
    accumulator.current = 0;
    dirty.current       = false;

    const onScroll = () => { dirty.current = true; };

    const tickId = registerTickCallback(() => {
      if (!dirty.current) return;
      dirty.current = false;

      const y = el.scrollTop;
      const delta = y - lastY.current;
      lastY.current = y;

      // Near-top override — always expanded above FLOOR_PX.
      if (y <= FLOOR_PX) {
        accumulator.current = 0;
        setCompressed((c) => (c ? false : c));
        return;
      }

      // Sign-change reset — restart the accumulator when the direction flips.
      if (
        Math.sign(delta) !== Math.sign(accumulator.current) &&
        accumulator.current !== 0
      ) {
        accumulator.current = delta;
      } else {
        accumulator.current += delta;
      }

      if (accumulator.current >= HYSTERESIS_PX) {
        setCompressed((c) => (c ? c : true));
        accumulator.current = HYSTERESIS_PX;
      } else if (accumulator.current <= -HYSTERESIS_PX) {
        setCompressed((c) => (!c ? c : false));
        accumulator.current = -HYSTERESIS_PX;
      }
    });

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      unregisterTickCallback(tickId);
    };
  }, [scrollRef]);

  return compressed;
}
