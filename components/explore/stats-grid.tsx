"use client";

import { Flame, Sparkles, Users } from "lucide-react";
import type { TrendingData } from "@/lib/stats";

// ── Effect label map ──────────────────────────────────────────────────────────
const EFFECT_LABELS: Record<string, string> = {
  "blur":                  "Blur",
  "glitch":                "Glitch",
  "strobe":                "Strobe",
  "hypno-tunnel":          "Hypno Tunnel",
  "chromatic-aberration":  "Chromatic Aber.",
  "hue-rotate":            "Hue Rotate",
  "invert":                "Invert",
  "pixelate":              "Pixelate",
  "vhs":                   "VHS",
};

function fmtEffect(et: string): string {
  return EFFECT_LABELS[et] ?? et.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ── Bar row ───────────────────────────────────────────────────────────────────
function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[6.5rem] shrink-0 truncate text-[10px] text-white/55">{label}</span>
      <div className="flex-1 h-[3px] rounded-full bg-white/8">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.round((value / max) * 100)}%`, background: color }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-[9px] tabular-nums text-white/30">{value}</span>
    </div>
  );
}

// ── Section card ─────────────────────────────────────────────────────────────
function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="mb-3 flex items-center gap-1.5">
        {icon}
        <p className="text-[9px] font-semibold uppercase tracking-widest text-white/35">{label}</p>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

const EMPTY = <p className="text-[9px] text-white/20">Publish a recipe to see data</p>;

// ── StatsGrid ─────────────────────────────────────────────────────────────────
export function StatsGrid({ data }: { data: TrendingData }) {
  const hasAny = data.tags.length > 0 || data.effects.length > 0 || data.creators.length > 0;

  if (!hasAny) {
    return (
      <div className="rounded-xl border border-white/6 bg-white/[0.025] px-5 py-4 text-[10px] text-white/25">
        No community data yet — publish your first recipe to see trending stats.
      </div>
    );
  }

  const maxTag    = Math.max(1, ...data.tags.map((t) => t.count));
  const maxEffect = Math.max(1, ...data.effects.map((e) => e.count));
  const maxLikes  = Math.max(1, ...data.creators.map((c) => c.totalLikes));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {/* Top Tags */}
      <Section icon={<Flame size={10} className="text-orange-400" />} label="Top Tags">
        {data.tags.length > 0
          ? data.tags.map((t) => <BarRow key={t.tag} label={t.tag} value={t.count} max={maxTag} color="#7c3aed" />)
          : EMPTY}
      </Section>

      {/* Top Effects */}
      <Section icon={<Sparkles size={10} className="text-pink-400" />} label="Top Effects">
        {data.effects.length > 0
          ? data.effects.map((e) => (
              <BarRow key={e.effectType} label={fmtEffect(e.effectType)} value={e.count} max={maxEffect} color="#ec4899" />
            ))
          : EMPTY}
      </Section>

      {/* Top Creators */}
      <Section icon={<Users size={10} className="text-cyan-400" />} label="Top Creators">
        {data.creators.length > 0
          ? data.creators.map((c) => (
              <div key={c.handle} className="flex items-center gap-2">
                <div
                  className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-white"
                  style={{ background: `hsl(${c.hue} 55% 30%)` }}
                >
                  {c.initial}
                </div>
                <div className="flex-1 h-[3px] rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-cyan-400 transition-all duration-500"
                    style={{ width: `${Math.round((c.totalLikes / maxLikes) * 100)}%` }}
                  />
                </div>
                <span className="w-7 shrink-0 text-right text-[9px] tabular-nums text-white/30">{fmtK(c.totalLikes)}</span>
              </div>
            ))
          : EMPTY}
      </Section>
    </div>
  );
}
