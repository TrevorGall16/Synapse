"use client";

import { Group, Panel, Separator } from "react-resizable-panels";
import { MediaPool } from "@/components/studio/media-pool";
import { PreviewMonitor } from "@/components/studio/preview-monitor";
import { Timeline } from "@/components/studio/timeline";
import { TextInspector } from "@/components/studio/text-inspector";
import { FxInspector } from "@/components/studio/fx-inspector";
import { PanCropWindow } from "@/components/studio/pan-crop-window";
import { VideoFxInspector } from "@/components/studio/video-fx-inspector";
import { AudioInspector } from "@/components/studio/audio-inspector";
import { AudioMixer } from "@/components/studio/audio-mixer";
import { VolumeHud } from "@/components/studio/volume-hud";
import { useProjectStore } from "@/lib/store/project-store";

export default function StudioPage() {
  const leftTab = useProjectStore((s) => s.activeUISection);
  const setLeftTab = useProjectStore((s) => s.setActiveUISection);
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const inspectorSubTab = useProjectStore((s) => s.inspectorSubTab);
  const setInspectorSubTab = useProjectStore((s) => s.setInspectorSubTab);
  const tracks = useProjectStore((s) => s.tracks);

  // Derive the track type of the inspecting clip
  let inspectingTrackType: string | null = null;
  if (inspectingClipId) {
    for (const t of tracks) {
      if (t.clips.some((c) => c.id === inspectingClipId)) {
        inspectingTrackType = t.type;
        break;
      }
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#1a1a1a] text-white">
      <VolumeHud />
      <Group orientation="vertical">
        {/* Top half: Media Pool/Inspector + Preview Monitor */}
        <Panel defaultSize={50} minSize={25} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
          <Group orientation="horizontal">
            <Panel defaultSize={45} minSize={20} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
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
              <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                {leftTab === "pool" && <MediaPool />}
                {leftTab === "inspector" && inspectingTrackType === "video" && (
                  <>
                    {/* Video sub-tab bar */}
                    <div className="flex shrink-0 border-b border-white/10">
                      <button
                        onClick={() => setInspectorSubTab("pancrop")}
                        className={`px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider transition-colors ${
                          inspectorSubTab === "pancrop"
                            ? "border-b border-blue-400/60 text-white/80"
                            : "text-white/40 hover:text-white/60"
                        }`}
                      >
                        Pan/Crop
                      </button>
                      <button
                        onClick={() => setInspectorSubTab("videofx")}
                        className={`px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider transition-colors ${
                          inspectorSubTab === "videofx"
                            ? "border-b border-blue-400/60 text-white/80"
                            : "text-white/40 hover:text-white/60"
                        }`}
                      >
                        Video FX
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden min-h-0">
                      {inspectorSubTab === "pancrop" && <PanCropWindow />}
                      {inspectorSubTab === "videofx" && <VideoFxInspector />}
                    </div>
                  </>
                )}
                {leftTab === "inspector" && inspectingTrackType === "audio" && <AudioInspector />}
                {leftTab === "inspector" && inspectingTrackType === "text" && <TextInspector />}
                {leftTab === "inspector" && inspectingTrackType === "effect" && <FxInspector />}
                {leftTab === "inspector" && !inspectingTrackType && (
                  <div className="flex h-full flex-col items-center justify-center bg-[#1a1a1a] p-4">
                    <span className="text-xs text-white/30">Select a clip to inspect</span>
                  </div>
                )}
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

        {/* Middle: Timeline */}
        <Panel defaultSize={40} minSize={15} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
          <Timeline />
        </Panel>

        <Separator className="h-1 bg-white/10 transition-colors hover:bg-white/30" />

        {/* Bottom: Audio Mixer */}
        <Panel defaultSize={10} minSize={8} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
          <AudioMixer />
        </Panel>
      </Group>
    </div>
  );
}
