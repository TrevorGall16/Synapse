/**
 * Shared hypno-tunnel overlay math.
 *
 * Single source of truth for the radial-gradient tunnel rendered in:
 *  - Studio: components/studio/preview-video-layer.tsx
 *  - Theater: components/feed/theater/TheaterPlayer.tsx
 *
 * Both surfaces MUST consume `buildHypnoOverlayStyle` verbatim — do not inline
 * equivalent math elsewhere. The orbit / wobble is produced by moving the
 * gradient's center point, not by rotating the element itself (which would
 * show square corners). "True center anchoring" is enforced by the fixed
 * `top:50%; left:50%; translate(-50%,-50%)` on the host element; the orbit
 * radius (ORBIT_PCT) is applied only to the gradient center coordinate.
 */

export interface HypnoOverlayParams {
  /** Raw fxParams from the active effect clip. */
  fxParams: Record<string, unknown> | undefined;
  /** Clip `level` (0..100), applied as levelScale to opacity. */
  level?: number;
  /** Seconds since the effect clip started (ph - clipStart) / 1_000_000. */
  elapsedSeconds: number;
}

export interface HypnoOverlayStyle {
  /** `background` CSS for the gradient element. */
  background: string;
  /** Spacing between rings, px. */
  spacing: number;
  /** Ring stroke width, px. */
  ringWidth: number;
  /** Gradient opacity, 0..1. */
  opacity: number;
  /** Rotation degrees used for orbit — kept for downstream consumers. */
  rotation: number;
  /** Gradient center X (percent of element, 50% ± ORBIT_PCT). */
  cx: number;
  /** Gradient center Y (percent of element, 50% ± ORBIT_PCT). */
  cy: number;
}

/**
 * Orbit radius as a percent of the gradient element's size. Must remain tiny
 * — the element is already 300%×300% of the video box, so 3% of 300% = 9% of
 * the visible tunnel, which is the intended subtle drift.
 */
export const ORBIT_PCT = 3;

export function buildHypnoOverlayStyle({
  fxParams,
  level = 100,
  elapsedSeconds,
}: HypnoOverlayParams): HypnoOverlayStyle {
  const p = fxParams ?? {};
  const intensity = Number(p.intensity ?? 50) / 100;
  const levelScale = level / 100;

  const tSpeed    = Number(p.tunnelSpeed    ?? Number(p.speed ?? 50));
  const tCount    = Number(p.tunnelCount    ?? 10);
  const tOpacity  = (Number(p.tunnelOpacity ?? 50) / 100) * levelScale;
  const tRotation = Number(p.tunnelRotation ?? 0);

  const baseSpacing = Math.max(5, 200 / tCount);
  const spacing     = baseSpacing + Math.sin(elapsedSeconds * tSpeed * 0.1) * (baseSpacing * 0.4);
  const ringWidth   = Math.max(1, baseSpacing * 0.3 * intensity);

  const rotation = tRotation + elapsedSeconds * tSpeed * 2;
  const angleRad = (rotation * Math.PI) / 180;
  const cx = 50 + Math.cos(angleRad) * ORBIT_PCT;
  const cy = 50 + Math.sin(angleRad) * ORBIT_PCT;

  const background =
    `repeating-radial-gradient(circle at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ` +
    `transparent 0px, transparent ${spacing}px, ` +
    `rgba(255,255,255,${tOpacity}) ${spacing}px, ` +
    `rgba(255,255,255,${tOpacity}) ${spacing + ringWidth}px)`;

  return { background, spacing, ringWidth, opacity: tOpacity, rotation, cx, cy };
}
