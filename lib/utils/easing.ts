/** Smooth-step: accelerates then decelerates. t must be in [0, 1]. */
export function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}
