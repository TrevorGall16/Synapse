"use client";

import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent } from "@/lib/store/types";

export function FxInspector() {
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const tracks = useProjectStore((s) => s.tracks);
  const updateClipFxParams = useProjectStore((s) => s.updateClipFxParams);
  const fxMaskEditingClipId = useProjectStore((s) => s.fxMaskEditingClipId);
  const setFxMaskEditingClipId = useProjectStore((s) => s.setFxMaskEditingClipId);

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
        <span className="text-xs text-white/30">Select an effect clip to inspect</span>
      </div>
    );
  }

  const onParam = (key: string, value: unknown) => updateClipFxParams(clip!.id, { [key]: value });

  const effectType = String(clip.fxParams?.effectType ?? "none");
  const intensity = Number(clip.fxParams?.intensity ?? 50);
  const speed = Number(clip.fxParams?.speed ?? 50);
  const brightness = Number(clip.fxParams?.brightness ?? 100);
  const contrast = Number(clip.fxParams?.contrast ?? 100);
  const saturate = Number(clip.fxParams?.saturate ?? 100);
  const hueRotate = Number(clip.fxParams?.hueRotate ?? 0);
  const blurAmount = Number(clip.fxParams?.blurAmount ?? 0);

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      <div className="flex items-center border-b border-white/10 px-3 py-2">
        <span className="truncate text-xs font-semibold text-white/80">Effect Clip</span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3" onPointerDown={(e) => e.stopPropagation()}>
        {/* Effect Type */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Effect Type</span>
          <select
            value={effectType}
            onChange={(e) => onParam("effectType", e.target.value)}
            className="rounded bg-white/10 px-2 py-1 text-xs text-white outline-none transition-colors hover:bg-white/15"
          >
            <option value="none" className="text-black">None</option>
            <option value="strobe" className="text-black">Strobe</option>
            <option value="invert" className="text-black">Invert</option>
            <option value="flash" className="text-black">Flash</option>
            <option value="blur" className="text-black">Blur</option>
            <option value="hue-rotate" className="text-black">Hue Rotate</option>
            <option value="glitch" className="text-black">Glitch</option>
            <option value="pixelate" className="text-black">Pixelate</option>
            <option value="chromatic-aberration" className="text-black">Chromatic Aberration</option>
            <option value="mirror" className="text-black">Mirror</option>
            <option value="hypno-tunnel" className="text-black">Hypno Tunnel</option>
          </select>
        </label>

        {effectType !== "mirror" && effectType !== "hypno-tunnel" && (
          <SliderField label="Intensity" value={intensity} onChange={(v) => onParam("intensity", v)} />
        )}
        {["strobe", "flash", "hue-rotate", "glitch", "hypno-tunnel"].includes(effectType) && (
          <SliderField label="Speed" value={speed} onChange={(v) => onParam("speed", v)} />
        )}

        {/* Strobe duty cycle */}
        {effectType === "strobe" && (
          <SliderField
            label="Duty Cycle"
            value={Number(clip.fxParams?.strobeDutyCycle ?? 50)}
            min={0} max={100}
            onChange={(v) => onParam("strobeDutyCycle", v)}
          />
        )}

        {/* Flash decay rate */}
        {effectType === "flash" && (
          <SliderField
            label="Decay Rate"
            value={Number(clip.fxParams?.flashDecayRate ?? 2)}
            min={1} max={5}
            onChange={(v) => onParam("flashDecayRate", v)}
          />
        )}

        {/* Blur controls */}
        {effectType === "blur" && (
          <SliderField label="Blur Amount" value={blurAmount} min={0} max={50} onChange={(v) => onParam("blurAmount", v)} />
        )}

        {/* Glitch controls */}
        {effectType === "glitch" && (
          <SliderField label="Displacement" value={Number(clip.fxParams?.displacement ?? 30)} min={0} max={100} onChange={(v) => onParam("displacement", v)} />
        )}

        {/* Pixelate controls */}
        {effectType === "pixelate" && (
          <SliderField label="Block Size" value={Number(clip.fxParams?.blockSize ?? 8)} min={1} max={64} onChange={(v) => onParam("blockSize", v)} />
        )}

        {/* Chromatic Aberration controls */}
        {effectType === "chromatic-aberration" && (
          <SliderField label="CA Offset" value={Number(clip.fxParams?.caOffset ?? 3)} min={1} max={20} onChange={(v) => onParam("caOffset", v)} />
        )}

        {/* Mirror controls — 4-way toggle */}
        {effectType === "mirror" && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">Mirror Mode</span>
            <div className="flex gap-1">
              {(["none", "horizontal", "vertical", "both"] as const).map((mode) => {
                const label = mode === "none" ? "Off" : mode === "horizontal" ? "H" : mode === "vertical" ? "V" : "Both";
                const active = String(clip.fxParams?.mirrorMode ?? "horizontal") === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => onParam("mirrorMode", mode)}
                    className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                      active ? "bg-white/20 text-white" : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Hypno-Tunnel controls */}
        {effectType === "hypno-tunnel" && (
          <>
            <SliderField label="Tunnel Opacity" value={Number(clip.fxParams?.tunnelOpacity ?? 50)} min={0} max={100} onChange={(v) => onParam("tunnelOpacity", v)} />
            <SliderField label="Ring Count" value={Number(clip.fxParams?.tunnelCount ?? 10)} min={1} max={50} onChange={(v) => onParam("tunnelCount", v)} />
            <SliderField label="Tunnel Speed" value={Number(clip.fxParams?.tunnelSpeed ?? 50)} min={1} max={100} onChange={(v) => onParam("tunnelSpeed", v)} />
            <SliderField label="Rotation" value={Number(clip.fxParams?.tunnelRotation ?? 0)} min={0} max={360} onChange={(v) => onParam("tunnelRotation", v)} />
          </>
        )}

        {/* Active effects stack */}
        {effectType !== "none" && (
          <div className="flex flex-wrap items-center gap-1">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={!clip.fxParams?.effectDisabled}
                onChange={() => onParam("effectDisabled", !clip.fxParams?.effectDisabled)}
                className="h-3 w-3 accent-purple-400"
              />
              <span className={`rounded-full bg-purple-500/20 px-2 py-0.5 text-[9px] font-medium text-purple-300 ${clip.fxParams?.effectDisabled ? "opacity-40 line-through" : ""}`}>
                {effectType}
              </span>
            </label>
            {brightness !== 100 && (
              <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[9px] text-yellow-300">
                Brightness: {brightness}
              </span>
            )}
            {contrast !== 100 && (
              <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[9px] text-blue-300">
                Contrast: {contrast}
              </span>
            )}
            {saturate !== 100 && (
              <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[9px] text-green-300">
                Saturate: {saturate}
              </span>
            )}
          </div>
        )}

        {/* Mask FX — opens Pan/Crop window in FX mask editing mode */}
        {effectType !== "none" && (
          <button
            onClick={() => setFxMaskEditingClipId(
              fxMaskEditingClipId === clip!.id ? null : clip!.id
            )}
            className={`w-full rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              fxMaskEditingClipId === clip!.id
                ? "bg-purple-500/30 text-purple-200 ring-1 ring-purple-400/50"
                : "bg-white/10 text-white/50 hover:bg-white/15 hover:text-white"
            }`}
          >
            {fxMaskEditingClipId === clip!.id ? "✦ Editing FX Mask" : "Mask FX Area"}
          </button>
        )}

        {/* Reset buttons */}
        <div className="flex gap-1">
          <button
            onClick={() => updateClipFxParams(clip!.id, { effectType: "none", intensity: 50, speed: 50 })}
            className="flex-1 rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/15 hover:text-white"
          >
            Reset Effect
          </button>
          <button
            onClick={() => updateClipFxParams(clip!.id, { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 })}
            className="flex-1 rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/15 hover:text-white"
          >
            Reset Colors
          </button>
        </div>

        <div className="h-px bg-white/10" />

        {/* Color Correction */}
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Color Correction</span>
        <SliderField label="Brightness" value={brightness} min={0} max={200} onChange={(v) => onParam("brightness", v)} />
        <SliderField label="Contrast" value={contrast} min={0} max={200} onChange={(v) => onParam("contrast", v)} />
        <SliderField label="Saturate" value={saturate} min={0} max={200} onChange={(v) => onParam("saturate", v)} />
        <SliderField label="Hue Rotate" value={hueRotate} min={0} max={360} onChange={(v) => onParam("hueRotate", v)} />
      </div>
    </div>
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
