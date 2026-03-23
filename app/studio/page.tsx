"use client";

import { useState, useEffect } from "react";
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
import { StudioTabs } from "@/components/studio/studio-tabs";
import { ProjectSettingsModal } from "@/components/studio/project-settings-modal";
import { HistoryPanel } from "@/components/studio/history-panel";
import { useProjectStore } from "@/lib/store/project-store";
import { useMediaHydration } from "@/lib/hooks/use-media-hydration";
import { refreshMediaUrl } from "@/lib/store/media-pool-db";
import { Film, Plus } from "lucide-react";

// ── Studio Splash Screen ───────────────────────────────
function StudioSplash({ onCreateProject }: { onCreateProject: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-[#141414]">
      <Film size={56} className="text-white/15" />
      <div className="text-center">
        <h2 className="text-lg font-bold text-white">No Project Open</h2>
        <p className="mt-1 text-xs text-white/40">Create a new project to begin editing</p>
      </div>
      <button
        onClick={onCreateProject}
        className="flex items-center gap-2 rounded-lg bg-white/10 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/20"
      >
        <Plus size={16} />
        Create New Project
      </button>
    </div>
  );
}

export default function StudioPage() {
  // projectStarted: true once the user explicitly clicks "Create New Project"
  // showSplash is false whenever: the user started a project OR any track already has clips
  // (the latter covers Remix navigation — loadProject populates tracks before route change)
  const [projectStarted, setProjectStarted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { isHydrating } = useMediaHydration();

  const leftTab = useProjectStore((s) => s.activeUISection);
  const setLeftTab = useProjectStore((s) => s.setActiveUISection);
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const inspectorSubTab = useProjectStore((s) => s.inspectorSubTab);
  const setInspectorSubTab = useProjectStore((s) => s.setInspectorSubTab);
  const tracks = useProjectStore((s) => s.tracks);
  const fxMaskEditingClipId = useProjectStore((s) => s.fxMaskEditingClipId);
  const projectId = useProjectStore((s) => s.projectId);
  const updateMediaItemUrl = useProjectStore((s) => s.updateMediaItemUrl);

  // When hydration finishes and a projectId exists, bypass the splash automatically
  useEffect(() => {
    if (!isHydrating && projectId) setProjectStarted(true);
  }, [isHydrating, projectId]);

  // Silently re-hydrate stale media when switching tabs
  useEffect(() => {
    const { mediaPool } = useProjectStore.getState();
    const stale = mediaPool.filter((m) => !m.previewUrl || m.previewUrl.startsWith("blob:"));
    if (!stale.length) return;
    Promise.all(stale.map(async (item) => {
      const url = await refreshMediaUrl(item.id);
      if (url) updateMediaItemUrl(item.id, url);
    })).catch(console.warn);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const hasContent = tracks.some((t) => t.clips.length > 0);
  const showSplash = !projectStarted && !hasContent && !projectId;

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

  if (isHydrating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#141414]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
        <p className="text-xs font-semibold text-white/40">Waiting for Disk…</p>
      </div>
    );
  }

  if (showSplash) {
    return (
      <>
        <StudioSplash onCreateProject={() => { setProjectStarted(true); setShowSettings(true); }} />
        {showSettings && (
          <ProjectSettingsModal onClose={() => setShowSettings(false)} />
        )}
      </>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#1a1a1a] text-white">
      {showSettings && <ProjectSettingsModal onClose={() => setShowSettings(false)} />}
      <VolumeHud />
      <StudioTabs />
      <div className="flex-1 overflow-hidden min-h-0">
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
                <button
                  onClick={() => setLeftTab("history")}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    leftTab === "history"
                      ? "border-b-2 border-white/60 text-white/80"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  History
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
                {leftTab === "inspector" && inspectingTrackType === "effect" && (
                  fxMaskEditingClipId ? <PanCropWindow /> : <FxInspector />
                )}
                {leftTab === "inspector" && !inspectingTrackType && (
                  <div className="flex h-full flex-col items-center justify-center bg-[#1a1a1a] p-4">
                    <span className="text-xs text-white/30">Select a clip to inspect</span>
                  </div>
                )}
                {leftTab === "history" && <HistoryPanel />}
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
    </div>
  );
}
