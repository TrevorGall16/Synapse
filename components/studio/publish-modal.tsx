"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Globe, Check, ArrowRight, GitBranch } from "lucide-react";
import { useProjectStore } from "@/lib/store/project-store";
import { useFeedStore } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";
import { usePlaybackStore } from "@/lib/store/playback-store";

interface PublishModalProps {
  onClose: () => void;
}

const ACCENTS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#38bdf8","#fb923c"];
const BGS     = ["#1a0a2e","#1a0818","#071a1a","#051a0a","#1a1100","#1a0500","#160a1a","#071018","#180e00"];

function fmtDuration(micros: number): string {
  const secs = Math.floor(micros / 1_000_000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function PublishModal({ onClose }: PublishModalProps) {
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

  // Detect lineage: stored directly on project to survive across community/mock posts
  const parentProjectId   = useProjectStore((s) => s.parentProjectId);
  const remixedFromHandle = useProjectStore((s) => s.remixedFromHandle);
  // Fall back to feed-store lookup for legacy projects that pre-date remixedFromHandle field
  const parentPost = (!remixedFromHandle && parentProjectId)
    ? useFeedStore.getState().userPosts.find((p) => p.id === parentProjectId)
    : null;

  const handlePublish = () => {
    if (!title.trim() || published) return;

    const { tracks, duration: projectDuration, projectSettings, mediaPool } = useProjectStore.getState();
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
      projectSnapshot: { tracks: publishTracks, duration, projectSettings, mediaPool },
      authorUsername: username,
      allowRemix,
      remixedFromPostId: parentProjectId,
      remixedFromHandle: remixedFromHandle ?? parentPost?.user?.handle,
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
            <span className="text-sm font-bold text-white">Publish to Feed</span>
          </div>
          <button onClick={onClose} className="rounded-lg bg-white/8 p-1.5 text-white/45 transition-colors hover:bg-white/15 hover:text-white">
            <X size={13} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {/* Lineage notice */}
          {(remixedFromHandle ?? parentPost?.user?.handle) && (
            <div className="flex items-center gap-1.5 rounded-lg border border-purple-500/20 bg-purple-500/8 px-3 py-2">
              <GitBranch size={11} className="text-purple-400" />
              <span className="text-[10px] text-purple-300">Remixed from <span className="font-bold">@{remixedFromHandle ?? parentPost?.user?.handle}</span></span>
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

              <button onClick={handlePublish} disabled={!title.trim()}
                className="mt-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-white transition-all disabled:opacity-35"
                style={{ background: "#7c3aedcc" }}>
                <Globe size={13} />Publish to Feed
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
                onClick={() => router.push("/")}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/8 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/15"
              >
                View on Feed <ArrowRight size={13} />
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
