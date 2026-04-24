"use client";

import { useRef } from "react";
import { HydrationBarrier } from "@/components/HydrationBarrier";
import { GlassIsland } from "@/components/chrome/glass-island";
import { SearchOverlay } from "@/components/chrome/search-overlay";
import { ConsumptionScrollContext } from "@/components/chrome/consumption-scroll-context";

export default function ConsumptionLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const scrollRef = useRef<HTMLElement | null>(null);

  return (
    <ConsumptionScrollContext.Provider value={scrollRef}>
      <GlassIsland />
      <SearchOverlay />
      <main
        ref={scrollRef as React.RefObject<HTMLElement>}
        className="h-screen w-full overflow-y-auto bg-[#141414]"
      >
        <HydrationBarrier>{children}</HydrationBarrier>
      </main>
      {modal}
    </ConsumptionScrollContext.Provider>
  );
}
