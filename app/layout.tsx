import type { Metadata } from "next";
import localFont from "next/font/local";
import { GlobalHydrator } from "@/components/GlobalHydrator";
import { GlobalSvgFilters } from "@/components/GlobalSvgFilters";
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
        className={`${geistSans.variable} ${geistMono.variable} bg-[#121014] font-sans antialiased`}
      >
        <GlobalSvgFilters />
        <GlobalHydrator />
        <AppBootstrap />
        <SaveBarrierOverlay />
        {children}
      </body>
    </html>
  );
}
