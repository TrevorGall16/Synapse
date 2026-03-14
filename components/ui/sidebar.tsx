"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/explore", label: "Explore", icon: "◎" },
  { href: "/studio", label: "Studio", icon: "▶" },
  { href: "/niche", label: "Niche", icon: "◈" },
  { href: "/login", label: "Login", icon: "⟐" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-white/10 bg-[#1a1a1a] px-3 py-6">
      <div className="mb-8 px-3 text-lg font-bold tracking-wide text-white">
        SYNAPSE
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-white/10 text-white"
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
