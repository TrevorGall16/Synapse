/**
 * Convert pointer clientX to timeline-local pixels.
 * Accounts for container origin (rect.left) and horizontal scroll offset.
 */
export function screenPxToTimelinePx(
  clientX: number,
  rect: DOMRect,
  scrollLeft: number
): number {
  return clientX - rect.left + scrollLeft;
}

/**
 * Convert timeline-local pixels to microseconds.
 */
export function timelinePxToTimeMicros(
  px: number,
  pixelsPerSecond: number
): number {
  return (px / pixelsPerSecond) * 1_000_000;
}

/**
 * Convert microseconds to timeline-local pixels (for rendering clip positions).
 */
export function timeMicrosToTimelinePx(
  micros: number,
  pixelsPerSecond: number
): number {
  return (micros / 1_000_000) * pixelsPerSecond;
}

/**
 * Compound convenience: clientX → microseconds in one call.
 * Use this for click/drag/scrub handlers on the timeline container.
 */
export function screenXToTimeMicros(
  clientX: number,
  rect: DOMRect,
  scrollLeft: number,
  pixelsPerSecond: number
): number {
  return timelinePxToTimeMicros(
    screenPxToTimelinePx(clientX, rect, scrollLeft),
    pixelsPerSecond
  );
}
