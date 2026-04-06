"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Brand-tokenised items get accent icon colour even when inactive. */
interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** If true, icon always uses brand-accent colour. */
  branded?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/",         label: "Home",     icon: "⌂" },
  { href: "/explore",  label: "Explore",  icon: "◎", branded: true },
  { href: "/upload",   label: "Upload",   icon: "⬆" },
  { href: "/upload",   label: "Studio",   icon: "▶" },
  { href: "/niche",    label: "Niche",    icon: "◈", branded: true },
  { href: "/profile",  label: "Profile",  icon: "⟐" },
  { href: "/login",    label: "Login",    icon: "⊳" },
];

/** True when `pathname` belongs to `item.href` route segment. */
function isRouteActive(pathname: string, item: NavItem): boolean {
  // Both Upload and Studio point to /upload — always active when on /upload
  if (item.href === "/upload") return pathname === "/upload" || pathname.startsWith("/upload/");
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-screen w-56 flex-col border-r border-white/10 bg-[#1a1a1a] px-3 py-6">
      <Link
        href="/"
        className="mb-8 px-3 text-left text-lg font-bold tracking-wide text-white transition-opacity hover:opacity-70"
      >
        SYNAPSE
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = isRouteActive(pathname, item);
          return (
            <Link
              key={item.label}
              href={item.href}
              data-testid={`sidebar-nav-${item.label.toLowerCase()}`}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand/15 text-brand-text"
                  : "text-white/55 hover:bg-white/6 hover:text-white"
              }`}
            >
              <span className={`text-base leading-none ${item.branded && !isActive ? "text-brand-accent" : ""}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
