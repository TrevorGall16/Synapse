"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Search, User } from "lucide-react";
import { useGlassIslandState } from "./use-glass-island-state";
import { useGlassMotion } from "./use-glass-motion";
import { useUserStore } from "@/lib/store/user-store";

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
  const pathname   = usePathname();
  const compressed = useGlassIslandState();
  const transition = useGlassMotion();
  const profile    = useUserStore((s) => s.profile);

  // Avatar/login destination. Keeps search-icon parity in both states.
  const avatarHref = profile ? `/profile/${profile.username}` : "/login";

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
        <Link
          href="/browse"
          aria-label="Search"
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10"
        >
          <Search size={16} />
        </Link>
        {!compressed && (
          <Link
            href={avatarHref}
            aria-label={profile ? "Open profile" : "Sign in"}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10"
          >
            <User size={16} />
          </Link>
        )}
      </div>
    </motion.nav>
  );
}
