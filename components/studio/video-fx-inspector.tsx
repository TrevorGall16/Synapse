"use client";

import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent } from "@/lib/store/types";

export function VideoFxInspector() {
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const tracks = useProjectStore((s) => s.tracks);
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
        <span className="text-xs text-white/30">Select a video clip to edit FX</span>
      </div>
    );
  }

  const onParam = (key: string, value: unknown) => updateClipFxParams(clip!.id, { [key]: value });

  const brightness = Number(clip.fxParams?.brightness ?? 100);
  const contrast = Number(clip.fxParams?.contrast ?? 100);
  const saturate = Number(clip.fxParams?.saturate ?? 100);
  const hueRotate = Number(clip.fxParams?.hueRotate ?? 0);
  const bw = Boolean(clip.fxParams?.bwEnabled);
  const sepia = Boolean(clip.fxParams?.sepiaEnabled);

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      <div className="flex items-center border-b border-white/10 px-3 py-2">
        <span className="truncate text-xs font-semibold text-white/80">Video FX</span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3" onPointerDown={(e) => e.stopPropagation()}>
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Color Grading</span>
        <SliderField label="Brightness" value={brightness} min={0} max={200} onChange={(v) => onParam("brightness", v)} />
        <SliderField label="Contrast" value={contrast} min={0} max={200} onChange={(v) => onParam("contrast", v)} />
        <SliderField label="Saturate" value={saturate} min={0} max={200} onChange={(v) => onParam("saturate", v)} />
        <SliderField label="Hue Rotate" value={hueRotate} min={0} max={360} onChange={(v) => onParam("hueRotate", v)} />

        <div className="h-px bg-white/10" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Quick Looks</span>

        <div className="flex gap-1">
          <button
            onClick={() => { onParam("bwEnabled", !bw); onParam("sepiaEnabled", false); }}
            className={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              bw ? "bg-white/20 text-white" : "bg-white/10 text-white/50 hover:bg-white/15"
            }`}
          >
            B&W
          </button>
          <button
            onClick={() => { onParam("sepiaEnabled", !sepia); onParam("bwEnabled", false); }}
            className={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              sepia ? "bg-amber-500/30 text-amber-200" : "bg-white/10 text-white/50 hover:bg-white/15"
            }`}
          >
            Sepia
          </button>
        </div>

        <button
          onClick={() => {
            onParam("brightness", 100);
            onParam("contrast", 100);
            onParam("saturate", 100);
            onParam("hueRotate", 0);
            onParam("bwEnabled", false);
            onParam("sepiaEnabled", false);
          }}
          className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/15 hover:text-white"
        >
          Reset FX
        </button>
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
