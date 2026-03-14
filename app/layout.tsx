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
        <div className="flex">
          <Sidebar />
          <main className="ml-56 min-h-screen flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
