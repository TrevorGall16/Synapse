"use client";

import { useRef, useEffect } from "react";
import { useGlobalTick } from "@/lib/hooks/use-global-tick";
import type { ClipEvent, MaskLayer } from "@/lib/store/types";
import { buildMaskedFxClipPath, buildFxFilter, type FxMaskShape } from "@/lib/utils/preview-helpers";
import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";

interface PreviewFxMaskOverlayProps {
  clip: ClipEvent;
  aspectRatio: string;
  zIndex: number;
}

// Typed view of fxMask that includes the multi-mask array
type FxMaskFull = FxMaskShape & { masks?: MaskLayer[] };

/** Draw all polygon mask layers onto an OffscreenCanvas acting as an alpha stencil.
 *  "add" layers are filled solid; "subtract" layers punch holes via destination-out. */
function buildMaskStencil(maskData: FxMaskFull, w: number, h: number): OffscreenCanvas | null {
  const layers: { points: { x: number; y: number }[]; type: "add" | "subtract" }[] = [];

  if (maskData.maskType === "polygon" && maskData.maskPoints && maskData.maskPoints.length >= 3) {
    layers.push({ points: maskData.maskPoints, type: "add" });
  }
  for (const m of maskData.masks ?? []) {
    if (m.points.length >= 3) layers.push({ points: m.points, type: m.type });
  }
  if (layers.length === 0) return null;

  const stencil = new OffscreenCanvas(w, h);
  const sc = stencil.getContext("2d")!;
  sc.clearRect(0, 0, w, h);

  for (const layer of layers) {
    sc.globalCompositeOperation = layer.type === "subtract" ? "destination-out" : "source-over";
    sc.fillStyle = "#ffffff";
    sc.beginPath();
    layer.points.forEach((p, i) => {
      const px = (p.x / 100) * w;
      const py = (p.y / 100) * h;
      i === 0 ? sc.moveTo(px, py) : sc.lineTo(px, py);
    });
    sc.closePath();
    sc.fill();
  }
  sc.globalCompositeOperation = "source-over";
  return stencil;
}

export function PreviewFxMaskOverlay({ clip, aspectRatio, zIndex }: PreviewFxMaskOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectSettings = useProjectStore((s) => s.projectSettings);

  // Derive mask mode BEFORE any early returns so hook call order is stable
  const fxMask = clip.fxParams?.fxMask as FxMaskFull | undefined;
  const isActive = !!fxMask?.maskType && fxMask.maskType !== "none";
  const selfManaged = isActive && (fxMask!.maskType === "polygon" || (fxMask!.masks?.length ?? 0) > 0);
  const simpleCssClipPath = isActive && !selfManaged ? buildMaskedFxClipPath(fxMask!) : undefined;

  // Refs so the GlobalTick callback always reads the latest values without re-registering
  const selfManagedRef = useRef(selfManaged);
  selfManagedRef.current = selfManaged;
  const projectSettingsRef = useRef(projectSettings);
  projectSettingsRef.current = projectSettings;
  const clipIdRef = useRef(clip.id);
  clipIdRef.current = clip.id;

  // Clear canvas when switching away from self-managed mode
  useEffect(() => {
    if (!selfManaged) {
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [selfManaged]);

  // ── Self-managed Canvas 2D via GlobalTicker (polygon + multi-mask path) ──────
  // Always registered — inner guard keeps it a no-op for simple masks.
  useGlobalTick(() => {
    if (!selfManagedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width: projW, height: projH } = projectSettingsRef.current;

    // Resize canvas to project resolution once (% coords map cleanly to whole pixels)
    if (canvas.width !== projW || canvas.height !== projH) {
      canvas.width = projW;
      canvas.height = projH;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const topVideo = document.querySelector<HTMLVideoElement>(
      "[data-preview-container] video:last-of-type"
    );
    if (!topVideo || topVideo.readyState < 2) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // 1. Draw current video frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(topVideo, 0, 0, canvas.width, canvas.height);

    // 2. Read fresh fxMask from store so new points appear without remounting
    const currentClipId = clipIdRef.current;
    const freshClip = (() => {
      for (const t of useProjectStore.getState().tracks) {
        const c = t.clips.find((c) => c.id === currentClipId);
        if (c) return c;
      }
      return null;
    })();
    if (!freshClip) return;
    const freshMask = freshClip.fxParams?.fxMask as FxMaskFull | undefined;

    // 3. Build alpha stencil from all mask layers and composite onto canvas
    const stencil = freshMask ? buildMaskStencil(freshMask, canvas.width, canvas.height) : null;
    if (stencil) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(stencil, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      canvas.style.clipPath = "none"; // pixel compositing handles boundary — no CSS clip-path needed
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height); // no valid mask yet → invisible
    }

    // 4. Apply FX effect as CSS filter to the composited canvas
    const { playheadPosition } = usePlaybackStore.getState();
    const r = buildFxFilter([freshClip], playheadPosition);
    canvas.style.filter = r.filter !== "none" ? r.filter : "none";
  });

  // Early return AFTER all hooks
  if (!isActive) return null;
  if (!selfManaged && !simpleCssClipPath) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      style={{ zIndex }}
    >
      <div className="relative h-full max-w-full overflow-hidden" style={{ aspectRatio }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          // Simple (rect/circle): seed CSS clip-path; preview-monitor's rAF keeps it refreshed.
          // Polygon / multi-mask: self-managed rAF; preview-monitor skips via data-fxmask-self-managed.
          style={!selfManaged && simpleCssClipPath ? { clipPath: simpleCssClipPath } : undefined}
          data-fxmask-canvas=""
          data-fxmask-clipid={clip.id}
          data-fxmask-clippath={!selfManaged ? (simpleCssClipPath ?? "") : ""}
          data-fxmask-self-managed={selfManaged ? "" : undefined}
        />
      </div>
    </div>
  );
}
