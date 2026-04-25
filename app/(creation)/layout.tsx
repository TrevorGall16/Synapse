import { GlassRail } from "@/components/chrome/glass-rail";
import { HydrationBarrier } from "@/components/HydrationBarrier";

export default function CreationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-screen overflow-hidden bg-[#121014]">
      <GlassRail />
      <main className="h-full overflow-hidden lg:pl-60">
        <HydrationBarrier>{children}</HydrationBarrier>
      </main>
    </div>
  );
}
