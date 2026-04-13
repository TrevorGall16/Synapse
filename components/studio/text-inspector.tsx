"use client";

import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent } from "@/lib/store/types";

export function TextInspector() {
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const tracks = useProjectStore((s) => s.tracks);
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const updateClipFxParams = useProjectStore((s) => s.updateClipFxParams);

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
        <span className="text-xs text-white/30">Select a text clip to inspect</span>
      </div>
    );
  }

  const media = mediaPool.find((m) => m.id === clip.sourceId);
  const name = media?.name ?? "Text Clip";
  const onParam = (key: string, value: unknown) => updateClipFxParams(clip!.id, { [key]: value }, "merge");

  const content = String(clip.fxParams?.content ?? "");
  const fontSize = Number(clip.fxParams?.fontSize ?? 48);
  const x = Number(clip.fxParams?.x ?? 50);
  const y = Number(clip.fxParams?.y ?? 50);
  const color = String(clip.fxParams?.color ?? "#ffffff");
  const revealType = String(clip.fxParams?.revealType ?? "none");
  const glow = Number(clip.fxParams?.glow ?? 0);
  const glowColor = String(clip.fxParams?.glowColor ?? color);
  const glowRadius = Number(clip.fxParams?.glowRadius ?? glow);
  const outline = Number(clip.fxParams?.outline ?? 0);
  const outlineColor = String(clip.fxParams?.outlineColor ?? "#000000");
  const shadow = Number(clip.fxParams?.shadow ?? 0);
  const shadowColor = String(clip.fxParams?.shadowColor ?? "#000000");
  const shadowRadius = Number(clip.fxParams?.shadowRadius ?? shadow * 2);
  const typewriterSpeed = Number(clip.fxParams?.typewriterSpeed ?? 10);
  const textBlur = Number(clip.fxParams?.textBlur ?? 0);

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      <div className="flex items-center border-b border-white/10 px-3 py-2">
        <span className="truncate text-xs font-semibold text-white/80">{name}</span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3" onPointerDown={(e) => e.stopPropagation()}>
        {/* Content */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Content</span>
          <input
            type="text"
            value={content}
            onChange={(e) => onParam("content", e.target.value)}
            placeholder="Enter text..."
            className="rounded bg-white/10 px-2 py-1 text-xs text-white outline-none transition-colors focus:bg-white/15 focus-visible:ring-1 focus-visible:ring-white/40"
          />
        </label>

        <SliderField label="Font Size" value={fontSize} min={8} max={200} onChange={(v) => onParam("fontSize", v)} />
        <SliderField label="X Position %" value={x} min={0} max={100} onChange={(v) => onParam("x", v)} />
        <SliderField label="Y Position %" value={y} min={0} max={100} onChange={(v) => onParam("y", v)} />

        {/* Color */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Color</span>
          <input
            type="color"
            value={color}
            onChange={(e) => onParam("color", e.target.value)}
            className="h-6 w-full cursor-pointer rounded bg-white/10"
          />
        </label>

        {/* Reveal Type */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Reveal</span>
          <select
            value={revealType}
            onChange={(e) => onParam("revealType", e.target.value)}
            className="rounded bg-white/10 px-2 py-1 text-xs text-white outline-none transition-colors hover:bg-white/15"
          >
            <option value="none" className="text-black">None</option>
            <option value="typewriter" className="text-black">Typewriter</option>
          </select>
        </label>

        {revealType === "typewriter" && (
          <SliderField label="Typewriter Speed" value={typewriterSpeed} min={1} max={100} onChange={(v) => onParam("typewriterSpeed", v)} />
        )}

        <SliderField label="Text Blur" value={textBlur} min={0} max={20} onChange={(v) => onParam("textBlur", v)} />

        <SliderField label="Glow" value={glow} min={0} max={50} onChange={(v) => onParam("glow", v)} />
        {glow > 0 && (
          <>
            <ColorField label="Glow Color" value={glowColor} onChange={(v) => onParam("glowColor", v)} />
            <SliderField label="Glow Radius" value={glowRadius} min={0} max={100} onChange={(v) => onParam("glowRadius", v)} />
          </>
        )}

        <SliderField label="Outline" value={outline} min={0} max={10} onChange={(v) => onParam("outline", v)} />
        {outline > 0 && (
          <ColorField label="Outline Color" value={outlineColor} onChange={(v) => onParam("outlineColor", v)} />
        )}

        <SliderField label="Shadow" value={shadow} min={0} max={20} onChange={(v) => onParam("shadow", v)} />
        {shadow > 0 && (
          <>
            <ColorField label="Shadow Color" value={shadowColor} onChange={(v) => onParam("shadowColor", v)} />
            <SliderField label="Shadow Radius" value={shadowRadius} min={0} max={50} onChange={(v) => onParam("shadowRadius", v)} />
          </>
        )}
      </div>
    </div>
  );
}

function ColorField({
  label, value, onChange,
}: {
  label: string; value: string; onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 pl-3">
      <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">{label}</span>
      <input
        type="color" value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-full cursor-pointer rounded bg-white/10"
      />
    </label>
  );
}

function SliderField({
  label, value, min = 0, max = 100, onChange,
}: {
  label: string; value: number; min?: number; max?: number; onChange: (value: number) => void;
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
