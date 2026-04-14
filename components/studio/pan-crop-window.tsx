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
  // ── Hooks (must run unconditionally, per rules-of-hooks) ─────────────────
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const tracks = useProjectStore((s) => s.tracks);
  const updateClipPanCrop = useProjectStore((s) => s.updateClipPanCrop);
  const fxMaskEditingClipId = useProjectStore((s) => s.fxMaskEditingClipId);
  const setFxMaskEditingClipId = useProjectStore((s) => s.setFxMaskEditingClipId);
  const updateFxMask = useProjectStore((s) => s.updateFxMask);

  const [polygonClosed, setPolygonClosed] = useState(false);
  const [draggingVertex, setDraggingVertex] = useState<number | null>(null);
  const [isDraggingMask, setIsDraggingMask] = useState(false);
  // null = editing the live maskPoints; number = editing masks[N] (click-to-re-edit)
  const [activeMaskLayerIdx, setActiveMaskLayerIdx] = useState<number | null>(null);
  const maskDragStart = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, pcX: 0, pcY: 0 });

  // ── Derived state (no hooks) ─────────────────────────────────────────────
  const isFxMaskMode = !!fxMaskEditingClipId;
  const activeClipId = isFxMaskMode ? fxMaskEditingClipId : inspectingClipId;

  let clip: ClipEvent | undefined;
  if (activeClipId) {
    for (const t of tracks) {
      const found = t.clips.find((c) => c.id === activeClipId);
      if (found) { clip = found; break; }
    }
  }

  const pc: PanCropData = clip
    ? (isFxMaskMode
        ? ((clip.fxParams?.fxMask as PanCropData | undefined) ?? DEFAULT_PC)
        : (clip.panCrop ?? DEFAULT_PC))
    : DEFAULT_PC;

  const onPC = (updates: Partial<PanCropData>) => {
    if (!clip) return;
    return isFxMaskMode ? updateFxMask(clip.id, updates) : updateClipPanCrop(clip.id, updates);
  };

  const maskType = pc.maskType ?? "none";
  const maskX = pc.maskX ?? 50;
  const maskY = pc.maskY ?? 50;
  const maskW = pc.maskWidth ?? 100;
  const maskH = pc.maskHeight ?? 100;
  const maskFeather = pc.maskFeather ?? 0;

  // ── Active editing points: either live maskPoints or a stored layer ──────
  // Reads from the CORRECT source depending on re-edit mode.
  const liveMaskPoints = pc.maskPoints ?? [];
  const activePoints: { x: number; y: number }[] = activeMaskLayerIdx !== null
    ? (pc.masks?.[activeMaskLayerIdx]?.points ?? [])
    : liveMaskPoints;

  // Write back to the correct store field
  const setActivePoints = useCallback((pts: { x: number; y: number }[]) => {
    if (activeMaskLayerIdx !== null) {
      const newMasks = [...(pc.masks ?? [])];
      newMasks[activeMaskLayerIdx] = { ...newMasks[activeMaskLayerIdx], points: pts };
      onPC({ masks: newMasks });
    } else {
      onPC({ maskPoints: pts });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMaskLayerIdx, pc.masks]);

  // Enter re-edit mode for a stored mask layer
  const enterReEdit = (idx: number) => {
    setActiveMaskLayerIdx(idx);
    setPolygonClosed(true); // stored masks are already closed
    setDraggingVertex(null);
    setIsDraggingMask(false);
  };

  // Exit re-edit mode (back to live drawing)
  const exitReEdit = () => {
    setActiveMaskLayerIdx(null);
    setPolygonClosed(false);
    setDraggingVertex(null);
  };

  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (maskType === "polygon") {
      if (!polygonClosed) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      const nearVertex = activePoints.some((p) => {
        const dxPx = ((px - p.x) / 100) * rect.width;
        const dyPx = ((py - p.y) / 100) * rect.height;
        return Math.hypot(dxPx, dyPx) < 15;
      });
      if (!nearVertex && isInsidePolygon(px, py, activePoints)) {
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
  }, [pc.x, pc.y, maskType, polygonClosed, activePoints]);

  const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    if (isDraggingMask) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      const dx = px - maskDragStart.current.x;
      const dy = py - maskDragStart.current.y;
      setActivePoints(activePoints.map((p) => ({
        x: Math.max(0, Math.min(100, p.x + dx)),
        y: Math.max(0, Math.min(100, p.y + dy)),
      })));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingMask, activePoints, setActivePoints]);

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

    if (activePoints.length >= 3) {
      const dist = Math.hypot(x - activePoints[0].x, y - activePoints[0].y);
      if (dist < 10) { setPolygonClosed(true); return; }
    }
    setActivePoints([...activePoints, { x, y }]);
  }, [maskType, polygonClosed, activePoints, setActivePoints]);

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
    const newPts = [...activePoints];
    newPts[draggingVertex] = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    setActivePoints(newPts);
  }, [draggingVertex, activePoints, setActivePoints]);

  const onVertexPointerUp = useCallback(() => setDraggingVertex(null), []);

  const clearPoints = useCallback(() => {
    setActivePoints([]);
    setPolygonClosed(false);
    setDraggingVertex(null);
  }, [setActivePoints]);

  // ── Save & New: atomically save current polygon → masks[], reset drawing ─
  const handleSaveAndNew = () => {
    if (activeMaskLayerIdx !== null) {
      // Already editing a stored layer; just exit re-edit mode to start a new polygon
      exitReEdit();
      return;
    }
    if (polygonClosed && activePoints.length >= 3) {
      // Atomic: save current closed polygon + clear live maskPoints in one store write
      const savedLayer: MaskLayer = { id: crypto.randomUUID(), points: activePoints, type: "add" };
      onPC({ maskPoints: [], masks: [...(pc.masks ?? []), savedLayer] });
      setPolygonClosed(false);
      setDraggingVertex(null);
    } else {
      onPC({ masks: [...(pc.masks ?? []), { id: crypto.randomUUID(), points: [], type: "add" as const }] });
    }
  };

  const saveAndNewLabel = activeMaskLayerIdx !== null
    ? "Done Editing"
    : polygonClosed && activePoints.length >= 3
    ? "Save & New"
    : "+ New Mask";

  // Placeholder render when no clip is selected — all hooks above already ran.
  if (!clip) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#1a1a1a] p-4">
        <span className="text-xs text-white/30">
          {isFxMaskMode ? "FX clip not found" : "Select a video clip to edit Pan/Crop"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[400px] flex-col bg-[#1a1a1a]">
      <div className={`flex items-center gap-2 border-b border-white/10 px-3 py-2 ${isFxMaskMode ? "bg-purple-900/30" : ""}`}>
        {isFxMaskMode ? (
          <>
            <span className="rounded bg-purple-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
              Editing FX Mask
            </span>
            <button onClick={() => setFxMaskEditingClipId(null)}
              className="ml-auto rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-200 transition-colors hover:bg-purple-500/40">
              Done
            </button>
          </>
        ) : (
          <span className="truncate text-xs font-semibold text-white/80">Pan / Crop / Mask</span>
        )}
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
          {/* Pan/Crop preview rectangle */}
          <div
            className="absolute inset-0 border-2 border-blue-400/60 bg-blue-400/10"
            style={{
              transform: `translate(${pc.x}%, ${pc.y}%) scale(${pc.scale}) rotate(${pc.rotation}deg)`,
              transformOrigin: "center center",
            }}
          />

          {/* Simple mask overlays (rect / circle) */}
          {maskType === "circle" && (
            <div className="pointer-events-none absolute border-2 border-yellow-400/60 rounded-full"
              style={{ left: `${maskX - Math.min(maskW, maskH) / 2}%`, top: `${maskY - Math.min(maskW, maskH) / 2}%`, width: `${Math.min(maskW, maskH)}%`, height: `${Math.min(maskW, maskH)}%` }} />
          )}
          {maskType === "rect" && (
            <div className="pointer-events-none absolute border-2 border-yellow-400/60"
              style={{ left: `${maskX - maskW / 2}%`, top: `${maskY - maskH / 2}%`, width: `${maskW}%`, height: `${maskH}%` }} />
          )}

          {/* Ghost outlines: ALL stored masks (non-active ones are dimmed/dashed) */}
          {maskType === "polygon" && (pc.masks ?? []).map((m, i) => {
            if (m.points.length < 3) return null;
            const isActive = i === activeMaskLayerIdx;
            return (
              <svg key={m.id} className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon
                  points={m.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={isActive ? "rgba(250,204,21,0.08)" : m.type === "subtract" ? "rgba(239,68,68,0.05)" : "rgba(255,255,255,0.04)"}
                  stroke={isActive ? "#facc15" : "rgba(255,255,255,0.25)"}
                  strokeWidth={isActive ? "0.6" : "0.4"}
                  strokeDasharray={isActive ? "none" : "2,2"}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            );
          })}

          {/* Active polygon: current drawing or re-editing stored mask */}
          {maskType === "polygon" && activePoints.length > 0 && (
            <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }} viewBox="0 0 100 100" preserveAspectRatio="none">
              {activePoints.length > 1 && (
                <polyline
                  points={activePoints.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={polygonClosed && activePoints.length > 2 ? "rgba(0,229,255,0.12)" : "none"}
                  stroke="#00e5ff" strokeWidth="0.5" strokeOpacity="0.9"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {polygonClosed && activePoints.length > 2 && (
                <line
                  x1={activePoints[activePoints.length - 1].x} y1={activePoints[activePoints.length - 1].y}
                  x2={activePoints[0].x} y2={activePoints[0].y}
                  stroke="#00e5ff" strokeWidth="0.5" strokeOpacity="0.9"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {activePoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="1.5"
                  fill={draggingVertex === i ? "#fff" : "#facc15"} fillOpacity="0.95"
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
        <SliderField label={`Scale ${Math.round((pc.scale ?? 1) * 100)}%`} value={Math.round((pc.scale ?? 1) * 100)} min={10} max={500} onChange={(v) => onPC({ scale: v / 100 })} />
        <SliderField label="Rotation" value={pc.rotation} min={-360} max={360} onChange={(v) => onPC({ rotation: v })} />
        <button onClick={() => onPC({ x: 0, y: 0, scale: 1, rotation: 0 })}
          className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/15 hover:text-white">
          Reset Transform
        </button>

        <div className="h-px bg-white/10" />

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Mask Type</span>
          <select value={maskType} onChange={(e) => { onPC({ maskType: e.target.value as PanCropData["maskType"] }); if (e.target.value !== "polygon") { setPolygonClosed(false); exitReEdit(); } }}
            className="rounded bg-white/10 px-2 py-1 text-xs text-white outline-none transition-colors hover:bg-white/15">
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
            <div className="text-[10px] text-white/40">
              {activeMaskLayerIdx !== null
                ? `Re-editing Layer ${activeMaskLayerIdx + 1} — drag vertices or drag inside to move`
                : polygonClosed
                ? `${activePoints.length} pts (closed) — drag vertices or drag inside`
                : `${activePoints.length} pts — click to add, click near start to close`}
            </div>
            <button onClick={clearPoints}
              className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/15 hover:text-white">
              Clear Points
            </button>
          </>
        )}

        {maskType !== "none" && (
          <>
            <SliderField label="Mask Blur" value={maskFeather} min={0} max={50} onChange={(v) => onPC({ maskFeather: v })} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={pc.maskInvert ?? false} onChange={(e) => onPC({ maskInvert: e.target.checked })} className="h-3 w-3 cursor-pointer" />
              <span className="text-[10px] font-medium text-white/50">Invert Mask</span>
            </label>
          </>
        )}

        {/* Multi-Mask Layers — polygon mode only */}
        {maskType === "polygon" && (
          <>
            <div className="h-px bg-white/10" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Mask Layers</span>
              <button onClick={handleSaveAndNew}
                className="rounded bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white/50 hover:bg-white/15 hover:text-white">
                {saveAndNewLabel}
              </button>
            </div>

            {/* Live drawing as a "layer 0" indicator when it has points */}
            {activeMaskLayerIdx === null && activePoints.length >= 3 && (
              <div className="flex items-center gap-1 rounded border border-cyan-400/30 bg-cyan-400/5 px-2 py-1 text-[9px] text-cyan-300">
                <span className="flex-1">Active Drawing · {activePoints.length} pts</span>
                <span className="rounded bg-cyan-400/20 px-1 py-0.5 text-[8px] font-bold uppercase">Live</span>
              </div>
            )}

            {(pc.masks ?? []).map((m, i) => {
              const isActive = i === activeMaskLayerIdx;
              return (
                <div key={m.id}
                  className={`flex items-center gap-1 rounded border px-2 py-1 text-[9px] transition-colors ${
                    isActive
                      ? "border-yellow-400/40 bg-yellow-400/8 text-yellow-200"
                      : "border-white/10 bg-white/5 text-white/50 hover:border-white/20"
                  }`}
                >
                  {/* Click to enter re-edit mode */}
                  <button
                    onClick={() => isActive ? exitReEdit() : enterReEdit(i)}
                    className="flex flex-1 items-center gap-1.5 truncate text-left"
                    title={isActive ? "Click to stop editing" : "Click to re-edit this mask"}
                  >
                    <span className={`font-mono text-[8px] ${isActive ? "text-yellow-300" : "text-white/30"}`}>✎</span>
                    <span className="truncate">Layer {i + 1} · {m.points.length} pts</span>
                    {isActive && <span className="ml-auto shrink-0 rounded bg-yellow-400/20 px-1 py-0.5 text-[8px] font-bold text-yellow-300">Editing</span>}
                  </button>
                  <select value={m.type}
                    onChange={(e) => { const ms = [...(pc.masks ?? [])]; ms[i] = { ...m, type: e.target.value as "add" | "subtract" }; onPC({ masks: ms }); }}
                    className="rounded bg-white/10 px-1 py-0.5 text-[8px] text-white outline-none">
                    <option value="add" className="text-black">Add</option>
                    <option value="subtract" className="text-black">Subtract</option>
                  </select>
                  <button onClick={() => { onPC({ masks: (pc.masks ?? []).filter((_, j) => j !== i) }); if (activeMaskLayerIdx === i) exitReEdit(); }}
                    className="shrink-0 rounded px-1 py-0.5 text-red-400/60 hover:text-red-400">×</button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function SliderField({ label, value, min = 0, max = 100, onChange }: {
  label: string; value: number; min?: number; max?: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">{label}</span>
        <span className="text-[10px] tabular-nums text-white/40">{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer" />
    </label>
  );
}
