"use client";

import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { MediaPool } from "@/components/studio/media-pool";
import { PreviewMonitor } from "@/components/studio/preview-monitor";
import { Timeline } from "@/components/studio/timeline";
import { ClipInspector } from "@/components/studio/clip-inspector";

type LeftTab = "pool" | "inspector";

export default function StudioPage() {
  const [leftTab, setLeftTab] = useState<LeftTab>("pool");

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1a1a1a] text-white">
      <Group orientation="vertical">
        {/* Top half: Media Pool/Inspector + Preview Monitor */}
        <Panel defaultSize={50} minSize={25} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
          <Group orientation="horizontal">
            <Panel defaultSize={40} minSize={20} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
              {/* Tab bar */}
              <div className="flex shrink-0 border-b border-white/10">
                <button
                  onClick={() => setLeftTab("pool")}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    leftTab === "pool"
                      ? "border-b-2 border-white/60 text-white/80"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  Media Pool
                </button>
                <button
                  onClick={() => setLeftTab("inspector")}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    leftTab === "inspector"
                      ? "border-b-2 border-white/60 text-white/80"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  Inspector
                </button>
              </div>
              {/* Tab content */}
              <div className="flex-1 overflow-hidden min-h-0">
                {leftTab === "pool" ? <MediaPool /> : <ClipInspector />}
              </div>
            </Panel>
            <Separator className="w-1 bg-white/10 transition-colors hover:bg-white/30" />
            <Panel defaultSize={60} minSize={25} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
              <PreviewMonitor />
            </Panel>
          </Group>
        </Panel>

        {/* Horizontal resize handle */}
        <Separator className="h-1 bg-white/10 transition-colors hover:bg-white/30" />

        {/* Bottom half: Timeline */}
        <Panel defaultSize={50} minSize={20} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
          <Timeline />
        </Panel>
      </Group>
    </div>
  );
}
