"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/",         label: "Home",     icon: "⌂" },
  { href: "/explore",  label: "Explore",  icon: "◎" },
  { href: "/upload",   label: "Upload",   icon: "⬆" },
  { href: "/projects", label: "Projects", icon: "⬛" },
  { href: "/studio",   label: "Studio",   icon: "▶" },
  { href: "/niche",    label: "Niche",    icon: "◈" },
  { href: "/profile",  label: "Profile",  icon: "⟐" },
  { href: "/login",    label: "Login",    icon: "⊳" },
];

/** True when `pathname` belongs to `item.href` route segment. */
function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
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
          const isActive = isRouteActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`sidebar-nav-${item.label.toLowerCase()}`}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand/15 text-brand-text"
                  : "text-white/55 hover:bg-white/6 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
