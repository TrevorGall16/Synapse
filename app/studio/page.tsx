"use client";

import { Group, Panel, Separator } from "react-resizable-panels";
import { MediaPool } from "@/components/studio/media-pool";
import { PreviewMonitor } from "@/components/studio/preview-monitor";
import { Timeline } from "@/components/studio/timeline";

export default function StudioPage() {
  return (
    <div className="h-screen overflow-hidden bg-[#1a1a1a] text-white">
      <Group orientation="vertical">
        {/* Top half: Media Pool + Preview Monitor */}
        <Panel defaultSize={50} minSize={25}>
          <Group orientation="horizontal">
            <Panel defaultSize={40} minSize={20}>
              <MediaPool />
            </Panel>
            <Separator className="w-1 bg-white/10 transition-colors hover:bg-white/30" />
            <Panel defaultSize={60} minSize={25}>
              <PreviewMonitor />
            </Panel>
          </Group>
        </Panel>

        {/* Horizontal resize handle */}
        <Separator className="h-1 bg-white/10 transition-colors hover:bg-white/30" />

        {/* Bottom half: Timeline */}
        <Panel defaultSize={50} minSize={20}>
          <Timeline />
        </Panel>
      </Group>
    </div>
  );
}
