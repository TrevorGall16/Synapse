import { Sidebar } from "@/components/ui/sidebar";
import { HydrationBarrier } from "@/components/HydrationBarrier";

export default function CreationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="ml-56 flex-1 overflow-hidden min-w-0 min-h-0 h-full">
        <HydrationBarrier>{children}</HydrationBarrier>
      </main>
    </div>
  );
}
