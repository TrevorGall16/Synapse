"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Search, User, LayoutGrid, Rows3 } from "lucide-react";
import { useGlassIslandState } from "./use-glass-island-state";
import { useGlassMotion } from "./use-glass-motion";
import { useUserStore } from "@/lib/store/user-store";
import { useConsumptionScrollRef } from "./consumption-scroll-context";
import { useUiStore } from "@/lib/store/ui-store";

interface NavItem {
  href: string;
  label: string;
  prefixes?: string[];
}

const PRIMARY: NavItem[] = [
  { href: "/home",   label: "Home" },
  { href: "/browse", label: "Browse", prefixes: ["/browse", "/explore"] },
  { href: "/niche",  label: "Niche",  prefixes: ["/niche"] },
  { href: "/vault",  label: "Vault" },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.prefixes) {
    return item.prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
  }
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function GlassIsland() {
  const pathname         = usePathname();
  const scrollRef        = useConsumptionScrollRef();
  const compressed       = useGlassIslandState(scrollRef ?? undefined);
  const transition       = useGlassMotion();
  const profile          = useUserStore((s) => s.profile);
  const openSearchOverlay  = useUiStore((s) => s.openSearchOverlay);
  const feedViewMode       = useUiStore((s) => s.feedViewMode);
  const toggleFeedViewMode = useUiStore((s) => s.toggleFeedViewMode);

  // Avatar/login destination.
  const avatarHref = profile ? `/profile/${profile.username}` : "/login";

  const iconClass =
    "flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10";

  return (
    <motion.nav
      layout
      transition={transition}
      aria-label="Primary navigation"
      className={[
        "glass-pill fixed left-1/2 z-30 -translate-x-1/2 flex items-center",
        compressed ? "top-2 gap-2 px-3.5 py-1.5" : "top-4 gap-4 px-5 py-3",
      ].join(" ")}
      style={{ width: "min(calc(100% - 2rem), 72rem)" }}
    >
      <Link
        href="/"
        className="text-lg font-bold tracking-wide text-white transition-opacity hover:opacity-70"
        aria-label="Synapse home"
      >
        {compressed ? "S" : "SYNAPSE"}
      </Link>

      <div className="flex items-center gap-1">
        {PRIMARY.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`glass-island-nav-${item.label.toLowerCase()}`}
              className={[
                "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                active
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/5",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* View toggle — visible in both compressed and expanded states */}
        <button
          type="button"
          onClick={toggleFeedViewMode}
          aria-label={
            feedViewMode === "single"
              ? "Switch to grid view"
              : "Switch to single-column view"
          }
          className={iconClass}
        >
          {feedViewMode === "single" ? (
            <LayoutGrid size={16} />
          ) : (
            <Rows3 size={16} />
          )}
        </button>

        {/* Search — opens global overlay */}
        <button
          type="button"
          onClick={openSearchOverlay}
          aria-label="Search"
          className={iconClass}
        >
          <Search size={16} />
        </button>

        {!compressed && (
          <Link
            href={avatarHref}
            aria-label={profile ? "Open profile" : "Sign in"}
            className={iconClass}
          >
            <User size={16} />
          </Link>
        )}
      </div>
    </motion.nav>
  );
}
