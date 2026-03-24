"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, Globe, Check, ArrowRight, GitBranch } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";
import { usePlaybackStore } from "@/lib/store/playback-store";
import { getAttributionLock } from "@/lib/store/attribution-idb";
import { clipCssFilter, clipCssTransform, clipCssAnimation } from "@/lib/utils/svg-filters";
import type { Track, ClipEvent, MediaPoolItem } from "@/lib/store/types";

// Stable empty array reference — prevents Zustand getSnapshot infinite loop
// when the selector conditionally returns [] in non-preset mode.
const EMPTY_MEDIA_ARRAY: MediaPoolItem[] = [];

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
  const { profile } = useUserStore();
  const username    = profile?.username    ?? "you";
  const displayName = profile?.displayName ?? "Synapse User";
  const hue         = profile?.hue         ?? 270;
  const addPost = useFeedStore((s) => s.addPost);

  const [title, setTitle]         = useState("");
  const [desc, setDesc]           = useState("");
  const [tagsRaw, setTagsRaw]     = useState("");
  const [allowRemix, setAllowRemix] = useState(false);
  const [scope, setScope] = useState<"timeline" | "selection">("timeline");
  const [published, setPublished] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [presetCat, setPresetCat] = useState<"blur" | "distortion" | "color" | "glitch" | "other">("other");
  const [demoVideoId, setDemoVideoId] = useState<string | null>(null);
  const [demoStartTime, setDemoStartTime] = useState(0);
  const [demoDuration, setDemoDuration] = useState(0);
  const demoProbeRef = useRef<HTMLVideoElement | null>(null);

  // Media pool for demo video picker (preset mode only)
  const mediaPool = useProjectStore((s) => presetMode ? s.mediaPool : EMPTY_MEDIA_ARRAY);
  const videoMediaItems = mediaPool.filter((m) => m.type === "video" && m.previewUrl);

  // Probe demo video duration when selection changes
  useEffect(() => {
    setDemoStartTime(0);
    setDemoDuration(0);
    if (!demoVideoId) return;
    const item = videoMediaItems.find((m) => m.id === demoVideoId);
    if (!item?.previewUrl) return;
    const v = document.createElement("video");
    demoProbeRef.current = v;
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (demoProbeRef.current !== v) return;
      setDemoDuration(v.duration);
    };
    v.src = item.previewUrl;
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
      const tags = tagsRaw.trim()
        ? tagsRaw.split(/\s+/).map((t) => (t.startsWith("#") ? t : `#${t}`))
        : ["#synapse", "#preset"];
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
        demoStartTime: demoItem ? demoStartTime : undefined,
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
      setPublishedId(id);
      setPublished(true);
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
    const tags = tagsRaw.trim()
      ? tagsRaw.split(/\s+/).map((t) => (t.startsWith("#") ? t : `#${t}`))
      : ["#synapse"];

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
    });

    setPublishedId(id);
    setPublished(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/14 bg-[#1c1c1c] shadow-2xl" onClick={(e) => e.stopPropagation()}>

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
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title *" maxLength={80}
                className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white placeholder-white/22 outline-none focus:border-purple-500/40 focus:bg-white/7" />
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description…" rows={2} maxLength={300}
                className="resize-none rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white placeholder-white/22 outline-none focus:border-purple-500/40 focus:bg-white/7" />
              <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="#tags separated by spaces"
                className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white placeholder-white/22 outline-none focus:border-purple-500/40 focus:bg-white/7" />

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

                      {/* Start Offset slider — only when a video is selected and duration is known */}
                      {demoVideoId && demoDuration > 4 && (
                        <div className="mt-2 flex flex-col gap-1">
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
                            onChange={(e) => setDemoStartTime(Number(e.target.value))}
                            className="h-1 w-full cursor-pointer accent-purple-400"
                          />
                          <p className="text-[8px] text-white/20">Showcase loops from {demoStartTime.toFixed(1)}s → {(demoStartTime + 4).toFixed(1)}s</p>
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
                  <p className="text-[10px] text-white/40">Your edit is live on the feed.</p>
                </div>
              </div>
              <button
                onClick={() => router.push(presetMode ? "/explore?tab=presets" : "/")}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/8 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/15"
              >
                {presetMode ? "View in Explore" : "View on Feed"} <ArrowRight size={13} />
              </button>
              <button onClick={onClose} className="text-[10px] text-white/30 hover:text-white/55">
                Stay in Studio
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
