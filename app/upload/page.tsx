"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, X, Film, Image, Check, AlertCircle,
  MessageCircle, Star, ShieldAlert, Zap, Globe,
} from "lucide-react";
import { useFeedStore } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";
import { useProjectStore } from "@/lib/store/project-store";
import { saveMediaToDB } from "@/lib/store/media-pool-db";
import { TITLE_MAX, DESCRIPTION_MAX } from "@/lib/schema";
import type { MediaPoolItem } from "@/lib/store/types";

// ── Constants ────────────────────────────────────────────────────────────────

const ACCENTS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#38bdf8","#fb923c"];
const BGS     = ["#1a0a2e","#1a0818","#071a1a","#051a0a","#1a1100","#1a0500","#160a1a","#071018","#180e00"];

const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "",               label: "None" },
  { value: "cinematic",      label: "Cinematic" },
  { value: "glitch",         label: "Glitch" },
  { value: "aesthetic",      label: "Aesthetic" },
  { value: "slow-mo",        label: "Slow Mo" },
  { value: "high-sensation", label: "High Sensation" },
];

type UploadStage = "idle" | "preparing" | "uploading" | "finalizing" | "done" | "error";

const STAGE_LABELS: Record<UploadStage, string> = {
  idle: "Ready",
  preparing: "Preparing...",
  uploading: "Uploading...",
  finalizing: "Finalizing...",
  done: "Published!",
  error: "Failed",
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router = useRouter();
  const profile = useUserStore((s) => s.profile);
  const addPost = useFeedStore((s) => s.addPost);
  const openProjectInTab = useProjectStore((s) => s.openProjectInTab);
  const addMediaItem = useProjectStore((s) => s.addMediaItem);
  const addClip = useProjectStore((s) => s.addClip);
  const loadProject = useProjectStore((s) => s.loadProject);
  const tracks = useProjectStore((s) => s.tracks);

  // Form state
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [category, setCategory] = useState("");

  // Toggles
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [adultContent, setAdultContent] = useState(false);

  // Thumbnail
  const [thumbnailIdx, setThumbnailIdx] = useState(0);

  // Upload progress
  const [stage, setStage] = useState<UploadStage>("idle");
  const [stageProgress, setStageProgress] = useState(0);

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }, [previewUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("video/")) {
      setFile(f);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(f));
    }
  }, [previewUrl]);

  const clearFile = useCallback(() => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [previewUrl]);

  // ── Publish (Social Post) ─────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    if (!title.trim() || !profile) return;
    setStage("preparing");
    setStageProgress(0);

    // Simulate staged progress
    await tick(400);
    setStageProgress(30);
    setStage("uploading");

    await tick(600);
    setStageProgress(70);
    setStage("finalizing");

    const tags = tagsRaw.trim()
      ? tagsRaw.split(/\s+/).map((t) => (t.startsWith("#") ? t : `#${t}`))
      : ["#synapse"];
    const idx = Math.floor(Math.random() * ACCENTS.length);

    addPost({
      id: crypto.randomUUID(),
      user: { handle: profile.username, initial: profile.displayName[0]?.toUpperCase() ?? "U", hue: profile.hue },
      title: title.trim(),
      description: desc.trim() || undefined,
      tags,
      bg: BGS[idx],
      accent: ACCENTS[idx],
      duration: "—",
      likes: 0,
      comments: 0,
      featured,
      videoUrl: file ? URL.createObjectURL(file) : undefined,
      authorUsername: profile.username,
      createdAt: Date.now(),
      category: (category || undefined) as import("@/lib/store/feed-store").FeedPost["category"],
      comments_enabled: commentsEnabled,
    });

    setStageProgress(100);
    setStage("done");
    await tick(1200);
    router.push("/");
  }, [title, profile, tagsRaw, desc, file, featured, category, commentsEnabled, addPost, router]);

  // ── Open in Studio ────────────────────────────────────────────────────────

  const handleOpenStudio = useCallback(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const mediaId = crypto.randomUUID();
    const media: MediaPoolItem = { id: mediaId, name: file.name, type: "video", duration: 30_000_000, previewUrl: url };
    saveMediaToDB(file, media).catch(console.warn);
    const vTrack = tracks.find((t) => t.type === "video");
    if (vTrack) {
      addMediaItem(media);
      addClip(vTrack.id, { id: crypto.randomUUID(), trackId: vTrack.id, sourceId: mediaId, startTime: 0, duration: media.duration, mediaOffset: 0 });
    } else {
      loadProject({
        tracks: [{ id: "v1", type: "video", name: "Video 1", color: "#3b82f6", height: 60, collapsed: false, locked: false, isMuted: false, isSolo: false, opacityOrVolume: 100, clips: [{ id: crypto.randomUUID(), trackId: "v1", sourceId: mediaId, startTime: 0, duration: media.duration, mediaOffset: 0 }] }],
        duration: media.duration + 5_000_000,
        projectSettings: { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1.0, gammaTag: "sRGB" },
      });
      addMediaItem(media);
    }
    router.push("/studio");
  }, [file, tracks, addMediaItem, addClip, loadProject, router]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const isPublishing = stage !== "idle" && stage !== "error";
  const canPublish = !!title.trim() && stage === "idle";
  const progressPct = stageProgress;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      {/* Header */}
      <div className="z-10 shrink-0 flex items-center justify-between border-b border-white/10 bg-[#141414]/95 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <Upload size={14} className="text-brand-accent" />
          <h1 className="text-sm font-bold text-white">Upload Studio</h1>
        </div>
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/50 transition-colors hover:bg-white/14 hover:text-white"
        >
          <X size={11} /> Cancel
        </button>
      </div>

      {/* Progress bar — visible during upload stages */}
      {isPublishing && (
        <div className="shrink-0 border-b border-white/5">
          <div className="flex items-center gap-3 px-6 py-2">
            <span className="text-[10px] font-semibold text-brand-text">{STAGE_LABELS[stage]}</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-white/30">{progressPct}%</span>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: Drop zone + preview ─────────────────────────────────────── */}
        <div className="flex w-1/2 flex-col border-r border-white/8 p-6 gap-5">
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />

          {!file ? (
            <button
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-white/12 bg-white/[0.02] transition-colors hover:border-brand-accent/40 hover:bg-brand/[0.03]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
                <Film size={28} className="text-brand-accent" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-white/60">Drop a video here or click to browse</p>
                <p className="mt-1 text-[10px] text-white/25">MP4, WebM, MOV — up to 500 MB</p>
              </div>
            </button>
          ) : (
            <div className="flex flex-1 flex-col gap-4 overflow-hidden">
              {/* Live preview */}
              <div className="relative flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black">
                {previewUrl && (
                  <video
                    src={previewUrl}
                    muted
                    autoPlay
                    loop
                    playsInline
                    className="h-full w-full object-contain"
                  />
                )}
                <button
                  onClick={clearFile}
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white/60 backdrop-blur-sm transition-colors hover:bg-black/90 hover:text-white"
                >
                  <X size={14} />
                </button>
                <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/60 px-2.5 py-1 backdrop-blur-sm">
                  <Film size={10} className="text-brand-accent" />
                  <span className="text-[10px] font-medium text-white/70 truncate max-w-[200px]">{file.name}</span>
                  <span className="text-[9px] text-white/30">{(file.size / 1_048_576).toFixed(1)} MB</span>
                </div>
              </div>

              {/* Thumbnail picker scaffold */}
              <div className="shrink-0">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">Thumbnail</p>
                <div className="flex gap-2">
                  {[0, 1, 2].map((i) => (
                    <button
                      key={i}
                      onClick={() => setThumbnailIdx(i)}
                      className={`relative h-16 w-24 overflow-hidden rounded-lg border-2 transition-colors ${
                        thumbnailIdx === i
                          ? "border-brand-accent"
                          : "border-white/10 hover:border-white/20"
                      }`}
                    >
                      {previewUrl && (
                        <video src={previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover pointer-events-none" />
                      )}
                      {thumbnailIdx === i && (
                        <div className="absolute inset-0 flex items-center justify-center bg-brand/20">
                          <Check size={14} className="text-brand-text" />
                        </div>
                      )}
                    </button>
                  ))}
                  <button
                    onClick={() => {}}
                    className="flex h-16 w-24 items-center justify-center rounded-lg border-2 border-dashed border-white/10 text-white/20 transition-colors hover:border-white/20 hover:text-white/40"
                  >
                    <Image size={16} />
                  </button>
                </div>
              </div>

              {/* Open in Studio shortcut */}
              <button
                onClick={handleOpenStudio}
                className="shrink-0 flex items-center justify-center gap-2 rounded-xl bg-cyan-500/12 py-2.5 text-sm font-bold text-cyan-300 transition-colors hover:bg-cyan-500/22"
              >
                <Zap size={14} /> Open in Studio Instead
              </button>
            </div>
          )}
        </div>

        {/* ── Right: Metadata form ──────────────────────────────────────────── */}
        <div className="flex w-1/2 flex-col overflow-y-auto p-6 gap-5">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Title *</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your edit a name"
              maxLength={TITLE_MAX}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-colors focus:border-brand-accent/40 focus:bg-white/[0.06]"
            />
            <p className="mt-1 text-right text-[9px] tabular-nums text-white/20">{title.length}/{TITLE_MAX}</p>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Tell the community about this edit..."
              rows={3}
              maxLength={DESCRIPTION_MAX}
              className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-colors focus:border-brand-accent/40 focus:bg-white/[0.06]"
            />
            <p className="mt-1 text-right text-[9px] tabular-nums text-white/20">{desc.length}/{DESCRIPTION_MAX}</p>
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Tags</label>
            <input
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="#techno #glitch #hypnotic"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-white/20 outline-none transition-colors focus:border-brand-accent/40 focus:bg-white/[0.06]"
            />
          </div>

          {/* Category */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-brand-accent/40 focus:bg-white/[0.06] [&>option]:bg-[#1c1c1c]"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Divider */}
          <div className="border-t border-white/8" />

          {/* Toggles */}
          <div className="flex flex-col gap-3">
            <Toggle
              icon={<MessageCircle size={13} />}
              label="Enable Comments"
              sublabel="Allow viewers to comment on this post"
              checked={commentsEnabled}
              onChange={setCommentsEnabled}
            />
            <Toggle
              icon={<Star size={13} />}
              label="Featured"
              sublabel="Mark as a featured post"
              checked={featured}
              onChange={setFeatured}
            />
            <Toggle
              icon={<ShieldAlert size={13} />}
              label="Adult Content (18+)"
              sublabel="Flag content for mature audiences"
              checked={adultContent}
              onChange={setAdultContent}
            />
          </div>

          {/* Divider */}
          <div className="flex-1" />

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handlePublish}
              disabled={!canPublish}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-bold text-white transition-all hover:bg-brand-accent disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {stage === "done" ? (
                <><Check size={15} /> Published!</>
              ) : stage === "error" ? (
                <><AlertCircle size={15} /> Retry</>
              ) : (
                <><Globe size={15} /> Publish</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Toggle component ─────────────────────────────────────────────────────────

function Toggle({
  icon,
  label,
  sublabel,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
    >
      <span className={`${checked ? "text-brand-accent" : "text-white/25"} transition-colors`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/75">{label}</p>
        <p className="text-[10px] text-white/30">{sublabel}</p>
      </div>
      <div className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${checked ? "bg-brand/40" : "bg-white/10"}`}>
        <div className={`h-4 w-4 rounded-full transition-all ${checked ? "translate-x-4 bg-brand-accent" : "translate-x-0 bg-white/30"}`} />
      </div>
    </button>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tick(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
