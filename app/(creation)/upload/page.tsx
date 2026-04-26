"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Upload, X, Film, Image, Check, AlertCircle, ArrowRight,
  MessageCircle, Star, Zap, Globe, Layers, BarChart3,
} from "lucide-react";
import { useFeedStore } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";
import { useProjectStore } from "@/lib/store/project-store";
import { useCommentStore } from "@/lib/store/comment-store";
import { saveMediaToDB } from "@/lib/store/media-pool-db";
import { TITLE_MAX, DESCRIPTION_MAX } from "@/lib/schema";
import { ProjectsTab } from "@/components/studio/projects-tab";
import type { MediaPoolItem, Track, ProjectSettings } from "@/lib/store/types";
import { CHANNELS } from "@/lib/config/taxonomy";
import { MAX_CLIP_DURATION_MICROS } from "@/lib/engine/export-pipeline";

/**
 * Probe a video file's duration without committing it to state. Returns the
 * duration in microseconds (matching the project's micros time base) or null
 * when the metadata can't be parsed (corrupt file, codec the browser refuses).
 */
async function probeVideoDurationMicros(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    const cleanup = () => {
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
    };
    probe.onloadedmetadata = () => {
      const secs = probe.duration;
      cleanup();
      resolve(Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1_000_000) : null);
    };
    probe.onerror = () => { cleanup(); resolve(null); };
    probe.src = url;
  });
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACCENTS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#38bdf8","#fb923c"];
const BGS     = ["#1a0a2e","#1a0818","#071a1a","#051a0a","#1a1100","#1a0500","#160a1a","#071018","#180e00"];

const MAX_TAGS = 10;

type UploadStage = "idle" | "preparing" | "uploading" | "finalizing" | "done" | "error";

const STAGE_LABELS: Record<UploadStage, string> = {
  idle: "Ready",
  preparing: "Preparing...",
  uploading: "Uploading...",
  finalizing: "Finalizing...",
  done: "Published!",
  error: "Failed",
};

type StudioTab = "upload" | "projects" | "analytics";

const TABS: Array<{ id: StudioTab; label: string; icon: React.ReactNode }> = [
  { id: "upload",    label: "Upload",      icon: <Upload size={13} /> },
  { id: "projects",  label: "My Projects", icon: <Layers size={13} /> },
  { id: "analytics", label: "Analytics",   icon: <BarChart3 size={13} /> },
];

// ── Async Thumbnail Generator ────────────────────────────────────────────────

interface ThumbnailResult {
  url: string;
  timestamp: number;
}

function generateThumbnails(
  videoUrl: string,
  onComplete: (thumbs: ThumbnailResult[]) => void,
): () => void {
  let cancelled = false;
  const blobUrls: string[] = [];

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = videoUrl;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  video.addEventListener("loadedmetadata", async () => {
    if (cancelled) return;
    const duration = video.duration;
    if (!duration || !isFinite(duration)) return;

    const positions = [0.10, 0.50, 0.90];
    const results: ThumbnailResult[] = [];

    for (const pct of positions) {
      if (cancelled) break;
      const time = duration * pct;
      video.currentTime = time;

      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
      });

      if (cancelled) break;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );

      if (blob && !cancelled) {
        const url = URL.createObjectURL(blob);
        blobUrls.push(url);
        results.push({ url, timestamp: time });
      }
    }

    if (!cancelled) onComplete(results);
  });

  return () => {
    cancelled = true;
    video.src = "";
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as StudioTab) || "upload";

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
  const [fileDurationMicros, setFileDurationMicros] = useState<number | null>(null);
  const [durationError, setDurationError] = useState<string | null>(null);
  /** Start of the user-selected 90s window (in microseconds). Only relevant when
   *  the file is longer than the 90s clip cap — defaults to 0 for files that
   *  fit. The end of the window is always startMicros + MAX_CLIP_DURATION_MICROS. */
  const [trimStartMicros, setTrimStartMicros] = useState(0);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  // Channels are multi-select buckets (max 4) from the master content taxonomy.
  const [channels, setChannels] = useState<string[]>([]);

  // Toggles
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [featured, setFeatured] = useState(false);

  // Thumbnails — async-generated
  const [thumbnails, setThumbnails] = useState<ThumbnailResult[]>([]);
  const [thumbnailIdx, setThumbnailIdx] = useState(0);
  const thumbCleanupRef = useRef<(() => void) | null>(null);

  // Upload progress
  const [stage, setStage] = useState<UploadStage>("idle");
  const [stageProgress, setStageProgress] = useState(0);

  // ── Cleanup all blob URLs on unmount ───────────────────────────────────────

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      thumbCleanupRef.current?.();
      thumbnails.forEach((t) => URL.revokeObjectURL(t.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Tab navigation ─────────────────────────────────────────────────────────

  const switchTab = useCallback((tab: StudioTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "upload") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const qs = params.toString();
    router.replace(`/upload${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, searchParams]);

  // ── File handling ──────────────────────────────────────────────────────────

  /**
   * Common ingest path — used by both the file picker and drag/drop. Probes
   * the file's duration. Files past the 90s cap are NOT rejected anymore;
   * instead the UI surfaces a range slider so the user can pick a 90s window
   * to ingest. Only the chosen window lands in the published post — the
   * upstream cap is still honored at the .SYNAPSE level via mediaOffset +
   * duration on the clip itself.
   */
  const ingestFile = useCallback(async (f: File | null) => {
    setFile(f);
    setFileDurationMicros(null);
    setDurationError(null);
    setTrimStartMicros(0);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    thumbCleanupRef.current?.();
    thumbnails.forEach((t) => URL.revokeObjectURL(t.url));
    setThumbnails([]);
    setThumbnailIdx(0);

    if (!f) { setPreviewUrl(null); return; }

    const durMicros = await probeVideoDurationMicros(f);
    setFileDurationMicros(durMicros);

    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    thumbCleanupRef.current = generateThumbnails(url, (results) => {
      setThumbnails(results);
      setThumbnailIdx(0);
    });
  }, [previewUrl, thumbnails]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    void ingestFile(e.target.files?.[0] ?? null);
  }, [ingestFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("video/")) void ingestFile(f);
  }, [ingestFile]);

  const clearFile = useCallback(() => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    thumbCleanupRef.current?.();
    thumbnails.forEach((t) => URL.revokeObjectURL(t.url));
    setThumbnails([]);
    setThumbnailIdx(0);
    if (fileRef.current) fileRef.current.value = "";
  }, [previewUrl, thumbnails]);

  // ── Tag chip helpers ───────────────────────────────────────────────────────

  const tagLimitReached = tags.length >= MAX_TAGS;

  const commitTag = useCallback((raw: string) => {
    if (tagLimitReached) return;
    const t = raw.trim().replace(/[,#]/g, "").trim();
    if (!t) return;
    const tag = `#${t}`;
    if (!tags.includes(tag)) setTags((prev) => [...prev, tag]);
    setTagInput("");
  }, [tags, tagLimitReached]);

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  // ── Publish (Social Post) ─────────────────────────────────────────────────

  const publishedIdRef = useRef<string | null>(null);

  const handlePublish = useCallback(async () => {
    if (!title.trim() || !profile) return;

    setStage("preparing");
    setStageProgress(0);

    // ── Durable media: save to media-pool-db so the post survives a refresh ──
    // The previous flow set `videoUrl` to a fresh `URL.createObjectURL(file)`
    // and left it at that. The blob URL is revoked on tab close, persistence
    // strips blob: URLs, and on next boot the post would render the FALLBACK
    // placeholder (the "Ghost Feed" bug). By saving the file via saveMediaToDB
    // and emitting a minimal projectSnapshot.mediaPool entry, hydrateAllPosts
    // re-issues a fresh blob URL on every boot.
    //
    // ── 90s trim window ────────────────────────────────────────────────────
    // For files longer than the cap, the user has picked a `trimStartMicros`
    // window via the slider. We bake that into the clip's mediaOffset/duration
    // so playback stays inside [trimStartMicros, trimStartMicros+90s). The
    // .SYNAPSE clip duration is always ≤ MAX_CLIP_DURATION_MICROS, even when
    // the underlying media file is hours long.
    let projectSnapshot: { tracks: Track[]; duration: number; projectSettings: ProjectSettings; mediaPool?: MediaPoolItem[] } | undefined;
    let livePreviewUrl: string | undefined;
    let demoStartTime: number | undefined;
    let demoDuration: number | undefined;
    if (file) {
      const mediaId = crypto.randomUUID();
      const fullDurMicros = fileDurationMicros ?? 30_000_000;
      const isOversize = fullDurMicros > MAX_CLIP_DURATION_MICROS;
      const trimStart = isOversize
        ? Math.max(0, Math.min(trimStartMicros, fullDurMicros - MAX_CLIP_DURATION_MICROS))
        : 0;
      const clipDurMicros = isOversize
        ? MAX_CLIP_DURATION_MICROS
        : fullDurMicros;
      livePreviewUrl = URL.createObjectURL(file);
      const mediaItem: MediaPoolItem = {
        id: mediaId,
        name: file.name,
        type: "video",
        // The mediaPool stores the FULL file duration so a future Studio
        // session can re-trim freely; the clip itself constrains playback.
        duration: fullDurMicros,
        previewUrl: livePreviewUrl,
      };
      try {
        await saveMediaToDB(file, mediaItem);
      } catch (err) {
        console.warn("[Upload] saveMediaToDB failed — post will still publish but may not survive a refresh:", err);
      }
      const trackId = "video1";
      projectSnapshot = {
        tracks: [
          {
            id: trackId, type: "video", name: "Video 1", color: "#3b82f6",
            height: 60, collapsed: false, locked: false, isMuted: false, isSolo: false,
            opacityOrVolume: 100,
            clips: [{
              id: crypto.randomUUID(),
              trackId,
              sourceId: mediaId,
              startTime: 0,
              duration: clipDurMicros,
              mediaOffset: trimStart,
            }],
          },
        ],
        duration: clipDurMicros,
        projectSettings: { width: 1920, height: 1080, fps: 30, pixelAspectRatio: 1.0, gammaTag: "sRGB" },
        mediaPool: [mediaItem],
      };
      demoStartTime = 0;
      demoDuration = clipDurMicros;
    }

    await tick(400);
    setStageProgress(30);
    setStage("uploading");

    await tick(600);
    setStageProgress(70);
    setStage("finalizing");

    const finalTags = tags.length > 0 ? tags : ["#synapse"];
    const idx = Math.floor(Math.random() * ACCENTS.length);
    const postId = crypto.randomUUID();

    addPost({
      id: postId,
      user: { handle: profile.username, initial: profile.displayName[0]?.toUpperCase() ?? "U", hue: profile.hue },
      title: title.trim(),
      description: desc.trim() || undefined,
      tags: finalTags,
      bg: BGS[idx],
      accent: ACCENTS[idx],
      duration: "—",
      likes: 0,
      comments: 0,
      featured,
      // Pin timestamp follows the same rule the Profile page expects — set
      // when the user toggled "Pin to Profile Top" before publishing.
      pinnedAt: featured ? Date.now() : undefined,
      videoUrl: livePreviewUrl,
      projectSnapshot,
      authorUsername: profile.username,
      createdAt: Date.now(),
      channels: channels.length > 0 ? channels : undefined,
      comments_enabled: commentsEnabled,
      demoStartTime,
      demoDuration,
    });

    useCommentStore.getState().initEmptyPost(postId);
    publishedIdRef.current = postId;
    setStageProgress(100);
    setStage("done");
  }, [title, profile, tags, desc, file, fileDurationMicros, trimStartMicros, featured, channels, commentsEnabled, addPost]);

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
    <div className="flex h-full flex-col overflow-hidden bg-[#121014]">
      {/* Header + Tab Bar */}
      <div className="z-10 shrink-0 border-b border-white/10 bg-[#121014]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <Upload size={14} className="text-brand-accent" />
            <h1 className="text-sm font-bold text-white">Studio</h1>
          </div>
          {activeTab === "upload" && (
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-1.5 rounded-lg bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/50 transition-colors hover:bg-white/14 hover:text-white"
            >
              <X size={11} /> Cancel
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0 px-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-[11px] font-semibold transition-colors ${
                activeTab === tab.id
                  ? "border-brand-accent text-brand-text"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "upload" && (
        <UploadTabContent
          file={file}
          fileRef={fileRef}
          previewUrl={previewUrl}
          durationError={durationError}
          fileDurationMicros={fileDurationMicros}
          trimStartMicros={trimStartMicros}
          setTrimStartMicros={setTrimStartMicros}
          title={title}
          setTitle={setTitle}
          desc={desc}
          setDesc={setDesc}
          tags={tags}
          tagInput={tagInput}
          setTagInput={setTagInput}
          tagLimitReached={tagLimitReached}
          commitTag={commitTag}
          removeTag={removeTag}
          setTags={setTags}
          channels={channels}
          setChannels={setChannels}
          commentsEnabled={commentsEnabled}
          setCommentsEnabled={setCommentsEnabled}
          featured={featured}
          setFeatured={setFeatured}
          thumbnails={thumbnails}
          thumbnailIdx={thumbnailIdx}
          setThumbnailIdx={setThumbnailIdx}
          stage={stage}
          isPublishing={isPublishing}
          canPublish={canPublish}
          progressPct={progressPct}
          handleFileChange={handleFileChange}
          handleDrop={handleDrop}
          clearFile={clearFile}
          handlePublish={handlePublish}
          handleOpenStudio={handleOpenStudio}
          router={router}
        />
      )}
      {activeTab === "projects" && <ProjectsTab />}
      {activeTab === "analytics" && <AnalyticsPlaceholder />}
    </div>
  );
}

// ── Upload Tab Content ──────────────────────────────────────────────────────

interface UploadTabProps {
  file: File | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  previewUrl: string | null;
  fileDurationMicros: number | null;
  trimStartMicros: number;
  setTrimStartMicros: (v: number) => void;
  title: string;
  setTitle: (v: string) => void;
  desc: string;
  setDesc: (v: string) => void;
  tags: string[];
  tagInput: string;
  setTagInput: (v: string) => void;
  tagLimitReached: boolean;
  commitTag: (raw: string) => void;
  removeTag: (tag: string) => void;
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  durationError: string | null;
  channels: string[];
  setChannels: React.Dispatch<React.SetStateAction<string[]>>;
  commentsEnabled: boolean;
  setCommentsEnabled: (v: boolean) => void;
  featured: boolean;
  setFeatured: (v: boolean) => void;
  thumbnails: ThumbnailResult[];
  thumbnailIdx: number;
  setThumbnailIdx: (v: number) => void;
  stage: UploadStage;
  isPublishing: boolean;
  canPublish: boolean;
  progressPct: number;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrop: (e: React.DragEvent) => void;
  clearFile: () => void;
  handlePublish: () => void;
  handleOpenStudio: () => void;
  router: ReturnType<typeof useRouter>;
}

function UploadTabContent(props: UploadTabProps) {
  const {
    file, fileRef, previewUrl, durationError,
    fileDurationMicros, trimStartMicros, setTrimStartMicros,
    title, setTitle, desc, setDesc,
    tags, tagInput, setTagInput, tagLimitReached, commitTag, removeTag, setTags,
    channels, setChannels, commentsEnabled, setCommentsEnabled, featured, setFeatured,
    thumbnails, thumbnailIdx, setThumbnailIdx,
    stage, isPublishing, canPublish, progressPct,
    handleFileChange, handleDrop, clearFile, handlePublish, handleOpenStudio, router,
  } = props;

  const isOversize = fileDurationMicros !== null && fileDurationMicros > MAX_CLIP_DURATION_MICROS;
  const maxStartMicros = isOversize && fileDurationMicros !== null
    ? Math.max(0, fileDurationMicros - MAX_CLIP_DURATION_MICROS)
    : 0;
  const trimEndMicros = trimStartMicros + MAX_CLIP_DURATION_MICROS;
  const fmtTime = (us: number) => {
    const s = Math.floor(us / 1_000_000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // Preview <video> ref + loop guard. When a trim window is active we seek the
  // preview to trimStart and loop within [trimStart, trimEnd] so the user sees
  // exactly what their post will play. For files that fit, behavior is unchanged.
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v || !isOversize) return;
    const startSec = trimStartMicros / 1_000_000;
    const endSec = trimEndMicros / 1_000_000;
    const seek = () => { v.currentTime = startSec; };
    seek();
    const guard = () => { if (v.currentTime < startSec || v.currentTime >= endSec) v.currentTime = startSec; };
    v.addEventListener("timeupdate", guard);
    return () => v.removeEventListener("timeupdate", guard);
  }, [trimStartMicros, trimEndMicros, isOversize, previewUrl]);

  return (
    <>
      {/* Progress bar */}
      {isPublishing && (
        <div className="shrink-0 border-b border-white/5">
          <div className="flex items-center gap-3 px-6 py-2">
            <span className="text-[10px] font-semibold text-brand-text">{STAGE_LABELS[stage]}</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${progressPct}%`,
                  background: "linear-gradient(90deg, var(--color-brand) 0%, var(--color-brand-accent) 100%)",
                }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-white/30">{progressPct}%</span>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Drop zone + preview */}
        <div className="flex w-1/2 flex-col border-r border-white/8 p-6 gap-5">
          <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />

          {durationError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2.5">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
              <p className="text-[11px] leading-relaxed text-red-200">{durationError}</p>
            </div>
          )}
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
              <div className="relative flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a]">
                {previewUrl && (
                  <video
                    ref={previewVideoRef}
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
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-[#0a0a0a]/70 text-white/60 backdrop-blur-sm transition-colors hover:bg-[#0a0a0a]/90 hover:text-white"
                >
                  <X size={14} />
                </button>
                <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-[#0a0a0a]/60 px-2.5 py-1 backdrop-blur-sm">
                  <Film size={10} className="text-brand-accent" />
                  <span className="text-[10px] font-medium text-white/70 truncate max-w-[200px]">{file.name}</span>
                  <span className="text-[9px] text-white/30">{(file.size / 1_048_576).toFixed(1)} MB</span>
                </div>
              </div>

              {/* 90s trim window — only shown when the source exceeds the clip cap.
                  The native range input keeps the UI dependency-free; the
                  end of the window is always start + 90s, so a single slider
                  is enough. The post will only ingest this 90s window. */}
              {isOversize && fileDurationMicros !== null && (
                <div className="shrink-0 rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/85">
                      Trim to 90s — pick a start time
                    </p>
                    <span className="text-[10px] tabular-nums text-amber-200/80">
                      {fmtTime(trimStartMicros)} – {fmtTime(trimEndMicros)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={maxStartMicros}
                    step={100_000}
                    value={Math.min(trimStartMicros, maxStartMicros)}
                    onChange={(e) => setTrimStartMicros(Number(e.target.value))}
                    className="w-full accent-amber-400"
                    aria-label="Trim window start time"
                  />
                  <p className="mt-1 text-[10px] text-amber-200/55">
                    Source is {fmtTime(fileDurationMicros)}. Only the highlighted
                    {" "}90-second window will be published.
                  </p>
                </div>
              )}

              {/* Thumbnail picker — async generated */}
              <div className="shrink-0">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                  Thumbnail {thumbnails.length > 0 ? "— Auto-Generated" : "— Generating..."}
                </p>
                <div className="flex gap-2">
                  {thumbnails.length > 0
                    ? thumbnails.map((thumb, i) => (
                        <button
                          key={thumb.url}
                          onClick={() => setThumbnailIdx(i)}
                          className={`relative h-16 w-24 overflow-hidden rounded-lg border-2 transition-colors ${
                            thumbnailIdx === i
                              ? "border-brand-accent"
                              : "border-white/10 hover:border-white/20"
                          }`}
                        >
                          <img
                            src={thumb.url}
                            alt={`Thumbnail at ${Math.round(thumb.timestamp)}s`}
                            className="h-full w-full object-cover"
                          />
                          {thumbnailIdx === i && (
                            <div className="absolute inset-0 flex items-center justify-center bg-brand/20">
                              <Check size={14} className="text-brand-text" />
                            </div>
                          )}
                        </button>
                      ))
                    : [0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="flex h-16 w-24 items-center justify-center rounded-lg border-2 border-white/10 bg-white/[0.02]"
                        >
                          <div className="h-3 w-3 animate-pulse rounded-full bg-white/15" />
                        </div>
                      ))
                  }
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

        {/* Right: Metadata form */}
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

          {/* Tags (Chip Engine) — max 10 */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
              Tags <span className="text-white/25 font-normal normal-case tracking-normal">· free-form keywords</span>
            </label>
            <div className={`flex flex-wrap items-center gap-1.5 rounded-xl border bg-white/[0.04] px-3 py-2.5 transition-colors focus-within:bg-white/[0.06] ${
              tagLimitReached
                ? "border-amber-500/30 focus-within:border-amber-500/40"
                : "border-white/10 focus-within:border-brand-accent/40"
            }`}>
              {tags.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-full border border-brand-accent/20 bg-brand-accent/10 px-2.5 py-0.5 text-xs font-semibold text-brand-accent"
                >
                  {t}
                  <button type="button" onClick={() => removeTag(t)} className="ml-0.5 text-brand-accent/50 hover:text-brand-accent">
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " " || e.key === ",") {
                    e.preventDefault();
                    commitTag(tagInput);
                  }
                  if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                    setTags((prev) => prev.slice(0, -1));
                  }
                }}
                onBlur={() => commitTag(tagInput)}
                disabled={tagLimitReached}
                placeholder={tagLimitReached ? "" : tags.length === 0 ? "Type a tag, press Space or Enter..." : ""}
                className="min-w-[120px] flex-1 bg-transparent text-sm text-white placeholder-white/20 outline-none disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>
            {tagLimitReached && (
              <p className="mt-1.5 text-[10px] font-medium text-amber-400/80">Maximum {MAX_TAGS} tags reached.</p>
            )}
            {!tagLimitReached && (
              <p className="mt-1 text-right text-[9px] tabular-nums text-white/20">{tags.length}/{MAX_TAGS}</p>
            )}
          </div>

          {/* Channels — multi-select (max 4) from master content taxonomy */}
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-white/35">
              Channels <span className="text-white/25 font-normal normal-case tracking-normal">· up to 4</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => {
                const selected = channels.includes(c);
                const atMax = channels.length >= 4 && !selected;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={atMax}
                    onClick={() => setChannels((prev) => selected ? prev.filter((x) => x !== c) : [...prev, c])}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      selected
                        ? "bg-brand/25 text-brand-text ring-1 ring-brand-accent/40"
                        : atMax
                          ? "text-white/15 cursor-not-allowed"
                          : "text-white/45 hover:text-white/70 hover:bg-white/[0.06]"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            {channels.length >= 4 && (
              <p className="mt-1.5 text-[10px] font-medium text-amber-400/80">Maximum 4 channels selected.</p>
            )}
          </div>


          {/* Divider */}
          <div className="border-t border-white/8" />

          {/* Toggles */}
          <div className="flex flex-col gap-3">
            {/* Enable Comments — UI hidden per Spec, state preserved so it
                round-trips through addPost/IDB until product re-introduces it. */}
            <div hidden>
              <Toggle
                icon={<MessageCircle size={13} />}
                label="Enable Comments"
                sublabel="Allow viewers to comment on this post"
                checked={commentsEnabled}
                onChange={setCommentsEnabled}
              />
            </div>
            <Toggle
              icon={<Star size={13} />}
              label="Pin to Profile Top"
              sublabel="Surface this post at the top of your Profile grid"
              checked={featured}
              onChange={setFeatured}
            />
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions */}
          {stage === "done" ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/10 px-4 py-3">
                <Check size={16} className="shrink-0 text-green-400" />
                <div>
                  <p className="text-sm font-bold text-green-300">Published!</p>
                  <p className="text-[10px] text-white/40">Your post is live on the feed.</p>
                </div>
              </div>
              <button
                onClick={() => router.push("/")}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-brand py-3 text-sm font-bold text-white transition-all hover:bg-brand-accent"
              >
                View Post <ArrowRight size={13} />
              </button>
              <button
                onClick={() => router.push("/")}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/8 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/15"
              >
                Return to Feed
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={handlePublish}
                disabled={!canPublish}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-bold text-white transition-all hover:bg-brand-accent disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {stage === "error" ? (
                  <><AlertCircle size={15} /> Retry</>
                ) : (
                  <><Globe size={15} /> Publish</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Analytics Placeholder ───────────────────────────────────────────────────

function AnalyticsPlaceholder() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <BarChart3 size={36} className="text-white/15" />
      <p className="text-sm font-semibold text-white/35">Analytics coming soon</p>
      <p className="text-xs text-white/20">Track views, likes, and engagement across your posts.</p>
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
