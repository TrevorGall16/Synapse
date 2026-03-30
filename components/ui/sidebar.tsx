"use client";

import { usePathname, useRouter } from "next/navigation";
import { ensureFlushedBeforeNav } from "@/lib/store/project-store";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/explore", label: "Explore", icon: "◎" },
  { href: "/projects", label: "Projects", icon: "⬛" },
  { href: "/studio", label: "Studio", icon: "▶" },
  { href: "/niche", label: "Niche", icon: "◈" },
  { href: "/login", label: "Login", icon: "⟐" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleNav = async (href: string) => {
    if (pathname === href) return; // already on this page
    await ensureFlushedBeforeNav();
    router.push(href);
  };

  return (
    <aside className="fixed left-0 top-0 z-50 flex h-screen w-56 flex-col border-r border-white/10 bg-[#1a1a1a] px-3 py-6">
      <button
        onClick={() => handleNav("/projects")}
        className="mb-8 px-3 text-left text-lg font-bold tracking-wide text-white transition-opacity hover:opacity-70"
      >
        SYNAPSE
      </button>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <button
              key={item.href}
              data-testid={`sidebar-nav-${item.label.toLowerCase()}`}
              onClick={() => handleNav(item.href)}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-white/55 hover:bg-white/6 hover:text-white"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
