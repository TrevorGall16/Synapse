"use client";

import { useEffect, useRef, useState } from "react";
import { usePlaybackStore } from "@/lib/store/playback-store";

export function VolumeHud() {
  const masterVolume = usePlaybackStore((s) => s.masterVolume);
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevRef = useRef(masterVolume);

  useEffect(() => {
    // Skip the initial mount
    if (prevRef.current === masterVolume) return;
    prevRef.current = masterVolume;

    setVisible(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(timeoutRef.current);
  }, [masterVolume]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-16 z-50 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-lg bg-black/80 px-4 py-2 shadow-lg backdrop-blur-sm">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
          Master
        </span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white/80 transition-all duration-100"
            style={{ width: `${masterVolume}%` }}
          />
        </div>
        <span className="min-w-[2rem] text-right text-xs font-bold tabular-nums text-white">
          {masterVolume}%
        </span>
      </div>
    </div>
  );
}
