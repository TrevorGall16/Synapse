/**
 * Convert pointer clientX to timeline-local pixels.
 * Accounts for container origin (rect.left), horizontal scroll offset,
 * and an optional CSS zoomScale (scaleX applied to the track area during
 * zoom-slider drag). When no CSS transform is active, zoomScale = 1.
 *
 * Formula: (clientX - rect.left) / zoomScale + scrollLeft
 */
export function screenPxToTimelinePx(
  clientX: number,
  rect: DOMRect,
  scrollLeft: number,
  zoomScale: number = 1,
): number {
  return (clientX - rect.left) / zoomScale + scrollLeft;
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
  pixelsPerSecond: number,
  zoomScale: number = 1,
): number {
  return timelinePxToTimeMicros(
    screenPxToTimelinePx(clientX, rect, scrollLeft, zoomScale),
    pixelsPerSecond
  );
}
