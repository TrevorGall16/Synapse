"use client";

import { useRef, useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent, PanCropData, MaskLayer } from "@/lib/store/types";

const DEFAULT_PC: PanCropData = { x: 0, y: 0, scale: 1, rotation: 0 };

function isInsidePolygon(px: number, py: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function PanCropWindow() {
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const tracks = useProjectStore((s) => s.tracks);
  const updateClipPanCrop = useProjectStore((s) => s.updateClipPanCrop);
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [draggingVertex, setDraggingVertex] = useState<number | null>(null);
  const [isDraggingMask, setIsDraggingMask] = useState(false);
  const maskDragStart = useRef({ x: 0, y: 0 });

  let clip: ClipEvent | undefined;
  if (inspectingClipId) {
    for (const t of tracks) {
      const found = t.clips.find((c) => c.id === inspectingClipId);
      if (found) { clip = found; break; }
    }
  }

  if (!clip) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#1a1a1a] p-4">
        <span className="text-xs text-white/30">Select a video clip to edit Pan/Crop</span>
      </div>
    );
  }

  const pc = clip.panCrop ?? DEFAULT_PC;
  const onPC = (updates: Partial<PanCropData>) => updateClipPanCrop(clip!.id, updates);

  const maskType = pc.maskType ?? "none";
  const maskX = pc.maskX ?? 50;
  const maskY = pc.maskY ?? 50;
  const maskW = pc.maskWidth ?? 100;
  const maskH = pc.maskHeight ?? 100;
  const maskPoints = pc.maskPoints ?? [];
  const maskFeather = pc.maskFeather ?? 0;

  // ── Interactive canvas drag for X/Y ──
  const canvasRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, pcX: 0, pcY: 0 });

  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    // Polygon: center-drag when closed, skip when still drawing
    if (maskType === "polygon") {
      if (!polygonClosed) return; // still adding points via onClick
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      // Check if near a vertex (vertex drag handled by SVG circle events)
      const nearVertex = maskPoints.some((p) => Math.hypot(px - p.x, py - p.y) < 5);
      if (!nearVertex && isInsidePolygon(px, py, maskPoints)) {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDraggingMask(true);
        maskDragStart.current = { x: px, y: py };
        return;
      }
      return;
    }
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, pcX: pc.x, pcY: pc.y };
  }, [pc.x, pc.y, maskType, polygonClosed, maskPoints]);

  const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    // Center-drag: move entire polygon mask
    if (isDraggingMask) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      const dx = px - maskDragStart.current.x;
      const dy = py - maskDragStart.current.y;
      const newPoints = maskPoints.map((p) => ({
        x: Math.max(0, Math.min(100, p.x + dx)),
        y: Math.max(0, Math.min(100, p.y + dy)),
      }));
      onPC({ maskPoints: newPoints });
      maskDragStart.current = { x: px, y: py };
      return;
    }
    if (!isDragging.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((e.clientX - dragStart.current.x) / rect.width) * 200;
    const dy = ((e.clientY - dragStart.current.y) / rect.height) * 200;
    onPC({
      x: Math.round(Math.max(-100, Math.min(100, dragStart.current.pcX + dx))),
      y: Math.round(Math.max(-100, Math.min(100, dragStart.current.pcY + dy))),
    });
  }, [isDraggingMask, maskPoints]);

  const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    setIsDraggingMask(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (maskType !== "polygon" || polygonClosed) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 10000) / 100;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 10000) / 100;

    // Auto-close: if clicking near the first point with >=3 points
    if (maskPoints.length >= 3) {
      const dist = Math.hypot(x - maskPoints[0].x, y - maskPoints[0].y);
      if (dist < 10) {
        setPolygonClosed(true);
        return;
      }
    }

    onPC({ maskPoints: [...maskPoints, { x, y }] });
  }, [maskType, polygonClosed, maskPoints]);

  const onCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    if (maskType !== "polygon") return;
    e.stopPropagation();
    setPolygonClosed(true);
  }, [maskType]);

  const onVertexPointerDown = useCallback((e: ReactPointerEvent<SVGCircleElement>, index: number) => {
    if (!polygonClosed) return;
    e.stopPropagation();
    e.preventDefault();
    (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
    setDraggingVertex(index);
  }, [polygonClosed]);

  const onVertexPointerMove = useCallback((e: ReactPointerEvent<SVGCircleElement>) => {
    if (draggingVertex === null) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 10000) / 100;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 10000) / 100;
    const newPoints = [...maskPoints];
    newPoints[draggingVertex] = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    onPC({ maskPoints: newPoints });
  }, [draggingVertex, maskPoints]);

  const onVertexPointerUp = useCallback(() => setDraggingVertex(null), []);

  const clearPoints = useCallback(() => { onPC({ maskPoints: [] }); setPolygonClosed(false); setDraggingVertex(null); }, []);

  return (
    <div className="flex h-full min-h-[400px] flex-col bg-[#1a1a1a]">
      <div className="flex items-center border-b border-white/10 px-3 py-2">
        <span className="truncate text-xs font-semibold text-white/80">Pan / Crop / Mask</span>
      </div>

      {/* Interactive 16:9 canvas preview */}
      <div className="px-3 pt-3">
        <div
          ref={canvasRef}
          className={`relative mx-auto aspect-video w-full overflow-hidden rounded border border-white/20 bg-black ${
            maskType === "polygon" && !polygonClosed ? "cursor-crosshair" : "cursor-move"
          }`}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onClick={onCanvasClick}
          onDoubleClick={onCanvasDoubleClick}
        >
          {/* Preview frame rectangle */}
          <div
            className="absolute inset-0 border-2 border-blue-400/60 bg-blue-400/10"
            style={{
              transform: `translate(${pc.x}%, ${pc.y}%) scale(${pc.scale}) rotate(${pc.rotation}deg)`,
              transformOrigin: "center center",
            }}
          />
          {/* Mask overlay preview */}
          {maskType === "circle" && (
            <div
              className="absolute border-2 border-yellow-400/60 rounded-full pointer-events-none"
              style={{
                left: `${maskX - Math.min(maskW, maskH) / 2}%`,
                top: `${maskY - Math.min(maskW, maskH) / 2}%`,
                width: `${Math.min(maskW, maskH)}%`,
                height: `${Math.min(maskW, maskH)}%`,
              }}
            />
          )}
          {maskType === "rect" && (
            <div
              className="absolute border-2 border-yellow-400/60 pointer-events-none"
              style={{
                left: `${maskX - maskW / 2}%`,
                top: `${maskY - maskH / 2}%`,
                width: `${maskW}%`,
                height: `${maskH}%`,
              }}
            />
          )}
          {/* Polygon SVG overlay — uses viewBox so point coords map to percentages */}
          {maskType === "polygon" && maskPoints.length > 0 && (
            <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }} viewBox="0 0 100 100" preserveAspectRatio="none">
              {/* Lines connecting points */}
              {maskPoints.length > 1 && (
                <polyline
                  points={maskPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={polygonClosed && maskPoints.length > 2 ? "rgba(0,229,255,0.1)" : "none"}
                  stroke="#00e5ff"
                  strokeWidth="0.5"
                  strokeOpacity="0.8"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* Closing line when shape is closed */}
              {polygonClosed && maskPoints.length > 2 && (
                <line
                  x1={maskPoints[maskPoints.length - 1].x}
                  y1={maskPoints[maskPoints.length - 1].y}
                  x2={maskPoints[0].x}
                  y2={maskPoints[0].y}
                  stroke="#00e5ff"
                  strokeWidth="0.5"
                  strokeOpacity="0.8"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* Point circles — interactive when polygon is closed */}
              {maskPoints.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r="1.5"
                  fill={draggingVertex === i ? "#fff" : "#facc15"}
                  fillOpacity="0.9"
                  style={{ pointerEvents: polygonClosed ? "auto" : "none", cursor: polygonClosed ? (draggingVertex === i ? "grabbing" : "grab") : "default" }}
                  onPointerDown={(e) => onVertexPointerDown(e, i)}
                  onPointerMove={onVertexPointerMove}
                  onPointerUp={onVertexPointerUp}
                />
              ))}
            </svg>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto p-3" onPointerDown={(e) => e.stopPropagation()}>
        <SliderField label="X Offset" value={pc.x} min={-100} max={100} onChange={(v) => onPC({ x: v })} />
        <SliderField label="Y Offset" value={pc.y} min={-100} max={100} onChange={(v) => onPC({ y: v })} />
        <SliderField
          label={`Scale ${Math.round((pc.scale ?? 1) * 100)}%`}
          value={Math.round((pc.scale ?? 1) * 100)}
          min={10} max={500}
          onChange={(v) => onPC({ scale: v / 100 })}
        />
        <SliderField label="Rotation" value={pc.rotation} min={-360} max={360} onChange={(v) => onPC({ rotation: v })} />

        {/* Reset button */}
        <button
          onClick={() => onPC({ x: 0, y: 0, scale: 1, rotation: 0 })}
          className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/15 hover:text-white"
        >
          Reset Transform
        </button>

        <div className="h-px bg-white/10" />

        {/* Mask controls */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Mask Type</span>
          <select
            value={maskType}
            onChange={(e) => {
              const val = e.target.value as PanCropData["maskType"];
              onPC({ maskType: val });
              if (val !== "polygon") setPolygonClosed(false);
            }}
            className="rounded bg-white/10 px-2 py-1 text-xs text-white outline-none transition-colors hover:bg-white/15"
          >
            <option value="none" className="text-black">None</option>
            <option value="rect" className="text-black">Rectangle</option>
            <option value="circle" className="text-black">Circle</option>
            <option value="polygon" className="text-black">Polygon</option>
          </select>
        </label>

        {maskType !== "none" && maskType !== "polygon" && (
          <>
            <SliderField label="Mask X" value={maskX} min={0} max={100} onChange={(v) => onPC({ maskX: v })} />
            <SliderField label="Mask Y" value={maskY} min={0} max={100} onChange={(v) => onPC({ maskY: v })} />
            <SliderField label="Mask Width" value={maskW} min={1} max={100} onChange={(v) => onPC({ maskWidth: v })} />
            <SliderField label="Mask Height" value={maskH} min={1} max={100} onChange={(v) => onPC({ maskHeight: v })} />
          </>
        )}

        {maskType === "polygon" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/50">
                {polygonClosed
                  ? `${maskPoints.length} points (closed) — drag vertices or drag inside to move`
                  : `${maskPoints.length} points — click to add, click near start to close`}
              </span>
            </div>
            <button
              onClick={clearPoints}
              className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/15 hover:text-white"
            >
              Clear Points
            </button>
          </>
        )}

        {/* Mask Feather / Blur — shown for any active mask */}
        {maskType !== "none" && (
          <>
            <SliderField
              label="Mask Blur"
              value={maskFeather}
              min={0}
              max={50}
              onChange={(v) => onPC({ maskFeather: v })}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={pc.maskInvert ?? false}
                onChange={(e) => onPC({ maskInvert: e.target.checked })}
                className="h-3 w-3 cursor-pointer"
              />
              <span className="text-[10px] font-medium text-white/50">Invert Mask</span>
            </label>
          </>
        )}

        {/* Multi-Mask Layers */}
        {maskType === "polygon" && (
          <>
            <div className="h-px bg-white/10" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Mask Layers</span>
              <button onClick={() => onPC({ masks: [...(pc.masks ?? []), { id: crypto.randomUUID(), points: [], type: "add" as const }] })} className="rounded bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white/50 hover:bg-white/15 hover:text-white">+ New Mask</button>
            </div>
            {(pc.masks ?? []).map((m, i) => (
              <div key={m.id} className="flex items-center gap-1 text-[9px] text-white/40">
                <span className="flex-1 truncate">Layer {i + 1} ({m.points.length} pts)</span>
                <select value={m.type} onChange={(e) => { const ms = [...(pc.masks ?? [])]; ms[i] = { ...m, type: e.target.value as "add" | "subtract" }; onPC({ masks: ms }); }} className="rounded bg-white/10 px-1 py-0.5 text-[8px] text-white outline-none">
                  <option value="add" className="text-black">Add</option>
                  <option value="subtract" className="text-black">Subtract</option>
                </select>
                <button onClick={() => onPC({ masks: (pc.masks ?? []).filter((_, j) => j !== i) })} className="rounded px-1 py-0.5 text-red-400/60 hover:text-red-400">×</button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SliderField({
  label, value, min = 0, max = 100, onChange,
}: {
  label: string; value: number; min?: number; max?: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">{label}</span>
        <span className="text-[10px] tabular-nums text-white/40">{value}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer"
      />
    </label>
  );
}
