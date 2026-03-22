// ── SVG Filter Generators for Advanced FX ─────────────────
// These return SVG filter XML strings for effects that can't
// be achieved with CSS filters alone.

import type { ClipEvent } from "@/lib/store/types";

export function buildChromaticAberrationFilter(
  id: string,
  offset: number,
  levelScale: number,
): string {
  const dx = offset * levelScale;
  // x/y/width/height extend the filter region so shifted channels aren't clipped
  return `
    <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix"
        values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
        result="r"/>
      <feOffset in="r" dx="${dx}" dy="0" result="rs"/>
      <feColorMatrix in="SourceGraphic" type="matrix"
        values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
        result="g"/>
      <feColorMatrix in="SourceGraphic" type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
        result="b"/>
      <feOffset in="b" dx="${-dx}" dy="0" result="bs"/>
      <feBlend in="rs" in2="g" mode="screen" result="rg"/>
      <feBlend in="rg" in2="bs" mode="screen"/>
    </filter>`;
}

/** Pixelate filter: Gaussian blur averages pixels into blocks, then feComponentTransfer
 *  type="discrete" quantizes colors to N levels — clean, high-contrast digital mosaic. */
export function buildPixelateFilter(id: string, blockSize: number): string {
  const blur = (blockSize * 0.6).toFixed(1);
  const steps = Math.max(4, Math.round(24 / blockSize));
  const tableValues = Array.from({ length: steps + 1 }, (_, i) =>
    (i / steps).toFixed(3)
  ).join(" ");
  return `
    <filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="${blur}" in="SourceGraphic" result="avg"/>
      <feComponentTransfer in="avg">
        <feFuncR type="discrete" tableValues="${tableValues}"/>
        <feFuncG type="discrete" tableValues="${tableValues}"/>
        <feFuncB type="discrete" tableValues="${tableValues}"/>
      </feComponentTransfer>
    </filter>`;
}

export function buildInvertedCircleMask(
  id: string,
  cx: number,
  cy: number,
  r: number,
): string {
  return `
    <mask id="${id}" maskContentUnits="objectBoundingBox">
      <rect width="1" height="1" fill="white"/>
      <circle cx="${cx / 100}" cy="${cy / 100}" r="${r / 100}" fill="black"/>
    </mask>`;
}

export type FeatheredMaskParams = {
  x: number; y: number; width: number; height: number;
  featherPx: number;
  points?: { x: number; y: number }[];
  invert?: boolean;
};

/** Build an SVG mask with feathered (blurred) edges */
export function buildFeatheredMask(
  id: string,
  maskType: "rect" | "circle" | "polygon",
  params: FeatheredMaskParams,
): string {
  const { x, y, width, height, featherPx, points, invert } = params;
  const filterId = `${id}-blur`;
  const fg = invert ? "black" : "white";
  const bg = invert ? "white" : "black";

  const blurFilter = `
    <filter id="${filterId}">
      <feGaussianBlur stdDeviation="${featherPx}" />
    </filter>`;

  let shape: string;
  if (maskType === "circle") {
    const cx = (x + width / 2) / 100;
    const cy = (y + height / 2) / 100;
    const rx = (width / 2) / 100;
    const ry = (height / 2) / 100;
    shape = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fg}" filter="url(#${filterId})"/>`;
  } else if (maskType === "polygon" && points?.length) {
    const pts = points.map(p => `${p.x / 100},${p.y / 100}`).join(" ");
    shape = `<polygon points="${pts}" fill="${fg}" filter="url(#${filterId})"/>`;
  } else {
    const rx = x / 100;
    const ry = y / 100;
    const rw = width / 100;
    const rh = height / 100;
    shape = `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fg}" filter="url(#${filterId})"/>`;
  }

  return `${blurFilter}
    <mask id="${id}" maskContentUnits="objectBoundingBox">
      <rect width="1" height="1" fill="${bg}"/>
      ${shape}
    </mask>`;
}

/**
 * Build a masked-FX overlay filter using feComposite operator="in".
 *
 * This filter is applied via CSS `filter: url(#<id>)` on the PreviewFxMaskOverlay div,
 * whose shape is already constrained by CSS clip-path. The feComposite "in" op clips
 * the rendered output to SourceAlpha — the element's own alpha channel after clip-path —
 * so the effect is strictly contained within the mask region (no global leakage).
 *
 * The rAF loop can chain additional CSS filter functions after the url() reference,
 * e.g. `filter: url(#masked-fx-abc) hue-rotate(90deg)`.
 */
export function buildMaskedFxOverlayFilter(id: string): string {
  return `
    <filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
      <!-- Pass SourceGraphic through as-is, then composite "in" with SourceAlpha.
           SourceAlpha reflects the element's alpha AFTER clip-path paints it,
           so pixels outside the clip-path region are eliminated here. -->
      <feComposite in="SourceGraphic" in2="SourceAlpha" operator="in"/>
    </filter>`;
}

/** Collect all SVG defs needed for the current FX state */
export function collectSvgDefs(
  effectClips: ClipEvent[],
  invertedCircleMask?: { id: string; cx: number; cy: number; r: number },
  featheredMask?: { id: string; maskType: "rect" | "circle" | "polygon"; params: FeatheredMaskParams },
): string {
  const defs: string[] = [];

  for (const c of effectClips) {
    if (c.fxParams?.effectDisabled) continue;
    const effectType = String(c.fxParams?.effectType ?? "none");
    const levelScale = (c.level ?? 100) / 100;

    if (effectType === "chromatic-aberration") {
      const offset = Number(c.fxParams?.caOffset ?? 3);
      defs.push(buildChromaticAberrationFilter(`ca-${c.id}`, offset, levelScale));
    }

    if (effectType === "pixelate") {
      const blockSize = Math.max(2, Math.round(Number(c.fxParams?.blockSize ?? 8) * levelScale));
      defs.push(buildPixelateFilter(`pix-${c.id}`, blockSize));
    }

    // For masked clips: emit a feComposite "in" overlay filter to prevent global leakage
    const fxMask = c.fxParams?.fxMask as { maskType?: string } | undefined;
    if (fxMask?.maskType && fxMask.maskType !== "none") {
      defs.push(buildMaskedFxOverlayFilter(`masked-fx-${c.id}`));
    }
  }

  if (invertedCircleMask) {
    defs.push(buildInvertedCircleMask(
      invertedCircleMask.id,
      invertedCircleMask.cx,
      invertedCircleMask.cy,
      invertedCircleMask.r,
    ));
  }

  if (featheredMask) {
    defs.push(buildFeatheredMask(
      featheredMask.id,
      featheredMask.maskType,
      featheredMask.params,
    ));
  }

  return defs.join("\n");
}
