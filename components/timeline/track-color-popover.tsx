"use client";

import { useProjectStore } from "@/lib/store/project-store";

interface TrackColorPopoverProps {
  trackId: string;
  onClose: () => void;
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function SliderField({ label, value, min, max, onChange }: SliderFieldProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] text-white/60">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-0.5 flex-1 cursor-pointer"
      />
      <span className="w-7 text-right text-[10px] tabular-nums text-white/50">
        {value}
      </span>
    </div>
  );
}

export function TrackColorPopover({ trackId, onClose }: TrackColorPopoverProps) {
  const track = useProjectStore((s) => s.tracks.find((t) => t.id === trackId));

  if (!track) return null;

  const brightness = track.trackBrightness ?? 100;
  const contrast = track.trackContrast ?? 100;
  const saturate = track.trackSaturate ?? 100;
  const hueRotate = track.trackHueRotate ?? 0;

  const set = (params: Record<string, number>) =>
    useProjectStore.getState().setTrackColorCorrection(trackId, params);

  const handleReset = () =>
    set({ trackBrightness: 100, trackContrast: 100, trackSaturate: 100, trackHueRotate: 0 });

  return (
    <div className="absolute z-50 w-56 rounded border border-white/10 bg-[#252525] p-2 shadow-lg">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium text-white/80">Color Correction</span>
        <button
          onClick={onClose}
          className="text-[10px] text-white/40 hover:text-white/70"
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <SliderField label="Brightness" value={brightness} min={0} max={200}
          onChange={(v) => set({ trackBrightness: v })} />
        <SliderField label="Contrast" value={contrast} min={0} max={200}
          onChange={(v) => set({ trackContrast: v })} />
        <SliderField label="Saturation" value={saturate} min={0} max={200}
          onChange={(v) => set({ trackSaturate: v })} />
        <SliderField label="Hue Rotate" value={hueRotate} min={-180} max={180}
          onChange={(v) => set({ trackHueRotate: v })} />
      </div>

      <button
        onClick={handleReset}
        className="mt-2 w-full rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/50 hover:bg-white/10 hover:text-white/70"
      >
        Reset
      </button>
    </div>
  );
}
