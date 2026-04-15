import type { Metadata } from "next";
import localFont from "next/font/local";
import { Sidebar } from "@/components/ui/sidebar";
import { GlobalHydrator } from "@/components/GlobalHydrator";
import { GlobalSvgFilters } from "@/components/GlobalSvgFilters";
import { HydrationBarrier } from "@/components/HydrationBarrier";
import { AppBootstrap } from "@/components/AppBootstrap";
import { SaveBarrierOverlay } from "@/components/SaveBarrierOverlay";
import "./globals.css";

// Fonts vendored in public/fonts/ — see docs/build-strategy.md for rationale
// and rotation procedure. Using next/font/local keeps `npm run build` hermetic
// (no Google Fonts fetch) and deterministic across environments.
const geistSans = localFont({
  src: "../public/fonts/geist-sans.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "../public/fonts/geist-mono.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Synapse Interactive Hub",
  description:
    "Browser-native media sequencing and discovery engine with WebGPU effects and audio-synced playback.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-[#1a1a1a] antialiased`}
      >
        <GlobalSvgFilters />
        <GlobalHydrator />
        <AppBootstrap />
        <SaveBarrierOverlay />
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar />
          <main className="ml-56 flex-1 overflow-hidden min-w-0 min-h-0 h-full">
            <HydrationBarrier>{children}</HydrationBarrier>
          </main>
        </div>
      </body>
    </html>
  );
}
