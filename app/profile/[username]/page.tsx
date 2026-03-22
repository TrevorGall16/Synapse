"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Zap, Globe, Heart, Edit3, Users } from "lucide-react";
import { useUserStore } from "@/lib/store/user-store";
import { useProjectsRegistry } from "@/lib/store/projects-registry";
import { useProjectStore } from "@/lib/store/project-store";
import type { ProjectSettings, Track } from "@/lib/store/types";

// ── Mock creator profiles ─────────────────────────────────────────────────────
const CREATOR_MAP: Record<string, { displayName: string; bio: string; hue: number; followers: number; following: number; postCount: number }> = {
  aurora_vj:    { displayName: "Aurora VJ",      bio: "Strobing visuals & hypnotic loops. Techno specialist.",    hue: 270, followers: 8420,  following: 312,  postCount: 47 },
  neon_cut:     { displayName: "Neon Cut",        bio: "RGB splits and glitch art. EDM edit machine.",             hue: 340, followers: 5130,  following: 198,  postCount: 31 },
  spectral_x:   { displayName: "Spectral X",     bio: "Psy visuals, tunnel loops, trippy transitions.",           hue: 200, followers: 11200, following: 427,  postCount: 63 },
  "hue.shift":  { displayName: "Hue Shift",      bio: "Chromatic aberration and VFX packs. Bass-reactive edits.", hue: 30,  followers: 2980,  following: 155,  postCount: 18 },
  "deep.freq":  { displayName: "Deep Freq",      bio: "Pixel sorting, lo-fi aesthetics, experimental cuts.",      hue: 150, followers: 6740,  following: 281,  postCount: 39 },
  void_signal:  { displayName: "Void Signal",    bio: "Industrial noise, infrared palette, harsh cuts.",          hue: 0,   followers: 4890,  following: 167,  postCount: 28 },
  prismatic:    { displayName: "Prismatic",       bio: "Kaleidoscope edits, ambient crossfades, fluid motion.",   hue: 300, followers: 14300, following: 503,  postCount: 82 },
  "lo.form":    { displayName: "Lo Form",         bio: "Retrowave, VHS grain, scan-line aesthetics.",             hue: 185, followers: 3720,  following: 224,  postCount: 22 },
  bpmviz:       { displayName: "BPM Viz",         bio: "Beat-synced flash grids. DnB reactive visuals.",          hue: 45,  followers: 9160,  following: 390,  postCount: 54 },
};

const MOCK_ACCENT: Record<string, string> = {
  aurora_vj: "#7c3aed", neon_cut: "#ec4899", spectral_x: "#06b6d4",
  "hue.shift": "#f59e0b", "deep.freq": "#22c55e", void_signal: "#ef4444",
  prismatic: "#a855f7", "lo.form": "#38bdf8", bpmviz: "#fb923c",
};

const MOCK_BG: Record<string, string> = {
  aurora_vj: "#1a0a2e", neon_cut: "#1a0818", spectral_x: "#071a1a",
  "hue.shift": "#1a1100", "deep.freq": "#051a0a", void_signal: "#1a0500",
  prismatic: "#160a1a", "lo.form": "#071018", bpmviz: "#180e00",
};

// ── Tall project card (reused pattern from discovery) ─────────────────────────
function ProjectCard({ name, accent, bg, index, onOpen }: { name: string; accent: string; bg: string; index: number; onOpen: () => void }) {
  return (
    <article className="group relative cursor-pointer overflow-hidden rounded-xl border border-white/8 transition-all hover:border-white/20 hover:-translate-y-0.5">
      <div className="relative" style={{ aspectRatio: "9/16", background: bg }}>
        <div className="absolute inset-0 flex items-end gap-[2px] px-2 pb-20 opacity-15" aria-hidden>
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="flex-1 rounded-t-[2px]" style={{ background: accent, height: `${20 + Math.sin((i + index) * 0.9) * 35 + (i % 4) * 9}%` }} />
          ))}
        </div>
        <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse 65% 40% at 50% 20%, ${accent}20, transparent 60%)` }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/80" />
        <div className="absolute inset-x-0 bottom-0 p-3 opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0">
          <p className="mb-2 truncate text-[11px] font-bold text-white">{name}</p>
          <button onClick={onOpen} className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold text-white transition-all" style={{ background: `${accent}cc` }}>
            <Zap size={9} />Open
          </button>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-3 group-hover:opacity-0 transition-opacity">
          <p className="truncate text-[10px] font-medium text-white/55">{name}</p>
        </div>
      </div>
    </article>
  );
}

type Tab = "published" | "drafts" | "liked";

// ── Profile page ──────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const username = Array.isArray(params.username) ? params.username[0] : (params.username ?? "you");

  const currentUser = useUserStore();
  const publishedProjects = useProjectsRegistry((s) => s.projects);
  const loadProject = useProjectStore((s) => s.loadProject);

  const [tab, setTab] = useState<Tab>("published");

  const isOwnProfile = username === currentUser.username || username === "you";
  const creator = isOwnProfile ? null : CREATOR_MAP[username];
  const profile = isOwnProfile
    ? { displayName: currentUser.displayName, bio: currentUser.bio, hue: currentUser.hue, followers: currentUser.followers, following: currentUser.following, postCount: publishedProjects.length }
    : (creator ?? { displayName: username, bio: "Synapse creator", hue: 200, followers: 0, following: 0, postCount: 0 });

  const accent  = isOwnProfile ? `hsl(${profile.hue} 55% 45%)` : (MOCK_ACCENT[username] ?? "#7c3aed");
  const bannerBg = isOwnProfile ? `hsl(${profile.hue} 30% 8%)` : (MOCK_BG[username] ?? "#1a1a1a");

  // Own profile shows real registry projects; others show mock count placeholders
  const ownProjects = isOwnProfile ? publishedProjects : [];
  const mockCount = isOwnProfile ? 0 : (profile.postCount ?? 0);

  const handleOpenProject = (projectId: string) => {
    try {
      const raw = localStorage.getItem(`synapse-remix-${projectId}`);
      if (raw) {
        const snap = JSON.parse(raw) as { tracks: Track[]; duration: number; projectSettings: ProjectSettings };
        loadProject(snap);
      }
    } catch { /* fallback */ }
    router.push("/studio");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      {/* Back nav */}
      <div className="z-10 shrink-0 flex items-center gap-2 border-b border-white/8 bg-[#141414]/95 px-4 py-2.5 backdrop-blur-sm">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/14 hover:text-white">
          <ArrowLeft size={11} />Back
        </button>
        <span className="text-[11px] text-white/35">@{username}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Banner */}
        <div className="relative h-32 shrink-0" style={{ background: `linear-gradient(135deg, ${bannerBg}, ${accent}22)` }}>
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: `repeating-linear-gradient(45deg, ${accent} 0px, ${accent} 1px, transparent 1px, transparent 20px)` }} />
        </div>

        {/* Avatar + info */}
        <div className="relative px-6 pb-5">
          {/* Avatar — overlaps banner */}
          <div className="relative -mt-8 mb-3 flex items-end justify-between">
            <div className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white ring-3 ring-[#141414]" style={{ background: `hsl(${profile.hue} 55% 32%)` }}>
              {profile.displayName[0].toUpperCase()}
            </div>
            {isOwnProfile ? (
              <button className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition-colors hover:bg-white/14">
                <Edit3 size={11} />Edit Profile
              </button>
            ) : (
              <button className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white transition-colors" style={{ background: `${accent}cc` }}>
                <Users size={11} />Follow
              </button>
            )}
          </div>

          <h1 className="text-base font-bold text-white">{profile.displayName}</h1>
          <p className="text-[11px] text-white/45">@{username}</p>
          <p className="mt-1.5 text-xs text-white/65">{profile.bio}</p>

          {/* Stats */}
          <div className="mt-3 flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">{profile.followers >= 1000 ? `${(profile.followers / 1000).toFixed(1)}k` : profile.followers}</span>
              <span className="text-[11px] text-white/40">Followers</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">{profile.following}</span>
              <span className="text-[11px] text-white/40">Following</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">{isOwnProfile ? publishedProjects.length : profile.postCount}</span>
              <span className="text-[11px] text-white/40">Published</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/8 px-6">
          {(["published", "drafts", "liked"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`mr-4 border-b-2 pb-2.5 pt-1 text-[11px] font-semibold capitalize transition-colors ${tab === t ? "border-white/80 text-white" : "border-transparent text-white/35 hover:text-white/60"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-6 py-5">
          {tab === "published" && (
            <>
              {/* Own profile: real registry projects */}
              {isOwnProfile && ownProjects.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Globe size={28} className="mb-3 text-white/15" />
                  <p className="text-sm font-semibold text-white/30">No published projects yet</p>
                  <p className="mt-1 text-[11px] text-white/20">Finish an edit in the Studio and hit Publish.</p>
                  <button onClick={() => router.push("/studio")} className="mt-4 flex items-center gap-1.5 rounded-lg bg-purple-500/20 px-3 py-2 text-xs font-bold text-purple-300 transition-colors hover:bg-purple-500/30">
                    <Zap size={11} />Open Studio
                  </button>
                </div>
              )}
              {isOwnProfile && ownProjects.length > 0 && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {ownProjects.map((p, i) => (
                    <ProjectCard key={p.id} name={p.name} accent={accent} bg={bannerBg} index={i} onOpen={() => handleOpenProject(p.id)} />
                  ))}
                </div>
              )}
              {/* Other creator: mock placeholders */}
              {!isOwnProfile && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {Array.from({ length: Math.min(mockCount, 10) }).map((_, i) => (
                    <ProjectCard key={i} name={`Edit #${i + 1}`} accent={accent} bg={bannerBg} index={i} onOpen={() => router.push("/")} />
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "drafts" && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Edit3 size={28} className="mb-3 text-white/15" />
              <p className="text-sm font-semibold text-white/30">No drafts</p>
              <p className="mt-1 text-[11px] text-white/20">Saved drafts will appear here.</p>
            </div>
          )}
          {tab === "liked" && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Heart size={28} className="mb-3 text-white/15" />
              <p className="text-sm font-semibold text-white/30">No liked projects</p>
              <p className="mt-1 text-[11px] text-white/20">Projects you heart will appear here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
