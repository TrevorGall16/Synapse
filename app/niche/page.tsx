"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const CATEGORIES = [
  { slug: "high-sensation", label: "High Sensation", description: "Strobing, rapid-cut, beat-synced intensity.", accent: "#ec4899", bg: "#1a0818" },
  { slug: "aesthetic",      label: "Aesthetic",       description: "Dreamy palettes, soft grading, lo-fi vibes.", accent: "#a855f7", bg: "#160a1a" },
  { slug: "cinematic",      label: "Cinematic",       description: "Wide aspect, film grain, color science.",      accent: "#06b6d4", bg: "#071a1a" },
  { slug: "glitch",         label: "Glitch",          description: "Data-bent, pixel-sorted, RGB split chaos.",    accent: "#22c55e", bg: "#051a0a" },
  { slug: "slow-mo",        label: "Slow Mo",         description: "Time-stretch, optical flow, high-fps glass.", accent: "#f59e0b", bg: "#1a1100" },
] as const;

export default function NicheIndexPage() {
  const router = useRouter();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      {/* Header */}
      <div className="shrink-0 border-b border-white/8 px-6 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="flex items-center gap-1.5 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:bg-white/14 hover:text-white">
            <ArrowLeft size={11} />Back
          </button>
          <div>
            <h1 className="text-base font-bold text-white">Niches</h1>
            <p className="text-[11px] text-white/40">Browse posts by content category.</p>
          </div>
        </div>
      </div>

      {/* Category cards */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <Link key={cat.slug} href={`/niche/${cat.slug}`}
              className="group relative overflow-hidden rounded-xl border border-white/8 transition-all duration-200 hover:border-white/20 hover:scale-[1.01]"
              style={{ background: cat.bg }}>
              {/* Accent glow */}
              <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-20 blur-3xl"
                style={{ background: cat.accent }} />
              <div className="relative flex flex-col gap-1.5 p-5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ background: cat.accent }} />
                  <span className="text-sm font-bold text-white">{cat.label}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-white/45">{cat.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
