"use client";

import { useRef, useCallback, useState } from "react";
import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent, PanCropData } from "@/lib/store/types";

const DEFAULT_PC: PanCropData = { x: 0, y: 0, scale: 1, rotation: 0 };

export function PanCropWindow() {
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const tracks = useProjectStore((s) => s.tracks);
  const updateClipPanCrop = useProjectStore((s) => s.updateClipPanCrop);
  const [polygonClosed, setPolygonClosed] = useState(false);

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
    if (maskType === "polygon") return; // polygon uses onClick instead
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, pcX: pc.x, pcY: pc.y };
  }, [pc.x, pc.y, maskType]);

  const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((e.clientX - dragStart.current.x) / rect.width) * 200;
    const dy = ((e.clientY - dragStart.current.y) / rect.height) * 200;
    onPC({
      x: Math.round(Math.max(-100, Math.min(100, dragStart.current.pcX + dx))),
      y: Math.round(Math.max(-100, Math.min(100, dragStart.current.pcY + dy))),
    });
  }, []);

  const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onCanvasWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    onPC({ scale: Math.round(Math.max(0.1, Math.min(5, (pc.scale ?? 1) + delta)) * 100) / 100 });
  }, [pc.scale]);

  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    if (maskType !== "polygon" || polygonClosed) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 10000) / 100;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 10000) / 100;
    onPC({ maskPoints: [...maskPoints, { x, y }] });
  }, [maskType, polygonClosed, maskPoints]);

  const onCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    if (maskType !== "polygon") return;
    e.stopPropagation();
    setPolygonClosed(true);
  }, [maskType]);

  const clearPoints = useCallback(() => {
    onPC({ maskPoints: [] });
    setPolygonClosed(false);
  }, []);

  // Build SVG polygon points string
  const svgPointsStr = maskPoints
    .map((p) => `${p.x}%,${p.y}%`)
    .join(" ");

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
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
          onWheel={onCanvasWheel}
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
          {/* Polygon SVG overlay */}
          {maskType === "polygon" && maskPoints.length > 0 && (
            <svg className="absolute inset-0 h-full w-full pointer-events-none">
              {/* Lines connecting points */}
              {maskPoints.length > 1 && (
                <polyline
                  points={maskPoints.map((p) => `${p.x}% ${p.y}%`).join(", ")}
                  fill="none"
                  stroke="#facc15"
                  strokeWidth="1.5"
                  strokeOpacity="0.7"
                />
              )}
              {/* Closing line when shape is closed */}
              {polygonClosed && maskPoints.length > 2 && (
                <line
                  x1={`${maskPoints[maskPoints.length - 1].x}%`}
                  y1={`${maskPoints[maskPoints.length - 1].y}%`}
                  x2={`${maskPoints[0].x}%`}
                  y2={`${maskPoints[0].y}%`}
                  stroke="#facc15"
                  strokeWidth="1.5"
                  strokeOpacity="0.7"
                />
              )}
              {/* Point circles */}
              {maskPoints.map((p, i) => (
                <circle
                  key={i}
                  cx={`${p.x}%`}
                  cy={`${p.y}%`}
                  r="4"
                  fill="#facc15"
                  fillOpacity="0.9"
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
                  ? `${maskPoints.length} points (closed)`
                  : `${maskPoints.length} points — click canvas to add, double-click to close`}
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
          <SliderField
            label="Mask Blur"
            value={maskFeather}
            min={0}
            max={50}
            onChange={(v) => onPC({ maskFeather: v })}
          />
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
