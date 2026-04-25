"use client";

import { useRef } from "react";
import { HydrationBarrier } from "@/components/HydrationBarrier";
import { GlassIsland } from "@/components/chrome/glass-island";
import { GlassRail } from "@/components/chrome/glass-rail";
import { TopBar } from "@/components/chrome/top-bar";
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
    <ConsumptionScrollContext.Provider value={scrollRef as React.RefObject<HTMLElement>}>
      <GlassRail />
      <GlassIsland />
      <main
        ref={scrollRef as React.RefObject<HTMLElement>}
        className="glass-scroll h-screen w-full overflow-y-auto bg-[#121014] lg:pl-60"
      >
        <TopBar />
        <HydrationBarrier>{children}</HydrationBarrier>
      </main>
      {modal}
    </ConsumptionScrollContext.Provider>
  );
}
