"use client";

import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent, TrackType } from "@/lib/store/types";

export function ClipInspector() {
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const tracks = useProjectStore((s) => s.tracks);
  const mediaPool = useProjectStore((s) => s.mediaPool);
  const updateClipFxParams = useProjectStore((s) => s.updateClipFxParams);

  // Find the clip and its track type
  let clip: ClipEvent | undefined;
  let trackType: TrackType | undefined;
  if (inspectingClipId) {
    for (const t of tracks) {
      const found = t.clips.find((c) => c.id === inspectingClipId);
      if (found) {
        clip = found;
        trackType = t.type;
        break;
      }
    }
  }

  if (!clip || !trackType) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#1a1a1a] p-4">
        <span className="text-xs text-white/30">Select a clip to inspect</span>
      </div>
    );
  }

  const media = mediaPool.find((m) => m.id === clip.sourceId);
  const name = media?.name ?? clip.sourceId;

  const onParamChange = (key: string, value: unknown) => {
    updateClipFxParams(clip!.id, { [key]: value });
  };

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      {/* Header */}
      <div className="flex items-center border-b border-white/10 px-3 py-2">
        <span className="truncate text-xs font-semibold text-white/80">{name}</span>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3 p-3">
        {trackType === "effect" && (
          <EffectControls
            intensity={Number(clip.fxParams?.intensity ?? 50)}
            speed={Number(clip.fxParams?.speed ?? 50)}
            onChange={onParamChange}
          />
        )}
        {trackType === "text" && (
          <TextControls
            content={String(clip.fxParams?.content ?? "")}
            onChange={onParamChange}
          />
        )}
      </div>
    </div>
  );
}

function EffectControls({
  intensity,
  speed,
  onChange,
}: {
  intensity: number;
  speed: number;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <SliderField
        label="Intensity"
        value={intensity}
        onChange={(v) => onChange("intensity", v)}
      />
      <SliderField
        label="Speed"
        value={speed}
        onChange={(v) => onChange("speed", v)}
      />
    </>
  );
}

function TextControls({
  content,
  onChange,
}: {
  content: string;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">
        Content
      </span>
      <input
        type="text"
        value={content}
        onChange={(e) => onChange("content", e.target.value)}
        placeholder="Enter text..."
        className="rounded bg-white/10 px-2 py-1 text-xs text-white outline-none transition-colors focus:bg-white/15 focus-visible:ring-1 focus-visible:ring-white/40"
      />
    </label>
  );
}

function SliderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">
          {label}
        </span>
        <span className="text-[10px] tabular-nums text-white/40">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer"
      />
    </label>
  );
}
