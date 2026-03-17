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
  return `
    <filter id="${id}" color-interpolation-filters="sRGB">
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

/** Collect all SVG defs needed for the current FX state */
export function collectSvgDefs(
  effectClips: ClipEvent[],
  invertedCircleMask?: { id: string; cx: number; cy: number; r: number },
  featheredMask?: { id: string; maskType: "rect" | "circle" | "polygon"; params: FeatheredMaskParams },
): string {
  const defs: string[] = [];

  for (const c of effectClips) {
    const effectType = String(c.fxParams?.effectType ?? "none");
    const levelScale = (c.level ?? 100) / 100;

    if (effectType === "chromatic-aberration") {
      const offset = Number(c.fxParams?.caOffset ?? 3);
      defs.push(buildChromaticAberrationFilter(`ca-${c.id}`, offset, levelScale));
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
