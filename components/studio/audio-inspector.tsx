"use client";

import { useProjectStore } from "@/lib/store/project-store";
import type { ClipEvent, Track } from "@/lib/store/types";

export function AudioInspector() {
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const tracks = useProjectStore((s) => s.tracks);
  const updateClipFxParams = useProjectStore((s) => s.updateClipFxParams);
  const setClipLevel = useProjectStore((s) => s.setClipLevel);
  const setTrackAudioParam = useProjectStore((s) => s.setTrackAudioParam);

  let clip: ClipEvent | undefined;
  let track: Track | undefined;
  if (inspectingClipId) {
    for (const t of tracks) {
      const found = t.clips.find((c) => c.id === inspectingClipId);
      if (found) { clip = found; track = t; break; }
    }
  }

  if (!clip || !track) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#1a1a1a] p-4">
        <span className="text-xs text-white/30">Select an audio clip to inspect</span>
      </div>
    );
  }

  const onParam = (key: string, value: unknown) => updateClipFxParams(clip!.id, { [key]: value });

  const clipLevel = clip.level ?? 100;
  const pitch = Number(clip.fxParams?.pitch ?? 0);
  const fadeIn = Number(clip.fxParams?.fadeInMs ?? 0);
  const fadeOut = Number(clip.fxParams?.fadeOutMs ?? 0);

  // Track-level audio params
  const pan = track.audioPan ?? 0;
  const reverbWet = track.reverbWet ?? 0;
  const reverbRoom = track.reverbRoomSize ?? 30;
  const delayMs = track.delayMs ?? 0;
  const delayFeedback = track.delayFeedback ?? 0;

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      <div className="flex items-center border-b border-white/10 px-3 py-2">
        <span className="truncate text-xs font-semibold text-white/80">Audio Clip</span>
        <span className="ml-auto text-[9px] text-white/30">{track.name}</span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3" onPointerDown={(e) => e.stopPropagation()}>
        {/* Clip-level controls */}
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Clip</span>

        <SliderField
          label="Level"
          value={clipLevel}
          suffix="%"
          onChange={(v) => setClipLevel(clip!.id, v)}
        />

        <SliderField
          label="Pitch (semitones)"
          value={pitch}
          min={-12}
          max={12}
          suffix={pitch > 0 ? `+${pitch}` : `${pitch}`}
          onChange={(v) => onParam("pitch", v)}
        />

        <SliderField
          label="Fade In"
          value={fadeIn}
          min={0}
          max={5000}
          suffix={`${fadeIn}ms`}
          onChange={(v) => onParam("fadeInMs", v)}
        />

        <SliderField
          label="Fade Out"
          value={fadeOut}
          min={0}
          max={5000}
          suffix={`${fadeOut}ms`}
          onChange={(v) => onParam("fadeOutMs", v)}
        />

        <div className="h-px bg-white/10" />

        {/* Track-level audio FX */}
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Track FX</span>

        <SliderField
          label="Pan"
          value={pan}
          min={-100}
          max={100}
          suffix={pan === 0 ? "C" : pan < 0 ? `L${Math.abs(pan)}` : `R${pan}`}
          onChange={(v) => setTrackAudioParam(track!.id, { audioPan: v })}
        />

        <SliderField
          label="Reverb"
          value={reverbWet}
          suffix={`${reverbWet}%`}
          onChange={(v) => setTrackAudioParam(track!.id, { reverbWet: v })}
        />

        {reverbWet > 0 && (
          <SliderField
            label="Room Size"
            value={reverbRoom}
            suffix={`${reverbRoom}%`}
            onChange={(v) => setTrackAudioParam(track!.id, { reverbRoomSize: v })}
          />
        )}

        <SliderField
          label="Delay"
          value={delayMs}
          min={0}
          max={2000}
          suffix={`${delayMs}ms`}
          onChange={(v) => setTrackAudioParam(track!.id, { delayMs: v })}
        />

        {delayMs > 0 && (
          <SliderField
            label="Feedback"
            value={delayFeedback}
            suffix={`${delayFeedback}%`}
            onChange={(v) => setTrackAudioParam(track!.id, { delayFeedback: v })}
          />
        )}

        {/* Reset */}
        <button
          onClick={() => {
            setClipLevel(clip!.id, 100);
            onParam("pitch", 0);
            onParam("fadeInMs", 0);
            onParam("fadeOutMs", 0);
            setTrackAudioParam(track!.id, {
              audioPan: 0,
              reverbWet: 0,
              reverbRoomSize: 30,
              delayMs: 0,
              delayFeedback: 0,
            });
          }}
          className="rounded bg-white/10 px-2 py-1 text-[10px] font-medium text-white/50 transition-colors hover:bg-white/15 hover:text-white"
        >
          Reset All
        </button>
      </div>
    </div>
  );
}

function SliderField({
  label, value, min = 0, max = 100, suffix, onChange,
}: {
  label: string; value: number; min?: number; max?: number; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">{label}</span>
        <span className="text-[10px] tabular-nums text-white/40">{suffix ?? value}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer"
      />
    </label>
  );
}
