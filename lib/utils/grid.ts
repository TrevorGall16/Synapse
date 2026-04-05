/**
 * Shared grid/ruler interval logic used by TimelineGrid, TimelineRuler, and snap.
 * Enforces a minimum pixel spacing of 60px between labels to prevent overlap at
 * extreme zoom levels (e.g. 300%).
 */
export function getGridInterval(pixelsPerSecond: number): number {
  const MIN_LABEL_PX = 60;
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  for (const step of candidates) {
    if (step * pixelsPerSecond >= MIN_LABEL_PX) return step;
  }
  return 60;
}
