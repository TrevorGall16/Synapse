"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { PROJECT_PRESETS, type ProjectSettings } from "@/lib/store/types";

interface ProjectSettingsModalProps {
  onClose: () => void;
}

const FPS_OPTIONS: ProjectSettings["fps"][] = [23.976, 24, 29.97, 30, 60];

export function ProjectSettingsModal({ onClose }: ProjectSettingsModalProps) {
  const current = useProjectStore((s) => s.projectSettings);
  const setProjectSettings = useProjectStore((s) => s.setProjectSettings);
  const [draft, setDraft] = useState<ProjectSettings>({ ...current });

  const applyPreset = (name: keyof typeof PROJECT_PRESETS) => {
    setDraft({ ...PROJECT_PRESETS[name] });
  };

  const onApply = () => {
    setProjectSettings(draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-md rounded-lg border border-white/10 bg-[#1e1e1e] shadow-2xl">
        <button onClick={onClose} className="absolute right-3 top-3 rounded p-1 text-white/40 hover:bg-white/10 hover:text-white" aria-label="Close">
          <X size={14} />
        </button>

        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-semibold text-white/80">Project Settings</h2>
        </div>

        <div className="p-5">
          {/* Presets */}
          <div className="mb-4">
            <span className="mb-2 block text-[10px] font-medium uppercase tracking-wider text-white/40">Quick Presets</span>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(PROJECT_PRESETS) as (keyof typeof PROJECT_PRESETS)[]).map((name) => {
                const p = PROJECT_PRESETS[name];
                const isActive = draft.width === p.width && draft.height === p.height && draft.fps === p.fps && draft.pixelAspectRatio === p.pixelAspectRatio && draft.gammaTag === p.gammaTag;
                return (
                  <button key={name} onClick={() => applyPreset(name)}
                    className={`rounded px-2.5 py-1 text-[10px] font-medium transition-colors ${isActive ? "bg-blue-500/30 text-blue-200 ring-1 ring-blue-400/40" : "bg-white/10 text-white/60 hover:bg-white/15 hover:text-white"}`}>
                    {name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {/* Width + Height */}
            <div className="flex gap-3">
              <SettingsField label="Width (px)">
                <input type="number" min={1} max={7680} value={draft.width}
                  onChange={(e) => setDraft((d) => ({ ...d, width: Math.max(1, +e.target.value) }))}
                  className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-white/30" />
              </SettingsField>
              <SettingsField label="Height (px)">
                <input type="number" min={1} max={4320} value={draft.height}
                  onChange={(e) => setDraft((d) => ({ ...d, height: Math.max(1, +e.target.value) }))}
                  className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-white/30" />
              </SettingsField>
            </div>

            {/* Frame Rate */}
            <SettingsField label="Frame Rate">
              <select value={draft.fps} onChange={(e) => setDraft((d) => ({ ...d, fps: +e.target.value as ProjectSettings["fps"] }))}
                className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none">
                {FPS_OPTIONS.map((f) => <option key={f} value={f} className="text-black">{f} fps</option>)}
              </select>
            </SettingsField>

            {/* Pixel Aspect Ratio */}
            <SettingsField label="Pixel Aspect Ratio">
              <select value={draft.pixelAspectRatio} onChange={(e) => setDraft((d) => ({ ...d, pixelAspectRatio: +e.target.value as 1.0 | 1.333 }))}
                className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none">
                <option value={1.0} className="text-black">1.000 — Square Pixels</option>
                <option value={1.333} className="text-black">1.333 — Anamorphic 4:3</option>
              </select>
            </SettingsField>

            {/* Gamma Curve */}
            <SettingsField label="Gamma / Color Space">
              <select value={draft.gammaTag} onChange={(e) => setDraft((d) => ({ ...d, gammaTag: e.target.value as "sRGB" | "rec709" }))}
                className="w-full rounded bg-white/10 px-2 py-1 text-xs text-white outline-none">
                <option value="sRGB" className="text-black">sRGB (2.2 Gamma — Web/Display)</option>
                <option value="rec709" className="text-black">Rec.709 (Broadcast / Cinema)</option>
              </select>
            </SettingsField>

            {/* Preview of resulting aspect ratio */}
            <div className="rounded bg-white/5 px-3 py-2 text-[10px] text-white/40">
              Aspect ratio: <span className="text-white/70 tabular-nums">{draft.width}×{draft.height}</span>
              {" "}({(draft.width / draft.height).toFixed(3)}:1)
              {" · "}{draft.fps} fps{" · "}{draft.gammaTag}
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button onClick={onApply}
              className="flex-1 rounded bg-blue-500/80 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500">
              Apply
            </button>
            <button onClick={onClose}
              className="flex-1 rounded bg-white/10 py-2 text-xs font-medium text-white/60 transition-colors hover:bg-white/15 hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">{label}</span>
      {children}
    </label>
  );
}
