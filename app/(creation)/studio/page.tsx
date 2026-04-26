"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Group, Panel, Separator } from "react-resizable-panels";
import { MediaBin } from "@/components/studio/media-bin";
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
import { FocusedBreadcrumb } from "@/components/studio/focused-breadcrumb";
import { ProjectSettingsModal } from "@/components/studio/project-settings-modal";
import { HistoryPanel } from "@/components/studio/history-panel";
import { PresetPanel } from "@/components/studio/preset-panel";
import { useProjectStore } from "@/lib/store/project-store";
import { useMediaHydration } from "@/lib/hooks/use-media-hydration";
import { Film, Plus } from "lucide-react";

// ── Studio Splash Screen ───────────────────────────────
function StudioSplash({ onCreateProject }: { onCreateProject: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-[#121014]">
      <Film size={56} className="text-white/15" />
      <div className="text-center">
        <h2 className="text-lg font-bold text-white">No Project Open</h2>
        <p className="mt-1 text-xs text-white/40">Create a new project to begin editing</p>
      </div>
      <button
        data-testid="studio-create-project"
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
  const router = useRouter();
  const searchParams = useSearchParams();

  // Focused workspace mode: explicit param from dashboard, OR when the studio
  // is opened from an external entry (remix, link) without the dashboard context.
  // The multi-tab strip only shows when navigating FROM the dashboard.
  const fromDashboard = searchParams.get("from") === "dashboard";
  const isFocused = searchParams.get("workspace") === "focused" || !fromDashboard;
  const isNewInit = searchParams.get("init") === "new";
  const dashFilter = searchParams.get("dashFilter") || "";

  // projectStarted: true once the user explicitly clicks "Create New Project"
  // showSplash is false whenever: the user started a project OR any track already has clips
  // (the latter covers Remix navigation — loadProject populates tracks before route change)
  const [projectStarted, setProjectStarted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { isHydrating } = useMediaHydration();

  const handleBackToDashboard = () => {
    const params = new URLSearchParams();
    if (dashFilter) params.set("filter", dashFilter);
    const qs = params.toString();
    router.push(`/studio/dashboard${qs ? `?${qs}` : ""}`);
  };

  const leftTab = useProjectStore((s) => s.activeUISection);
  const setLeftTab = useProjectStore((s) => s.setActiveUISection);
  const inspectingClipId = useProjectStore((s) => s.inspectingClipId);
  const inspectorSubTab = useProjectStore((s) => s.inspectorSubTab);
  const setInspectorSubTab = useProjectStore((s) => s.setInspectorSubTab);
  const tracks = useProjectStore((s) => s.tracks);
  const fxMaskEditingClipId = useProjectStore((s) => s.fxMaskEditingClipId);
  const projectId = useProjectStore((s) => s.projectId);

  // When hydration finishes and a projectId exists, bypass the splash automatically
  useEffect(() => {
    if (!isHydrating && projectId) setProjectStarted(true);
  }, [isHydrating, projectId]);

  // Auto-open project settings for genuinely new projects ONLY.
  // Previously this fired whenever init=new appeared in the URL — but the param
  // survives reload, so F5 on an in-progress project re-popped the resolution
  // dialog and clobbered the user's edits. Gate it on "tracks have no clips":
  // the moment any clip exists this is no longer a fresh canvas.
  useEffect(() => {
    if (!isNewInit || isHydrating || !projectId) return;
    const fresh = useProjectStore.getState().tracks.every((t) => t.clips.length === 0);
    if (fresh) setShowSettings(true);
  // Run-once on mount when init=new — intentionally omit `tracks` from deps so
  // adding a clip later doesn't retro-trigger the modal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewInit, isHydrating, projectId]);

  // NOTE: A previous "Silently re-hydrate stale media when switching tabs"
  // useEffect lived here and matched `m.previewUrl.startsWith("blob:")`.
  // That predicate treated already-valid, freshly-minted ObjectURLs as stale
  // and refreshed them on every tab switch, which (a) leaked the prior
  // blob URL, and (b) mutated `mediaPool` → tripped GlobalHydrator's
  // subscribe → scheduled a doSave → flipped SaveBarrierOverlay every few
  // seconds, which looked like a whole-route flash. `useMediaHydration`
  // above already restores URLs whose `previewUrl` is empty (the only
  // genuine post-reload stale case), so the duplicate effect is gone.

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
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#121014]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
        <p className="text-xs font-semibold text-white/40">Waiting for Disk...</p>
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
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#121014] text-white">
      {showSettings && <ProjectSettingsModal onClose={() => setShowSettings(false)} />}
      <VolumeHud />
      {isFocused ? (
        <FocusedBreadcrumb onNavigateDashboard={handleBackToDashboard} />
      ) : (
        <StudioTabs />
      )}
      <div className="flex-1 overflow-hidden min-h-0">
      <Group orientation="vertical">
        {/* Top section: Media Pool/Inspector + Preview Monitor */}
        <Panel defaultSize={57} minSize={25} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
          <Group orientation="horizontal">
            <Panel defaultSize={30} minSize={18} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
              {/* Tab bar */}
              <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1.5">
                <button
                  onClick={() => setLeftTab("pool")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    leftTab === "pool"
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  Media Bin
                </button>
                <button
                  onClick={() => setLeftTab("inspector")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    leftTab === "inspector"
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  Inspector
                </button>
                <button
                  onClick={() => setLeftTab("history")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    leftTab === "history"
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  History
                </button>
                <button
                  onClick={() => setLeftTab("presets")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    leftTab === "presets"
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  Presets
                </button>
              </div>
              {/* Tab content */}
              <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
                {leftTab === "pool" && <MediaBin />}
                {leftTab === "inspector" && inspectingTrackType === "video" && (
                  <>
                    {/* Video sub-tab bar */}
                    <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2 py-1">
                      <button
                        onClick={() => setInspectorSubTab("pancrop")}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          inspectorSubTab === "pancrop"
                            ? "bg-white/10 text-white"
                            : "text-white/40 hover:bg-white/5 hover:text-white/70"
                        }`}
                      >
                        Pan/Crop
                      </button>
                      <button
                        onClick={() => setInspectorSubTab("videofx")}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          inspectorSubTab === "videofx"
                            ? "bg-white/10 text-white"
                            : "text-white/40 hover:bg-white/5 hover:text-white/70"
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
                  <div className="flex h-full flex-col items-center justify-center p-4">
                    <span className="text-xs text-white/30">Select a clip to inspect</span>
                  </div>
                )}
                {leftTab === "history" && <HistoryPanel />}
                {leftTab === "presets" && <PresetPanel />}
              </div>
            </Panel>
            <Separator className="w-1.5 bg-white/5 transition-colors hover:bg-[#ff007a]/40 cursor-col-resize" />
            <Panel defaultSize={70} minSize={25} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
              <PreviewMonitor />
            </Panel>
          </Group>
        </Panel>

        {/* Horizontal resize handle */}
        <Separator className="h-1.5 bg-white/5 transition-colors hover:bg-[#ff007a]/40 cursor-row-resize" />

        {/* Timeline */}
        <Panel defaultSize={35} minSize={15} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
          <Timeline />
        </Panel>

        <Separator className="h-1.5 bg-white/5 transition-colors hover:bg-[#ff007a]/40 cursor-row-resize" />

        {/* Audio Mixer */}
        <Panel defaultSize={8} minSize={6} className="flex flex-col h-full w-full overflow-hidden min-w-0 min-h-0">
          <AudioMixer />
        </Panel>
      </Group>
      </div>
    </div>
  );
}
