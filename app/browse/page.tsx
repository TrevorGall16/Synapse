"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Compass } from "lucide-react";
import { NICHE_CATEGORIES as CATEGORIES } from "@/lib/config/taxonomy";

// Lazy-load the heavy Explore page content (800+ lines)
const ExploreContent = dynamic(() => import("@/app/explore/page"), {
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
    </div>
  ),
});

function CategoriesContent() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.slug}
            href={`/niche/${cat.slug}`}
            className="group relative overflow-hidden rounded-xl border border-white/8 transition-all duration-200 hover:border-white/20 hover:scale-[1.01]"
            style={{ background: cat.bg }}
          >
            <div
              className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-20 blur-3xl"
              style={{ background: cat.accent }}
            />
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
  );
}

// ── Browse Page ──────────────────────────────────────────────

type BrowseTab = "explore" | "categories";

export default function BrowsePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as BrowseTab) || "explore";

  const switchTab = useCallback((tab: BrowseTab) => {
    const params = new URLSearchParams();
    if (tab !== "explore") params.set("tab", tab);
    const qs = params.toString();
    router.replace(`/browse${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      {/* Header + tabs */}
      <div className="z-10 shrink-0 border-b border-white/10 bg-[#141414]/95 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 px-6 py-3">
          <Compass size={15} className="text-brand-accent" />
          <h1 className="text-base font-bold text-white">Browse</h1>
        </div>
        <div className="flex gap-0 px-6">
          <button
            onClick={() => switchTab("explore")}
            className={`border-b-2 px-4 py-2 text-[11px] font-semibold transition-colors ${
              activeTab === "explore"
                ? "border-brand-accent text-brand-text"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            Explore
          </button>
          <button
            onClick={() => switchTab("categories")}
            className={`border-b-2 px-4 py-2 text-[11px] font-semibold transition-colors ${
              activeTab === "categories"
                ? "border-brand-accent text-brand-text"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            Categories
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === "explore" && <ExploreContent />}
      {activeTab === "categories" && <CategoriesContent />}
    </div>
  );
}
