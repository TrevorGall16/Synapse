"use client";

import { useEffect } from "react";
import { useConsumptionScrollRef } from "./consumption-scroll-context";

/** Mount inside any consumption-layout modal overlay that must prevent the
 *  underlying page scroll. The consumption layout's <main> is the single
 *  scroll container (not document.body); this locks that element's overflow
 *  and reserves the displaced scrollbar width as right-side padding so the
 *  Feed grid does not jerk horizontally on open. macOS overlay scrollbars /
 *  iOS Safari measure 0 and only `overflow: hidden` is applied. */
export function ScrollLockWhileModal() {
  const scrollRef = useConsumptionScrollRef();
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;

    const scrollbarWidth = Math.max(0, el.offsetWidth - el.clientWidth);
    const prevOverflow = el.style.overflow;
    const prevPaddingRight = el.style.paddingRight;

    // eslint-disable-next-line react-hooks/immutability
    el.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      el.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      el.style.overflow = prevOverflow;
      el.style.paddingRight = prevPaddingRight;
    };
  }, [scrollRef]);

  return null;
}
