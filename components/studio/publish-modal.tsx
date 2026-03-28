"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { smoothStep } from "@/lib/utils/easing";
import { useRouter } from "next/navigation";
import { registerTickCallback, unregisterTickCallback } from "@/lib/store/global-ticker";
import { Confetti } from "@/components/ui/confetti";
import { X, Globe, Check, ArrowRight, GitBranch } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { useUserStore, XP_AWARDS } from "@/lib/store/user-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { getAttributionLock } from "@/lib/store/attribution-idb";
import { flushProjectToIDB } from "@/components/GlobalHydrator";
import { clipCssFilter, clipCssTransform, clipCssAnimation } from "@/lib/utils/svg-filters";
import { TITLE_MAX, DESCRIPTION_MAX } from "@/lib/schema";
import type { Track, ClipEvent, MediaPoolItem } from "@/lib/store/types";

// Stable empty array reference — prevents Zustand getSnapshot infinite loop
// when the selector conditionally returns [] in non-preset mode.
const EMPTY_MEDIA_ARRAY: MediaPoolItem[] = [];

// ── Animated impact counter (GlobalTicker) ────────────────────────────────────
function ImpactCounter({ target }: { target: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();
    const dur = 1500;
    const id = registerTickCallback(() => {
      const t = Math.min((performance.now() - start) / dur, 1);
      const ease = smoothStep(t);
      setDisplay(Math.round(ease * target));
      if (t >= 1) unregisterTickCallback(id);
    });
    return () => unregisterTickCallback(id);
  }, [target]);
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl border border-purple-500/20 bg-purple-500/8 px-4 py-3">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-purple-300/60">Projected Impact</span>
      <span className="text-2xl font-black tabular-nums text-purple-200">{display.toLocaleString()}</span>
      <span className="text-[8px] text-white/25">clips × quality × reach</span>
    </div>
  );
}

export interface PresetPublishMode {
  fxParams: Record<string, unknown>;
  effectType: string;
}

interface PublishModalProps {
  onClose: () => void;
  /** When set, the modal publishes a preset rather than a project snapshot */
  presetMode?: PresetPublishMode;
}

const ACCENTS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#38bdf8","#fb923c"];
const BGS     = ["#1a0a2e","#1a0818","#071a1a","#051a0a","#1a1100","#1a0500","#160a1a","#071018","#180e00"];

/**
 * For remixed projects: merge any user-added effect/text track clips INTO each video
 * clip's embeddedEffectClips/embeddedTextClips, then drop the separate tracks.
 * This ensures the published snapshot has a single canonical FX source for the feed.
 * Original posts (no embedded arrays) are returned untouched.
 */
function consolidateEffectTracks(tracks: Track[]): Track[] {
  const hasEmbedded = tracks.some(
    (t) => t.type === "video" && t.clips.some((c) => c.embeddedEffectClips?.length || c.embeddedTextClips?.length)
  );
  if (!hasEmbedded) return tracks; // Original post: keep separate tracks as-is

  const sepFx  = tracks.filter((t) => t.type === "effect").flatMap((t) => t.clips);
  const sepTxt = tracks.filter((t) => t.type === "text").flatMap((t) => t.clips);
  if (sepFx.length === 0 && sepTxt.length === 0) return tracks;

  const overlaps = <T extends { startTime: number; duration: number }>(pool: T[], clip: T) =>
    pool.filter((e) => e.startTime < clip.startTime + clip.duration && e.startTime + e.duration > clip.startTime);

  return tracks
    .filter((t) => t.type !== "effect" && t.type !== "text")
    .map((t): Track => {
      if (t.type !== "video") return t;
      return {
        ...t,
        clips: t.clips.map((c): ClipEvent => ({
          ...c,
          embeddedEffectClips: [...(c.embeddedEffectClips ?? []), ...overlaps(sepFx, c)].map((e) => ({
            // Strip raw fxParams → replace with pre-rendered CSS (secret sauce stripping)
            ...e,
            fxParams: undefined,
            renderedCss: e.renderedCss ?? {
              filter: clipCssFilter(e.fxParams ?? {}),
              transform: clipCssTransform(e.fxParams ?? {}),
              animation: clipCssAnimation(e.fxParams ?? {}),
            },
          })),
          embeddedTextClips: [...(c.embeddedTextClips ?? []), ...overlaps(sepTxt, c)],
        })),
      };
    });
}

function fmtDuration(micros: number): string {
  const secs = Math.floor(micros / 1_000_000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function PublishModal({ onClose, presetMode }: PublishModalProps) {
  const router = useRouter();
  const { profile, addXp } = useUserStore();
  const username    = profile?.username    ?? "you";
  const displayName = profile?.displayName ?? "Synapse User";
  const hue         = profile?.hue         ?? 270;
  const addPost = useFeedStore((s) => s.addPost);

  const [title, setTitle]             = useState("");
  const [desc, setDesc]               = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput]       = useState("");
  const [allowRemix, setAllowRemix]   = useState(false);
  const [scope, setScope]             = useState<"timeline" | "selection">("timeline");
  const [videoCategory, setVideoCategory] = useState<"high-sensation" | "aesthetic" | "cinematic" | "glitch" | "slow-mo" | undefined>(undefined);
  const [published, setPublished]     = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [impactScore, setImpactScore]   = useState(0);
  /** true while awaiting flushProjectToIDB before navigating — blocks the UI */
  const [isSaving, setIsSaving]         = useState(false);
  /** Shown when flushProjectToIDB fails — user stays on page */
  const [saveFailed, setSaveFailed]     = useState(false);

  // Auto-hide confetti after 2.6s; cancels cleanly if modal unmounts
  useEffect(() => {
    if (!showConfetti) return;
    const t = setTimeout(() => setShowConfetti(false), 2600);
    return () => clearTimeout(t);
  }, [showConfetti]);

  const finishPublish = useCallback((id: string, score: number) => {
    setPublishedId(id);
    addXp(XP_AWARDS.publish);
    setImpactScore(score);
    setShowConfetti(true);
    setPublished(true);
  }, [addXp]);

  /**
   * Durability barrier: flush all project state to IDB before leaving Studio.
   * Shows a Saving… overlay so the user can't close the tab mid-write.
   */
  const handleNavigate = useCallback(async () => {
    setIsSaving(true);
    setSaveFailed(false);
    try {
      await flushProjectToIDB();
      router.push(presetMode ? "/explore?tab=presets" : "/");
    } catch (err) {
      console.error("[PublishModal] flushProjectToIDB failed — staying on page", err);
      setIsSaving(false);
      setSaveFailed(true);
      setTimeout(() => setSaveFailed(false), 5000);
    }
  }, [presetMode, router]);
  const [presetCat, setPresetCat] = useState<"blur" | "distortion" | "color" | "glitch" | "other">("other");
  const [demoVideoId, setDemoVideoId] = useState<string | null>(null);
  const [demoStartTime, setDemoStartTime] = useState(0);
  const [demoDuration, setDemoDuration] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Media pool for demo video picker (preset mode only)
  const mediaPool = useProjectStore((s) => presetMode ? s.mediaPool : EMPTY_MEDIA_ARRAY);
  const videoMediaItems = mediaPool.filter((m) => m.type === "video" && m.previewUrl);

  // Load demo video into the preview element when selection changes
  useEffect(() => {
    setDemoStartTime(0);
    setDemoDuration(0);
    const v = previewVideoRef.current;
    if (!v) return;
    if (!demoVideoId) { v.src = ""; return; }
    const item = videoMediaItems.find((m) => m.id === demoVideoId);
    if (!item?.previewUrl) return;
    v.src = item.previewUrl;
    v.load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoVideoId]);

  // Detect lineage: stored directly on project to survive across community/mock posts
  const parentProjectId   = useProjectStore((s) => s.parentProjectId);
  const remixedFromHandle = useProjectStore((s) => s.remixedFromHandle);
  const rootParentId      = useProjectStore((s) => s.rootParentId);
  const rootParentHandle  = useProjectStore((s) => s.rootParentHandle);
  // Fall back to feed-store lookup for legacy projects that pre-date remixedFromHandle field
  const parentPost = (!remixedFromHandle && parentProjectId)
    ? useFeedStore.getState().userPosts.find((p) => p.id === parentProjectId)
    : null;
  const effectiveHandle = remixedFromHandle ?? parentPost?.user?.handle;

  const handlePublish = async () => {
    if (!title.trim() || published) return;

    // ── Preset publish path ───────────────────────────────────────────────────
    if (presetMode) {
      const id  = crypto.randomUUID();
      const idx = (username.charCodeAt(0) + title.charCodeAt(0)) % ACCENTS.length;
      const tags = selectedTags.length > 0 ? selectedTags : ["#synapse", "#preset"];
      const demoItem = demoVideoId ? videoMediaItems.find((m) => m.id === demoVideoId) : null;
      addPost({
        id,
        type: "preset",
        user: { handle: username, initial: displayName[0]?.toUpperCase() ?? "U", hue },
        title: title.trim(),
        description: desc.trim() || undefined,
        tags,
        bg: BGS[idx],
        accent: ACCENTS[idx],
        duration: "0:00",
        likes: 0, comments: 0, featured: false,
        videoUrl: demoItem?.previewUrl,
        demoStartTime: demoItem ? Math.round(demoStartTime * 1_000_000) : undefined,
        authorUsername: username,
        allowRemix: false,
        createdAt: Date.now(),
        presetData: {
          effectType: presetMode.effectType,
          fxParams: presetMode.fxParams,
          label: title.trim(),
          category: presetCat,
        },
      });
      finishPublish(id, 150 + 350);
      return;
    }

    const { tracks, duration: projectDuration, projectSettings, mediaPool, projectId: currentProjectId } = useProjectStore.getState();
    const firstVideo = mediaPool.find((m) => m.type === "video");
    const maxEnd = tracks.flatMap((t) => t.clips).reduce((mx, c) => Math.max(mx, c.startTime + c.duration), 0);
    const allClipsDuration = maxEnd > 0 ? maxEnd : projectDuration;
    const pb = usePlaybackStore.getState();
    const useRuler = scope === "selection" && pb.selectionStart != null && pb.selectionEnd != null && pb.selectionEnd > pb.selectionStart;
    const duration = useRuler ? pb.selectionEnd! - pb.selectionStart! : allClipsDuration;
    // Normalize clip startTimes so selection always begins at t=0
    const selOffset = useRuler ? pb.selectionStart! : 0;
    const publishTracks = selOffset === 0 ? tracks : tracks.map((t) => ({
      ...t,
      clips: t.clips
        .filter((c) => c.startTime < selOffset + duration && c.startTime + c.duration > selOffset)
        .map((c) => ({ ...c, startTime: Math.max(0, c.startTime - selOffset) })),
    }));
    const id  = crypto.randomUUID();
    const idx = (username.charCodeAt(0) + title.charCodeAt(0)) % ACCENTS.length;
    const tags = selectedTags.length > 0 ? selectedTags : ["#synapse"];

    const finalTracks = consolidateEffectTracks(publishTracks);

    // Read attribution lock from IDB — authoritative over in-memory store values
    const lock = await getAttributionLock(currentProjectId).catch(() => null);
    const safeRemixedFromHandle = lock?.remixedFromHandle ?? effectiveHandle;
    const safeRootParentId      = lock?.rootParentId      ?? rootParentId ?? parentProjectId;
    const safeRootParentHandle  = lock?.rootParentHandle  ?? rootParentHandle ?? effectiveHandle;

    addPost({
      id,
      user: { handle: username, initial: displayName[0]?.toUpperCase() ?? "U", hue },
      title: title.trim(),
      description: desc.trim() || undefined,
      tags,
      bg: BGS[idx],
      accent: ACCENTS[idx],
      duration: fmtDuration(duration),
      likes: 0, comments: 0, featured: false,
      videoUrl: firstVideo?.previewUrl,
      // demoStartTime / demoDuration tell Theater Mode exactly which window to loop.
      // Clips are already rebased so the selection starts at t=0 — demoStartTime must
      // match, otherwise Theater Mode seeks into the raw media by the original ruler offset.
      demoStartTime: 0,
      demoDuration: duration,
      // snapshot.duration adds a 1s tail buffer past the last clip so the theater-mode
      // rAF modulo wraps AFTER every clip has fully played (not mid-last-frame).
      projectSnapshot: { tracks: finalTracks, duration: duration + 1_000_000, projectSettings, mediaPool },
      authorUsername: username,
      allowRemix,
      remixedFromPostId: parentProjectId,
      remixedFromHandle: safeRemixedFromHandle,
      rootParentId: safeRootParentId,
      rootParentHandle: safeRootParentHandle,
      createdAt: Date.now(),
      category: videoCategory,
    });

    // Compute impact score: clipCount×150 + effectCount×350 + durationSecs×10
    const allClips   = finalTracks.flatMap((t) => t.clips);
    const effectClips = finalTracks.filter((t) => t.type === "effect").flatMap((t) => t.clips);
    const durationSecs = Math.round(duration / 1_000_000);
    const score = allClips.length * 150 + effectClips.length * 350 + durationSecs * 10;

    finishPublish(id, score);
  };

  return (
    <>
    {showConfetti && <Confetti />}
    {saveFailed && (
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 flex items-center gap-2 rounded-full border border-red-500/30 bg-[#1c1c1c]/95 px-4 py-2.5 shadow-xl backdrop-blur-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        <span className="text-xs font-semibold text-red-300">Save Failed — your project was NOT saved. Try again.</span>
      </div>
    )}
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/14 bg-[#1c1c1c] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Durability overlay — blocks UI while project is being flushed to IDB */}
        {isSaving && (
          <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/80 backdrop-blur-sm">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-purple-400" />
            <p className="text-xs font-semibold text-white/70">Saving…</p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Globe size={13} className="text-purple-400" />
            <span className="text-sm font-bold text-white">{presetMode ? "Share Preset" : "Publish to Feed"}</span>
          </div>
          <button onClick={onClose} className="rounded-lg bg-white/8 p-1.5 text-white/45 transition-colors hover:bg-white/15 hover:text-white">
            <X size={13} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {/* Lineage notice */}
          {effectiveHandle && (
            <div className="flex flex-col gap-0.5 rounded-lg border border-purple-500/20 bg-purple-500/8 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <GitBranch size={11} className="text-purple-400" />
                <span className="text-[10px] text-purple-300">Remixed from <span className="font-bold">@{effectiveHandle}</span></span>
              </div>
              {rootParentHandle && rootParentHandle !== effectiveHandle && (
                <span className="ml-5 text-[9px] text-purple-300/60">Original by <span className="font-bold">@{rootParentHandle}</span></span>
              )}
            </div>
          )}

          {!published ? (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title *" maxLength={TITLE_MAX}
                className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white placeholder-white/22 outline-none focus:border-purple-500/40 focus:bg-white/7" />
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description…" rows={2} maxLength={DESCRIPTION_MAX}
                className="resize-none rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white placeholder-white/22 outline-none focus:border-purple-500/40 focus:bg-white/7" />
              {/* ── Tag Cloud ─────────────────────────────────────────────── */}
              <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/3 p-3">
                <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Tags</span>
                {/* Quick-pick presets */}
                <div className="flex flex-wrap gap-1">
                  {["#Blonde","#Brunette","#Curvy","#Latex","#HighSensation","#Cinematic","#Glitch","#SlowMo","#Aesthetic"].map((t) => (
                    <button key={t} type="button"
                      onClick={() => setSelectedTags((prev) =>
                        prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                      )}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                        selectedTags.includes(t)
                          ? "bg-purple-500/30 text-purple-200 ring-1 ring-purple-500/50"
                          : "bg-white/6 text-white/45 hover:bg-white/12 hover:text-white/75"
                      }`}
                    >{t}</button>
                  ))}
                </div>
                {/* Custom tag input */}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== ",") return;
                    e.preventDefault();
                    const t = tagInput.trim().replace(/,$/, "");
                    if (!t) return;
                    const tag = t.startsWith("#") ? t : `#${t}`;
                    if (!selectedTags.includes(tag)) setSelectedTags((prev) => [...prev, tag]);
                    setTagInput("");
                  }}
                  onBlur={() => {
                    const t = tagInput.trim();
                    if (!t) return;
                    const tag = t.startsWith("#") ? t : `#${t}`;
                    if (!selectedTags.includes(tag)) setSelectedTags((prev) => [...prev, tag]);
                    setTagInput("");
                  }}
                  placeholder="Type a tag, press Enter or comma…"
                  className="rounded border border-white/10 bg-white/4 px-2 py-1.5 text-[11px] text-white placeholder-white/22 outline-none focus:border-purple-500/40"
                />
                {/* Selected chips */}
                {selectedTags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedTags.map((t) => (
                      <span key={t} className="flex items-center gap-1 rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-semibold text-purple-200 ring-1 ring-purple-500/30">
                        {t}
                        <button type="button" onClick={() => setSelectedTags((prev) => prev.filter((x) => x !== t))} className="text-purple-300/60 hover:text-purple-200">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {presetMode ? (
                /* Preset-specific fields — wrapped in a fragment so both nodes are valid */
                <>
                  {/* Category picker */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Category</span>
                    <div className="flex flex-wrap gap-1">
                      {(["blur","glitch","distortion","color","other"] as const).map((c) => (
                        <button key={c} type="button" onClick={() => setPresetCat(c)}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors ${
                            presetCat === c ? "bg-purple-500/28 text-purple-200 ring-1 ring-purple-500/40" : "text-white/40 hover:text-white/70"
                          }`}>
                          {c}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[9px] text-white/28">
                      FX recipe for <span className="font-bold text-purple-300">{presetMode.effectType}</span> will be shared to the Explore Presets feed.
                    </p>
                  </div>

                  {/* Demo video picker */}
                  {videoMediaItems.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Demo Video <span className="normal-case text-white/20">(optional)</span></span>
                      <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/3 p-2">
                        <button
                          type="button"
                          onClick={() => setDemoVideoId(null)}
                          className={`flex items-center gap-2 rounded px-2 py-1 text-left text-[10px] transition-colors ${!demoVideoId ? "bg-white/10 text-white/80" : "text-white/35 hover:text-white/60"}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />None
                        </button>
                        {videoMediaItems.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setDemoVideoId(m.id)}
                            className={`flex items-center gap-2 rounded px-2 py-1 text-left text-[10px] transition-colors ${demoVideoId === m.id ? "bg-purple-500/20 text-purple-200" : "text-white/35 hover:text-white/60"}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${demoVideoId === m.id ? "bg-purple-400" : "bg-white/20"}`} />
                            <span className="truncate">{m.name}</span>
                          </button>
                        ))}
                      </div>
                      <p className="text-[8px] text-white/20">Attaches a clip from your media pool as a looping showcase preview.</p>

                      {/* Live preview + start offset scrubber */}
                      {demoVideoId && (
                        <div className="mt-2 flex flex-col gap-2">
                          {/* Preview thumbnail — muted, paused, scrubs with slider */}
                          <div className="overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "16/9" }}>
                            <video
                              ref={previewVideoRef}
                              muted
                              playsInline
                              preload="metadata"
                              onLoadedMetadata={() => {
                                const v = previewVideoRef.current;
                                if (!v) return;
                                setDemoDuration(v.duration);
                                v.currentTime = 0;
                              }}
                              className="h-full w-full object-contain"
                            />
                          </div>

                          {demoDuration > 4 && (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-white/40">Start Offset</span>
                                <span className="text-[9px] tabular-nums text-white/55">{demoStartTime.toFixed(1)}s</span>
                              </div>
                              <input
                                type="range"
                                min={0}
                                max={Math.max(0, demoDuration - 4)}
                                step={0.1}
                                value={demoStartTime}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  setDemoStartTime(v);
                                  // Seek preview frame synchronously
                                  if (previewVideoRef.current) previewVideoRef.current.currentTime = v;
                                }}
                                className="h-1 w-full cursor-pointer accent-purple-400"
                              />
                              <p className="text-[8px] text-white/20">Loops {demoStartTime.toFixed(1)}s → {(demoStartTime + 4).toFixed(1)}s</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Scope toggle */}
                  <div className="flex overflow-hidden rounded-lg border border-white/10 bg-white/4 text-[11px] font-semibold">
                    {(["timeline", "selection"] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setScope(s)}
                        className={`flex-1 py-2 capitalize transition-colors ${scope === s ? "bg-purple-500/28 text-purple-200" : "text-white/40 hover:text-white/65"}`}>
                        {s === "timeline" ? "All Clips" : "Ruler Selection"}
                      </button>
                    ))}
                  </div>

                  {/* Allow Remix toggle */}
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/8 bg-white/3 px-3 py-2.5">
                    <div>
                      <p className="text-[11px] font-semibold text-white">Allow Others to Remix</p>
                      <p className="text-[9px] text-white/35">Let the community fork your project timeline</p>
                    </div>
                    <button type="button" onClick={() => setAllowRemix((v) => !v)}
                      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${allowRemix ? "bg-purple-500" : "bg-white/15"}`}>
                      <span className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${allowRemix ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </label>

                  <p className="text-[9px] leading-relaxed text-white/28">
                    Project timeline embedded so viewers can{" "}
                    <span className={allowRemix ? "text-purple-300" : "text-white/40"}>
                      {allowRemix ? "Remix" : "not Remix"}
                    </span>{" "}your edit.
                  </p>

                  {/* Niche category (optional) */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Niche <span className="normal-case text-white/20">(optional)</span></span>
                    <div className="flex flex-wrap gap-1">
                      {([undefined, "high-sensation", "aesthetic", "cinematic", "glitch", "slow-mo"] as const).map((c) => (
                        <button key={c ?? "none"} type="button" onClick={() => setVideoCategory(c)}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize transition-colors ${
                            videoCategory === c ? "bg-purple-500/28 text-purple-200 ring-1 ring-purple-500/40" : "text-white/40 hover:text-white/70"
                          }`}>
                          {c ? c.replace("-", " ") : "None"}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <button onClick={handlePublish} disabled={!title.trim()}
                className="mt-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-white transition-all disabled:opacity-35"
                style={{ background: "#7c3aedcc" }}>
                <Globe size={13} />{presetMode ? "Share Preset" : "Publish to Feed"}
              </button>
            </>
          ) : (
            /* ── Success state ── */
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/10 px-4 py-3">
                <Check size={16} className="shrink-0 text-green-400" />
                <div>
                  <p className="text-sm font-bold text-green-300">Published!</p>
                  <p className="text-[10px] text-white/40">Your edit is live on the feed. +{XP_AWARDS.publish} XP</p>
                </div>
              </div>
              <ImpactCounter target={impactScore} />
              <button
                onClick={handleNavigate}
                disabled={isSaving}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/8 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/15 disabled:opacity-60"
              >
                {isSaving ? "Saving…" : (presetMode ? "View in Explore" : "View on Feed")}
                {!isSaving && <ArrowRight size={13} />}
              </button>
              <button onClick={onClose} className="text-[10px] text-white/30 hover:text-white/55">
                Stay in Studio
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
