"use client";

import { useRef, useState } from "react";
import { X, Upload, Zap, Globe, Check } from "lucide-react";
import { useFeedStore } from "@/lib/store/feed-store";
import { useUserStore } from "@/lib/store/user-store";

interface UploadModalProps {
  onClose: () => void;
  /** Parent handles store mutations + navigation for the studio path */
  onStudioFile: (file: File) => void;
}

const ACCENTS = ["#7c3aed","#ec4899","#06b6d4","#22c55e","#f59e0b","#ef4444","#a855f7","#38bdf8","#fb923c"];
const BGS     = ["#1a0a2e","#1a0818","#071a1a","#051a0a","#1a1100","#1a0500","#160a1a","#071018","#180e00"];

export function UploadModal({ onClose, onStudioFile }: UploadModalProps) {
  const { username, displayName, hue } = useUserStore();
  const addPost = useFeedStore((s) => s.addPost);

  // ── Path A: Social Post ──────────────────────────────
  const fileARef = useRef<HTMLInputElement>(null);
  const [fileA, setFileA]       = useState<File | null>(null);
  const [title, setTitle]       = useState("");
  const [desc, setDesc]         = useState("");
  const [tagsRaw, setTagsRaw]   = useState("");
  const [posted, setPosted]     = useState(false);

  const handlePost = () => {
    if (!title.trim() || posted) return;
    const tags = tagsRaw.trim()
      ? tagsRaw.split(/\s+/).map((t) => (t.startsWith("#") ? t : `#${t}`))
      : ["#synapse"];
    const idx = Math.floor(Math.random() * ACCENTS.length);
    addPost({
      id: crypto.randomUUID(),
      user: { handle: username, initial: displayName[0]?.toUpperCase() ?? "U", hue },
      title: title.trim(),
      description: desc.trim() || undefined,
      tags,
      bg: BGS[idx],
      accent: ACCENTS[idx],
      duration: "—",
      likes: 0,
      comments: 0,
      featured: false,
      videoUrl: fileA ? URL.createObjectURL(fileA) : undefined,
    });
    setPosted(true);
    setTimeout(onClose, 1300);
  };

  // ── Path B: Studio Edit ──────────────────────────────
  const fileBRef = useRef<HTMLInputElement>(null);
  const [fileB, setFileB] = useState<File | null>(null);

  const handleStudio = () => {
    if (fileB) onStudioFile(fileB);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[600px] overflow-hidden rounded-2xl border border-white/14 bg-[#1c1c1c] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Upload size={13} className="text-white/45" />
            <span className="text-sm font-bold text-white">Share Your Work</span>
          </div>
          <button onClick={onClose} className="rounded-lg bg-white/8 p-1.5 text-white/45 transition-colors hover:bg-white/15 hover:text-white">
            <X size={13} />
          </button>
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-2 divide-x divide-white/8">

          {/* ── Option A ── */}
          <div className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-1.5">
              <Globe size={13} className="text-purple-400" />
              <span className="text-[11px] font-bold text-white">Social Post</span>
              <span className="rounded bg-purple-500/15 px-1.5 py-px text-[8px] font-semibold uppercase tracking-wide text-purple-300">Fast Track</span>
            </div>
            <p className="text-[10px] leading-relaxed text-white/38">Post to the community feed right now — no editing required.</p>

            {/* File pick */}
            <input ref={fileARef} type="file" accept="video/*" className="hidden" onChange={(e) => setFileA(e.target.files?.[0] ?? null)} />
            <button onClick={() => fileARef.current?.click()} className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-[10px] font-semibold transition-colors ${fileA ? "border-purple-500/35 bg-purple-500/8 text-purple-300" : "border-white/10 bg-white/4 text-white/40 hover:bg-white/8 hover:text-white/60"}`}>
              <Upload size={10} />{fileA ? fileA.name.slice(0, 22) + (fileA.name.length > 22 ? "…" : "") : "Video (optional)"}
            </button>

            <input
              value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title *" maxLength={80}
              className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white placeholder-white/22 outline-none focus:border-purple-500/40 focus:bg-white/7"
            />
            <textarea
              value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description…" rows={2} maxLength={300}
              className="resize-none rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white placeholder-white/22 outline-none focus:border-purple-500/40 focus:bg-white/7"
            />
            <input
              value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="#tags separated by spaces"
              className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs text-white placeholder-white/22 outline-none focus:border-purple-500/40 focus:bg-white/7"
            />

            <button
              onClick={handlePost} disabled={!title.trim() || posted}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-white transition-all disabled:opacity-35"
              style={{ background: posted ? "#22c55e99" : "#7c3aedcc" }}
            >
              {posted ? <><Check size={13} />Posted!</> : <><Globe size={13} />Post Now</>}
            </button>
          </div>

          {/* ── Option B ── */}
          <div className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-1.5">
              <Zap size={13} className="text-cyan-400" />
              <span className="text-[11px] font-bold text-white">Studio Edit</span>
              <span className="rounded bg-cyan-500/15 px-1.5 py-px text-[8px] font-semibold uppercase tracking-wide text-cyan-300">Deep Work</span>
            </div>
            <p className="text-[10px] leading-relaxed text-white/38">Open in the full non-linear editor — add effects, cuts, and crossfades.</p>

            {/* Drop zone */}
            <input ref={fileBRef} type="file" accept="video/*,audio/*" className="hidden" onChange={(e) => setFileB(e.target.files?.[0] ?? null)} />
            <button
              onClick={() => fileBRef.current?.click()}
              className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 text-[10px] font-semibold transition-colors ${fileB ? "border-cyan-500/40 bg-cyan-500/5 text-cyan-300" : "border-white/10 text-white/28 hover:border-white/18 hover:text-white/45"}`}
            >
              <Upload size={22} className="opacity-50" />
              {fileB ? fileB.name.slice(0, 26) + (fileB.name.length > 26 ? "…" : "") : "Click to select a file"}
            </button>

            <div className="rounded-lg border border-white/8 bg-white/3 p-3">
              <p className="text-[9px] leading-relaxed text-white/28">File loads into your Media Pool. Drag it to the timeline, add effects, then publish when ready.</p>
            </div>

            <button
              onClick={handleStudio} disabled={!fileB}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-cyan-500/18 py-2.5 text-sm font-bold text-cyan-300 transition-all hover:bg-cyan-500/28 disabled:opacity-30"
            >
              <Zap size={13} />Open in Studio
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
