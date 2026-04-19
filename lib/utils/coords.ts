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

/**
 * Canonical pointer → micros helper for the timeline.
 *
 * Every pointer-driven interaction (ruler click/drag, bracket drag, playhead
 * scrub, shift-click range, future drag tools) MUST derive micros through
 * this function. It reads rect + scrollLeft directly off the outer scroll
 * container — the one that owns scrollLeft — to avoid the double-scroll
 * class of bugs that arises when a handler measures against an inner
 * stretched content node (whose getBoundingClientRect already embeds
 * the current scroll offset).
 *
 * Formula: (((clientX - outerScrollRect.left) + scrollLeft) / pps) * 1e6
 *
 * @param clientX           Pointer event clientX.
 * @param outerScrollEl     The HTMLElement with overflow-x:auto that owns
 *                          scrollLeft. Must NOT be an inner stretched
 *                          content node.
 * @param pixelsPerSecond   Committed pps from the playback store.
 */
export function pointerToMicros(
  clientX: number,
  outerScrollEl: HTMLElement,
  pixelsPerSecond: number,
): number {
  const rect = outerScrollEl.getBoundingClientRect();
  const scrollLeft = outerScrollEl.scrollLeft;
  return (((clientX - rect.left) + scrollLeft) / pixelsPerSecond) * 1_000_000;
}
