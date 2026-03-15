/** Shared grid/ruler interval logic used by TimelineGrid, TimelineRuler, and snap. */
export function getGridInterval(pixelsPerSecond: number): number {
  if (pixelsPerSecond > 500) return 0.5;
  if (pixelsPerSecond > 200) return 1;
  if (pixelsPerSecond > 50) return 2;
  if (pixelsPerSecond > 20) return 5;
  if (pixelsPerSecond > 5) return 10;
  return 30;
}
