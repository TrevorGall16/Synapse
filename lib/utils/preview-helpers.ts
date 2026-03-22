import type { ClipEvent, PanCropData } from "@/lib/store/types";

// ── FX Mask shape — a typed view over the fxMask field stored in fxParams ──
// Uses Pick to stay in sync with PanCropData's mask coordinate convention
// (maskX/maskY are CENTER coordinates, not top-left).
export type FxMaskShape = Pick<PanCropData, "maskType" | "maskX" | "maskY" | "maskWidth" | "maskHeight" | "maskPoints">;

/** Returns a CSS clip-path string that restricts the FX overlay to the mask area.
 *  maskX/maskY are CENTER coordinates (consistent with PanCropData convention). */
export function buildMaskedFxClipPath(mask: FxMaskShape): string | undefined {
  const { maskType, maskX = 50, maskY = 50, maskWidth = 100, maskHeight = 100, maskPoints } = mask;
  if (!maskType || maskType === "none") return undefined;
  if (maskType === "rect") {
    const hw = maskWidth / 2, hh = maskHeight / 2;
    const top = Math.max(0, maskY - hh);
    const right = Math.max(0, 100 - (maskX + hw));
    const bottom = Math.max(0, 100 - (maskY + hh));
    const left = Math.max(0, maskX - hw);
    return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
  }
  if (maskType === "circle") {
    return `circle(${Math.min(maskWidth, maskHeight) / 2}% at ${maskX}% ${maskY}%)`;
  }
  if (maskType === "polygon" && maskPoints && maskPoints.length >= 3) {
    return `polygon(${maskPoints.map((p) => `${p.x}% ${p.y}%`).join(", ")})`;
  }
  return undefined;
}

/** Returns the CSS clip-path for the active hypno-tunnel effect's fxMask, if set. */
export function computeTunnelClipPath(activeEffectClips: ClipEvent[]): string | undefined {
  for (const c of activeEffectClips) {
    if (c.fxParams?.effectDisabled) continue;
    if (String(c.fxParams?.effectType) !== "hypno-tunnel") continue;
    const mask = c.fxParams?.fxMask as FxMaskShape | undefined;
    if (!mask?.maskType || mask.maskType === "none") return undefined;
    return buildMaskedFxClipPath(mask);
  }
  return undefined;
}

export const MICROS_PER_SECOND = 1_000_000;

export function formatTimecode(micros: number): string {
  const totalSeconds = micros / MICROS_PER_SECOND;
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// ── Deterministic PRNG for glitch effect ──────────────────
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ── Pan/Crop → CSS transform + clip-path ──────────────────
export function buildPanCropStyle(
  pc: PanCropData | undefined,
  clipId?: string,
): { style: React.CSSProperties; svgMask?: string; useFeatheredMask?: boolean } {
  if (!pc) return { style: {} };
  const s = pc.scale ?? 1;
  const transform = `translate(${pc.x ?? 0}%, ${pc.y ?? 0}%) scale(${s}) rotate(${pc.rotation ?? 0}deg)`;
  const feather = pc.maskFeather ?? 0;

  // When feather > 0, skip clipPath — caller will generate SVG mask
  if (feather > 0 && pc.maskType && pc.maskType !== "none") {
    const featherMaskId = `feather-mask-${clipId}`;
    return {
      style: { transform, mask: `url(#${featherMaskId})` },
      useFeatheredMask: true,
    };
  }

  let clipPath: string | undefined;
  let svgMask: string | undefined;
  const invert = pc.maskInvert ?? false;

  if (pc.maskType === "rect") {
    const mx = pc.maskX ?? 50, my = pc.maskY ?? 50;
    const mw = (pc.maskWidth ?? 100) / 2, mh = (pc.maskHeight ?? 100) / 2;
    const top = Math.max(0, my - mh);
    const right = Math.max(0, 100 - (mx + mw));
    const bottom = Math.max(0, 100 - (my + mh));
    const left = Math.max(0, mx - mw);
    if (invert) {
      const l = left, t = top, r = 100 - right, b = 100 - bottom;
      clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, ${l}% ${t}%, ${r}% ${t}%, ${r}% ${b}%, ${l}% ${b}%)`;
    } else {
      clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
    }
  } else if (pc.maskType === "circle") {
    const radius = Math.min(pc.maskWidth ?? 100, pc.maskHeight ?? 100) / 2;
    if (invert && clipId) {
      svgMask = `mask-inv-${clipId}`;
    } else {
      clipPath = `circle(${radius}% at ${pc.maskX ?? 50}% ${pc.maskY ?? 50}%)`;
    }
  } else if (pc.maskType === "polygon") {
    // Collect all valid polygon parts: the active drawing polygon + every stored layer.
    // Condition is intentionally NOT gated on maskPoints.length — after "Save & New",
    // maskPoints is [] but masks[] still holds all saved polygons.
    const validPrimary = pc.maskPoints && pc.maskPoints.length >= 3;
    const validLayers = (pc.masks ?? []).filter((m) => m.points.length >= 3);

    if (validPrimary || validLayers.length > 0) {
      const allPolygonParts: string[] = [];
      if (validPrimary) {
        allPolygonParts.push(pc.maskPoints!.map((p) => `${p.x}% ${p.y}%`).join(", "));
      }
      for (const m of validLayers) {
        allPolygonParts.push(m.points.map((p) => `${p.x}% ${p.y}%`).join(", "));
      }

      const hasSubtract = validLayers.some((m) => m.type === "subtract");
      if (invert || hasSubtract) {
        // evenodd rule: overlapping subtract polygons punch holes into add regions
        clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, ${allPolygonParts.join(", ")})`;
      } else {
        clipPath = `polygon(${allPolygonParts.join(", ")})`;
      }
    }
  }

  const style: React.CSSProperties = { transform };
  if (clipPath) style.clipPath = clipPath;
  if (svgMask) style.mask = `url(#${svgMask})`;

  return { style, svgMask };
}

// ── CSS Filter FX Engine (cumulative shader stack) ────────
export interface FxResult {
  filter: string;
  glitchTransform?: string;
  pixelateId?: string;
  chromaticId?: string;
  mirrorTransform?: string;
  hypnoTunnel?: { spacing: number; width: number; opacity: number; rotation: number };
}

export function buildFxFilter(clips: ClipEvent[], playheadPosition: number): FxResult {
  const filters: string[] = [];
  let glitchTransform: string | undefined;
  let pixelateId: string | undefined;
  let chromaticId: string | undefined;
  let mirrorTransform: string | undefined;
  let hypnoTunnel: FxResult["hypnoTunnel"];

  for (const c of clips) {
    if (c.fxParams?.effectDisabled) continue;
    const effectType = String(c.fxParams?.effectType ?? "none");
    const rawIntensity = Number(c.fxParams?.intensity ?? 50) / 100;
    const levelScale = (c.level ?? 100) / 100;
    const intensity = rawIntensity * levelScale;
    const speed = Number(c.fxParams?.speed ?? 50);

    // ── Color Correction (always applied per FX clip) ──
    const brightness = Number(c.fxParams?.brightness ?? 100);
    const contrast = Number(c.fxParams?.contrast ?? 100);
    const saturate = Number(c.fxParams?.saturate ?? 100);
    const hueRotate = Number(c.fxParams?.hueRotate ?? 0);

    if (brightness !== 100) filters.push(`brightness(${(brightness / 100) * levelScale + (1 - levelScale)})`);
    if (contrast !== 100) filters.push(`contrast(${(contrast / 100) * levelScale + (1 - levelScale)})`);
    if (saturate !== 100) filters.push(`saturate(${(saturate / 100) * levelScale + (1 - levelScale)})`);
    if (hueRotate !== 0) filters.push(`hue-rotate(${hueRotate * levelScale}deg)`);

    switch (effectType) {
      case "invert":
        filters.push(`invert(${intensity})`);
        break;

      case "strobe": {
        const hz = speed / 10;
        const periodMicros = Math.round(MICROS_PER_SECOND / hz);
        const dutyCycle = Number(c.fxParams?.strobeDutyCycle ?? 50);
        const onDuration = Math.floor(periodMicros * (dutyCycle / 100));
        const elapsed = playheadPosition - c.startTime;
        const isBlack = (elapsed % periodMicros) >= onDuration;
        filters.push(isBlack ? "brightness(0)" : `brightness(${1 + intensity * 2})`);
        break;
      }

      case "flash": {
        const progress = Math.max(0, (playheadPosition - c.startTime) / c.duration);
        const flashIntensity = 1 + intensity * Math.exp(-progress * speed);
        filters.push(`brightness(${flashIntensity})`);
        break;
      }

      case "blur": {
        const blurPx = Number(c.fxParams?.blurAmount ?? 0) * levelScale;
        if (blurPx > 0) filters.push(`blur(${blurPx}px)`);
        break;
      }

      case "hue-rotate": {
        const elapsed = (playheadPosition - c.startTime) / MICROS_PER_SECOND;
        const degreesPerSec = speed * 3.6;
        const degrees = (elapsed * degreesPerSec * intensity) % 360;
        filters.push(`hue-rotate(${degrees}deg)`);
        break;
      }

      case "chromatic-aberration": {
        const offset = Number(c.fxParams?.caOffset ?? 3) * levelScale;
        if (offset > 0) chromaticId = `ca-${c.id}`;
        break;
      }

      case "pixelate": {
        // ID for the SVG filter generated by collectSvgDefs / buildPixelateFilter
        pixelateId = `pix-${c.id}`;
        break;
      }

      case "glitch": {
        const d = Number(c.fxParams?.displacement ?? 30) * levelScale;
        const seed = Math.floor((playheadPosition - c.startTime) / 50_000);
        const shift = (pseudoRandom(seed) - 0.5) * d * 2;
        glitchTransform = `translateX(${shift}px)`;
        const flicker = pseudoRandom(seed + 1) > 0.7 ? 0.8 : 1;
        if (flicker !== 1) filters.push(`brightness(${flicker})`);
        break;
      }

      case "mirror": {
        const mode = String(c.fxParams?.mirrorMode ?? "horizontal");
        if (mode === "none") break;
        else if (mode === "vertical") mirrorTransform = "scaleY(-1)";
        else if (mode === "both") mirrorTransform = "scale(-1, -1)";
        else mirrorTransform = "scaleX(-1)";
        break;
      }

      case "hypno-tunnel": {
        const elapsed = (playheadPosition - c.startTime) / MICROS_PER_SECOND;
        const tSpeed = Number(c.fxParams?.tunnelSpeed ?? speed);
        const tCount = Number(c.fxParams?.tunnelCount ?? 10);
        const tOpacity = Number(c.fxParams?.tunnelOpacity ?? 50) / 100 * levelScale;
        const tRotation = Number(c.fxParams?.tunnelRotation ?? 0);
        const baseSpacing = Math.max(5, 200 / tCount);
        const spacing = baseSpacing + Math.sin(elapsed * tSpeed * 0.1) * (baseSpacing * 0.4);
        const ringWidth = Math.max(1, baseSpacing * 0.3 * intensity);
        hypnoTunnel = { spacing, width: ringWidth, opacity: tOpacity, rotation: tRotation + elapsed * tSpeed * 2 };
        break;
      }
    }
  }

  return {
    filter: filters.length > 0 ? filters.join(" ") : "none",
    glitchTransform,
    pixelateId,
    chromaticId,
    mirrorTransform,
    hypnoTunnel,
  };
}

// ── Video clip direct FX (B/C/S/HR + B&W/Sepia) ──────────
export function buildVideoClipFilter(clip: ClipEvent | undefined): string {
  if (!clip?.fxParams) return "";
  const filters: string[] = [];
  const b = Number(clip.fxParams.brightness ?? 100);
  const c = Number(clip.fxParams.contrast ?? 100);
  const s = Number(clip.fxParams.saturate ?? 100);
  const hr = Number(clip.fxParams.hueRotate ?? 0);
  if (b !== 100) filters.push(`brightness(${b / 100})`);
  if (c !== 100) filters.push(`contrast(${c / 100})`);
  if (s !== 100) filters.push(`saturate(${s / 100})`);
  if (hr !== 0) filters.push(`hue-rotate(${hr}deg)`);
  if (clip.fxParams.bwEnabled) filters.push("grayscale(1)");
  if (clip.fxParams.sepiaEnabled) filters.push("sepia(1)");
  return filters.join(" ");
}

// ── Text style builder ────────────────────────────────────
export function buildTextStyle(tc: ClipEvent, playheadPosition: number) {
  const content = tc.fxParams?.content as string | undefined;
  if (!content) return null;

  const x = Number(tc.fxParams?.x ?? 50);
  const y = Number(tc.fxParams?.y ?? 50);
  const fontSize = Number(tc.fxParams?.fontSize ?? 48);
  const color = String(tc.fxParams?.color ?? "#ffffff");
  const revealType = String(tc.fxParams?.revealType ?? "none");
  const glow = Number(tc.fxParams?.glow ?? 0);
  const glowColor = String(tc.fxParams?.glowColor ?? color);
  const glowRadius = Number(tc.fxParams?.glowRadius ?? glow);
  const outline = Number(tc.fxParams?.outline ?? 0);
  const outlineColor = String(tc.fxParams?.outlineColor ?? "#000000");
  const shadow = Number(tc.fxParams?.shadow ?? 0);
  const shadowColor = String(tc.fxParams?.shadowColor ?? "#000000");
  const shadowRadius = Number(tc.fxParams?.shadowRadius ?? shadow * 2);
  const textBlur = Number(tc.fxParams?.textBlur ?? 0);

  let displayText = content;
  if (revealType === "typewriter") {
    const typewriterSpeed = Number(tc.fxParams?.typewriterSpeed ?? 10);
    const elapsedHundredths = (playheadPosition - tc.startTime) / 100_000;
    const visibleChars = Math.floor(elapsedHundredths * (typewriterSpeed / 10));
    displayText = content.substring(0, Math.min(visibleChars, content.length));
  }

  const textShadows: string[] = ["0 2px 8px rgba(0,0,0,0.8)"];
  if (glow > 0) {
    textShadows.push(`0 0 ${glowRadius}px ${glowColor}`, `0 0 ${glowRadius * 2}px ${glowColor}80`);
  }
  if (shadow > 0) {
    textShadows.push(`${shadow}px ${shadow}px ${shadowRadius}px ${shadowColor}`);
  }

  const style: React.CSSProperties = {
    position: "absolute",
    left: `${x}%`,
    top: `${y}%`,
    transform: "translate(-50%, -50%)",
    fontSize: `${fontSize}px`,
    color,
    fontWeight: "bold",
    textShadow: textShadows.join(", "),
    textAlign: "center",
    maxWidth: "90%",
    whiteSpace: "nowrap",
  };

  if (outline > 0) {
    style.WebkitTextStroke = `${outline}px ${outlineColor}`;
    style.paintOrder = "stroke fill";
  }

  if (textBlur > 0) {
    style.filter = `blur(${textBlur}px)`;
  }

  return { displayText, style };
}
