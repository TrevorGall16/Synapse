"use client";

import { useState, useCallback, useEffect } from "react";
import { Zap, Sparkles, User, BookMarked, Trash2 } from "lucide-react";
import { useFeedStore, type PresetData } from "@/lib/store/feed-store";
import { useProjectStore } from "@/lib/store/project-store";
import { clipCssFilter, clipCssTransform, clipCssAnimation } from "@/lib/utils/svg-filters";
import { loadAllCustomPresets, removeCustomPreset, type CustomPreset } from "@/lib/store/custom-presets-idb";

// ── Swatch animation keyframes (injected once) ─────────────────────────────────
const SWATCH_KEYFRAMES = `
@keyframes preset-pulse-blur { 0%,100% { filter: blur(0px) brightness(1) } 50% { filter: blur(6px) brightness(1.2) } }
@keyframes preset-jitter { 0%,100% { transform: none } 20% { transform: translateX(-4px) skewX(-5deg) } 60% { transform: translateX(4px) skewX(5deg) } 80% { transform: translateX(-2px) } }
@keyframes preset-warp { 0%,100% { transform: scaleX(1) scaleY(1) } 50% { transform: scaleX(1.08) scaleY(0.93) } }
@keyframes preset-hue-spin { 0% { filter: hue-rotate(0deg) saturate(1.5) } 100% { filter: hue-rotate(360deg) saturate(1.5) } }
@keyframes preset-strobe { 0%,49%,100% { opacity: 1 } 50%,99% { opacity: 0 } }
`;

function swatchAnimation(category: string, effectType?: string): string {
  if (effectType === "strobe") return "preset-strobe 0.4s steps(1) infinite";
  switch (category) {
    case "blur":       return "preset-pulse-blur 2s ease-in-out infinite";
    case "glitch":     return "preset-jitter 0.5s steps(4) infinite";
    case "distortion": return "preset-warp 1.8s ease-in-out infinite";
    case "color":      return "preset-hue-spin 3s linear infinite";
    default:           return "";
  }
}

// ── Community preset library ───────────────────────────────────────────────────
const COMMUNITY_PRESETS: (PresetData & { id: string; label: string; category: string })[] = [
  { id: "cp-blur-soft",      label: "Soft Focus",      category: "blur",        effectType: "blur",               fxParams: { effectType: "blur", blurAmount: 4, intensity: 60 } },
  { id: "cp-blur-heavy",     label: "Heavy Blur",      category: "blur",        effectType: "blur",               fxParams: { effectType: "blur", blurAmount: 12, intensity: 80 } },
  { id: "cp-glitch-fast",    label: "Fast Glitch",     category: "glitch",      effectType: "glitch",             fxParams: { effectType: "glitch", speed: 80, intensity: 70 } },
  { id: "cp-glitch-slow",    label: "Slow Glitch",     category: "glitch",      effectType: "glitch",             fxParams: { effectType: "glitch", speed: 25, intensity: 55 } },
  { id: "cp-strobe-4hz",     label: "Strobe 4hz",      category: "glitch",      effectType: "strobe",             fxParams: { effectType: "strobe", speed: 40, intensity: 100 } },
  { id: "cp-strobe-10hz",    label: "Strobe 10hz",     category: "glitch",      effectType: "strobe",             fxParams: { effectType: "strobe", speed: 100, intensity: 100 } },
  { id: "cp-tunnel",         label: "Hypno Tunnel",    category: "distortion",  effectType: "hypno-tunnel",       fxParams: { effectType: "hypno-tunnel", intensity: 65 } },
  { id: "cp-ca-light",       label: "Chromatic Lite",  category: "distortion",  effectType: "chromatic-aberration", fxParams: { effectType: "chromatic-aberration", caOffset: 3, intensity: 50 } },
  { id: "cp-ca-heavy",       label: "Chromatic Heavy", category: "distortion",  effectType: "chromatic-aberration", fxParams: { effectType: "chromatic-aberration", caOffset: 8, intensity: 80 } },
  { id: "cp-hue-90",         label: "Hue +90°",        category: "color",       effectType: "hue-rotate",         fxParams: { effectType: "hue-rotate", hueRotate: 90, intensity: 100 } },
  { id: "cp-hue-180",        label: "Hue +180°",       category: "color",       effectType: "hue-rotate",         fxParams: { effectType: "hue-rotate", hueRotate: 180, intensity: 100 } },
  { id: "cp-invert",         label: "Invert",          category: "color",       effectType: "invert",             fxParams: { effectType: "invert", intensity: 100 } },
  { id: "cp-hyper-saturate", label: "Hyper Saturate",  category: "color",       effectType: "none",               fxParams: { effectType: "none", saturate: 250, contrast: 120 } },
  { id: "cp-warm",           label: "Warm Tone",       category: "color",       effectType: "none",               fxParams: { effectType: "none", hueRotate: -15, saturate: 140, brightness: 108 } },
  { id: "cp-cold",           label: "Cold Tone",       category: "color",       effectType: "none",               fxParams: { effectType: "none", hueRotate: 20, saturate: 80, brightness: 95 } },
  { id: "cp-pixelate",       label: "Pixelate",        category: "distortion",  effectType: "pixelate",           fxParams: { effectType: "pixelate", blockSize: 8, intensity: 70 } },
];

type Category = "all" | "blur" | "distortion" | "color" | "glitch";
const CATS: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "blur", label: "Blurs" },
  { id: "glitch", label: "Glitch" },
  { id: "distortion", label: "Distortion" },
  { id: "color", label: "Color" },
];

// ── Preset Card ────────────────────────────────────────────────────────────────
interface PresetCardProps {
  id: string;
  label: string;
  preset: PresetData;
  accent?: string;
  category?: string;
  onApply: () => void;
  onDelete?: () => void;
}

function PresetCard({ id, label, preset, accent = "#7c3aed", category, onApply, onDelete }: PresetCardProps) {
  const cssFilter    = preset.previewCss?.filter    ?? clipCssFilter(preset.fxParams);
  const cssTransform = preset.previewCss?.transform ?? clipCssTransform(preset.fxParams);
  const cssAnim      = preset.previewCss?.animation ?? clipCssAnimation(preset.fxParams);
  const catAnim      = !cssAnim ? swatchAnimation(category ?? "", String(preset.fxParams?.effectType ?? "")) : undefined;

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-synapse-preset", JSON.stringify(preset.fxParams));
  }, [preset.fxParams]);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group relative flex cursor-grab flex-col gap-1.5 rounded-lg border border-white/8 bg-white/3 p-2 transition-all hover:border-white/20 hover:bg-white/6 active:cursor-grabbing"
    >
      {/* Animated CSS preview swatch */}
      <div className="relative h-10 w-full overflow-hidden rounded" style={{ background: "#111" }}>
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(135deg, ${accent}60, ${accent}20)`,
            filter: cssFilter || undefined,
            transform: cssTransform || undefined,
            animation: cssAnim || catAnim || undefined,
          }}
        />
      </div>

      <span className="truncate text-[9px] font-semibold text-white/70">{label}</span>

      <button
        onClick={(e) => { e.stopPropagation(); onApply(); }}
        className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-0.5 rounded bg-purple-500/80 py-1 text-[8px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-purple-500"
      >
        <Zap size={8} />Apply
      </button>

      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute right-1 top-1 rounded p-0.5 text-white/0 transition-all group-hover:text-white/30 hover:!text-red-400"
        >
          <Trash2 size={9} />
        </button>
      )}

      <div className="pointer-events-none absolute left-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-[7px] text-white/30">drag</span>
      </div>
    </div>
  );
}

// ── Preset Panel ───────────────────────────────────────────────────────────────
type PanelTab = "standard" | "saved";

export function PresetPanel() {
  const [cat, setCat]         = useState<Category>("all");
  const [tab, setTab]         = useState<PanelTab>("standard");
  const [savedPresets, setSavedPresets] = useState<CustomPreset[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);

  const userPosts          = useFeedStore((s) => s.userPosts);
  const tracks             = useProjectStore((s) => s.tracks);
  const selectedClipIds    = useProjectStore((s) => s.selectedClipIds);
  const updateClipFxParams = useProjectStore((s) => s.updateClipFxParams);
  const snapshotHistory    = useProjectStore((s) => s.snapshotHistory);

  // Hydrate saved presets when "Saved" tab is shown
  useEffect(() => {
    if (tab !== "saved") return;
    let cancelled = false;
    // Drop all setState calls onto the microtask queue so none run
    // synchronously inside the effect body (satisfies set-state-in-effect).
    // Latency cost is a single microtask tick before the spinner appears —
    // imperceptible, and the subsequent IDB fetch dominates the wait anyway.
    Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setSavedLoading(true);
        return loadAllCustomPresets();
      })
      .then((presets) => {
        if (cancelled || !presets) return;
        setSavedPresets(presets);
      })
      .catch(console.warn)
      .finally(() => { if (!cancelled) setSavedLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  const myPresets = userPosts.filter((p) => p.type === "preset" && p.presetData);

  const filteredCommunity = cat === "all"
    ? COMMUNITY_PRESETS
    : COMMUNITY_PRESETS.filter((p) => p.category === cat);

  const applyPreset = useCallback((fxParams: Record<string, unknown>) => {
    const targetIds = selectedClipIds.length > 0
      ? selectedClipIds
      : tracks.flatMap((t) => t.clips.filter(() => {
          const track = tracks.find((tr) => tr.id === t.id);
          return track?.type === "effect" || track?.type === "video";
        })).slice(0, 1).map((c) => c.id);
    if (targetIds.length === 0) return;
    snapshotHistory("Apply Preset");
    for (const id of targetIds) updateClipFxParams(id, fxParams);
  }, [selectedClipIds, tracks, snapshotHistory, updateClipFxParams]);

  const handleDeleteSaved = useCallback(async (id: string) => {
    await removeCustomPreset(id).catch(console.warn);
    setSavedPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      {/* Inject keyframes once */}
      <style dangerouslySetInnerHTML={{ __html: SWATCH_KEYFRAMES }} />

      {/* Standard / Saved sub-tabs */}
      <div className="flex shrink-0 border-b border-white/10">
        <button
          onClick={() => setTab("standard")}
          className={`flex-1 py-1.5 text-[9px] font-semibold uppercase tracking-wider transition-colors ${tab === "standard" ? "border-b-2 border-white/50 text-white/70" : "text-white/30 hover:text-white/55"}`}
        >
          Standard
        </button>
        <button
          onClick={() => setTab("saved")}
          className={`flex-1 py-1.5 text-[9px] font-semibold uppercase tracking-wider transition-colors ${tab === "saved" ? "border-b-2 border-white/50 text-white/70" : "text-white/30 hover:text-white/55"}`}
        >
          Saved
        </button>
      </div>

      {tab === "standard" ? (
        <>
          {/* Category filter */}
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2 scrollbar-none">
            {CATS.map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold transition-colors ${
                  cat === c.id
                    ? "bg-purple-500/28 text-purple-200 ring-1 ring-purple-500/40"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* My Presets */}
            {myPresets.length > 0 && (
              <div className="px-3 pt-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <User size={9} className="text-white/30" />
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">My Presets</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {myPresets.map((post) => (
                    <PresetCard
                      key={post.id}
                      id={post.id}
                      label={post.title}
                      preset={post.presetData!}
                      accent={post.accent}
                      category={post.presetData?.category}
                      onApply={() => applyPreset(post.presetData!.fxParams)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Community */}
            <div className="px-3 pb-3 pt-3">
              <div className="mb-2 flex items-center gap-1.5">
                <Sparkles size={9} className="text-white/30" />
                <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">Community</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {filteredCommunity.map((p) => (
                  <PresetCard
                    key={p.id}
                    id={p.id}
                    label={p.label}
                    preset={p}
                    category={p.category}
                    onApply={() => applyPreset(p.fxParams)}
                  />
                ))}
              </div>
            </div>

            <p className="pb-4 text-center text-[8px] text-white/18">
              Drag any preset onto a clip · Shift+drop to stack
            </p>
          </div>
        </>
      ) : (
        /* Saved tab */
        <div className="flex-1 overflow-y-auto">
          {savedLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border border-white/10 border-t-white/40" />
            </div>
          ) : savedPresets.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <BookMarked size={28} className="text-white/15" />
              <p className="text-[10px] font-semibold text-white/30">No saved presets yet</p>
              <p className="text-[9px] text-white/20">Use &ldquo;Save to Library&rdquo; on any preset in the Explore page.</p>
            </div>
          ) : (
            <div className="px-3 pt-3">
              <div className="grid grid-cols-2 gap-1.5 pb-3">
                {savedPresets.map((p) => (
                  <PresetCard
                    key={p.id}
                    id={p.id}
                    label={p.label}
                    preset={{ effectType: p.effectType, fxParams: p.fxParams }}
                    category={p.category}
                    onApply={() => applyPreset(p.fxParams)}
                    onDelete={() => handleDeleteSaved(p.id)}
                  />
                ))}
              </div>
              <p className="pb-4 text-center text-[8px] text-white/18">
                Drag onto a clip · Shift+drop to stack
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
