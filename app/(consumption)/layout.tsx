import { HydrationBarrier } from "@/components/HydrationBarrier";
import { GlassIsland } from "@/components/chrome/glass-island";

export default function ConsumptionLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen w-full">
      <GlassIsland />
      {/* Reachability: 3.5rem top-padding ensures the first row of feed content
          is tappable even when the Island is in its expanded state (top: 1rem
          + height ≈ 2.5rem = 3.5rem). Content still scrolls visually under
          the glass. */}
      <div className="pt-14">
        <HydrationBarrier>{children}</HydrationBarrier>
      </div>
      {modal}
    </div>
  );
}
