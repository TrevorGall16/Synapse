import { HydrationBarrier } from "@/components/HydrationBarrier";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#1a1a1a]">
      <HydrationBarrier>{children}</HydrationBarrier>
    </div>
  );
}
