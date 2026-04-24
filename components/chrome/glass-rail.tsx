"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, Hash, Bookmark, LayoutGrid, Rows3, User } from "lucide-react";
import { useUiStore } from "@/lib/store/ui-store";
import { useUserStore } from "@/lib/store/user-store";

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
  prefixes?: string[];
}

const NAV: NavItem[] = [
  { href: "/",       label: "Home",   Icon: Home },
  { href: "/browse", label: "Browse", Icon: Compass, prefixes: ["/browse", "/explore"] },
  { href: "/niche",  label: "Niche",  Icon: Hash,    prefixes: ["/niche"] },
  { href: "/vault",  label: "Vault",  Icon: Bookmark },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.prefixes) {
    return item.prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
  }
  return pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href + "/"));
}

export function GlassRail() {
  const pathname   = usePathname();
  const mode       = useUiStore((s) => s.feedViewMode);
  const toggleMode = useUiStore((s) => s.toggleFeedViewMode);
  const profile    = useUserStore((s) => s.profile);
  const avatarHref = profile ? `/profile/${profile.username}` : "/login";

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden lg:flex fixed left-0 top-0 z-30 h-screen w-20 flex-col items-center gap-3 glass-surface border-r border-white/10 py-4"
    >
      <Link
        href="/"
        aria-label="Synapse home"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-bold tracking-wide text-white transition-colors hover:bg-white/20"
      >
        S
      </Link>

      <nav className="mt-2 flex w-full flex-col items-center gap-0.5 px-2">
        {NAV.map(({ href, label, Icon, prefixes }) => {
          const active = isActive(pathname, { href, label, Icon, prefixes });
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              data-testid={`glass-rail-nav-${label.toLowerCase()}`}
              className={[
                "flex w-full flex-col items-center gap-0.5 rounded-xl py-2 transition-colors",
                active
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:bg-white/10 hover:text-white/80",
              ].join(" ")}
            >
              <Icon size={18} />
              <span className="text-[8px] font-medium tracking-wide">{label}</span>
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={toggleMode}
        aria-label={mode === "single" ? "Switch to grid view" : "Switch to single-column view"}
        aria-pressed={mode === "grid"}
        className="mx-2 flex w-[calc(100%-1rem)] flex-col items-center gap-0.5 rounded-xl py-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
      >
        {mode === "single" ? <LayoutGrid size={18} /> : <Rows3 size={18} />}
        <span className="text-[8px] font-medium tracking-wide">{mode === "single" ? "Grid" : "Feed"}</span>
      </button>

      <div className="flex-1" />

      <Link
        href={avatarHref}
        aria-label={profile ? "Open profile" : "Sign in"}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
      >
        <User size={18} />
      </Link>
    </aside>
  );
}
