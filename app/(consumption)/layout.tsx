import { HydrationBarrier } from "@/components/HydrationBarrier";

export default function ConsumptionLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full">
      <HydrationBarrier>{children}</HydrationBarrier>
      {modal}
    </div>
  );
}
