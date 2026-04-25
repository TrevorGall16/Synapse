"use client";

import { useEffect } from "react";
import { detectGlassTier } from "./glass-capability";

/** Client-only: sets `data-glass-tier` on <body> so CSS rules can downgrade
 *  blur/shadow on modest hardware without any per-component wiring. */
export function GlassCapabilityMount() {
  useEffect(() => {
    const tier = detectGlassTier();
    document.body.setAttribute("data-glass-tier", tier);
    return () => {
      document.body.removeAttribute("data-glass-tier");
    };
  }, []);
  return null;
}
