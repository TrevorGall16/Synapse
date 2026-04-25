/** Returns the glass rendering tier for the current device.
 *  - "full"    → full backdrop-blur, shadows, glow.
 *  - "reduced" → shallower blur, no shadow, no glow.
 *  Heuristic: deviceMemory < 4 OR hardwareConcurrency < 4 → reduced.
 *  Server-side: always "full" (the client mount flips it on first paint). */
export function detectGlassTier(): "full" | "reduced" {
  if (typeof navigator === "undefined") return "full";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if ((typeof mem === "number" && mem < 4) || (typeof cores === "number" && cores < 4)) {
    return "reduced";
  }
  return "full";
}
