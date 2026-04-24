"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Compass } from "lucide-react";
import { NICHE_CATEGORIES, NICHE_TAGS } from "@/lib/config/taxonomy";

type BrowseTab = "niches" | "creators" | "tags";
type SortOption = "trending" | "latest" | "top";

// ── Tab content panels ────────────────────────────────────────────────────────

function NichesContent() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NICHE_CATEGORIES.map((cat) => (
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

function CreatorsContent() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/6 ring-1 ring-white/12">
        <Compass size={22} className="text-white/30" />
      </div>
      <p className="text-sm font-semibold text-white/40">Creator profiles coming soon</p>
      <p className="max-w-xs text-[11px] text-white/25">
        Follow creators from their profile pages or from any post in your feed.
      </p>
    </div>
  );
}

function TagsContent() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-white/25">Trending Tags</p>
      <div className="flex flex-wrap gap-2">
        {NICHE_TAGS.map((tag) => (
          <Link
            key={tag}
            href={`/?tag=${encodeURIComponent(tag.slice(1))}`}
            className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-semibold text-white/70 transition-colors hover:border-white/25 hover:bg-white/12 hover:text-white"
          >
            {tag}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Browse Page ──────────────────────────────────────────────────────────────

export default function BrowsePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as BrowseTab) || "niches";
  const [sort, setSort] = useState<SortOption>("trending");

  const switchTab = useCallback((tab: BrowseTab) => {
    const params = new URLSearchParams();
    if (tab !== "niches") params.set("tab", tab);
    const qs = params.toString();
    router.replace(`/browse${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router]);

  const tabs: { id: BrowseTab; label: string }[] = [
    { id: "niches",   label: "Niches" },
    { id: "creators", label: "Creators" },
    { id: "tags",     label: "Tags" },
  ];

  const sorts: { id: SortOption; label: string }[] = [
    { id: "trending", label: "Trending" },
    { id: "latest",   label: "Latest" },
    { id: "top",      label: "Top" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#141414]">
      {/* Header */}
      <div className="z-10 shrink-0 border-b border-white/10 bg-[#141414]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2.5 px-6 py-3">
          <div className="flex items-center gap-2">
            <Compass size={15} className="text-brand-accent" />
            <h1 className="text-base font-bold text-white">Browse</h1>
          </div>
          {/* Sort options */}
          <div className="flex items-center gap-1">
            {sorts.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setSort(id)}
                className={`rounded-full px-3 py-1 text-[10px] font-semibold transition-colors ${
                  sort === id
                    ? "bg-white/14 text-white ring-1 ring-white/20"
                    : "text-white/35 hover:text-white/65"
                }`}
              >{label}</button>
            ))}
          </div>
        </div>
        {/* Tab row */}
        <div className="flex gap-0 px-6">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => switchTab(id)}
              className={`border-b-2 px-4 py-2 text-[11px] font-semibold transition-colors ${
                activeTab === id
                  ? "border-brand-accent text-brand-text"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      {activeTab === "niches"   && <NichesContent />}
      {activeTab === "creators" && <CreatorsContent />}
      {activeTab === "tags"     && <TagsContent />}
    </div>
  );
}
