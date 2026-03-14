import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/ui/sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar />
          <main className="ml-56 flex-1 overflow-hidden min-w-0 min-h-0 h-full">{children}</main>
        </div>
      </body>
    </html>
  );
}
