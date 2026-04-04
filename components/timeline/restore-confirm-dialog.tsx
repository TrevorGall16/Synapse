"use client";

import { useProjectStore } from "@/lib/store/project-store";
import { canRestoreOriginal } from "@/lib/store/project-helpers";

interface RestoreConfirmDialogProps {
  onClose: () => void;
}

/**
 * Shared AlertDialog for Restore Original confirmation.
 * Used by context menu and toolbar button.
 * Reads selected clips / media pool from the store at render time.
 */
export function RestoreConfirmDialog({ onClose }: RestoreConfirmDialogProps) {
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const tracks = useProjectStore((s) => s.tracks);
  const mediaPool = useProjectStore((s) => s.mediaPool);

  const selectedClips = tracks.flatMap((t) => t.clips).filter((c) => selectedClipIds.includes(c.id));
  const canRestore = canRestoreOriginal(selectedClipIds, tracks);

  if (!canRestore || selectedClips.length === 0) {
    onClose();
    return null;
  }

  const media = mediaPool.find((m) => m.id === selectedClips[0].sourceId);
  const mediaName = media?.name ?? selectedClips[0].sourceId;
  const formatTimeSec = (us: number) => `${(us / 1_000_000).toFixed(2)}s`;
  const earliest = Math.min(...selectedClips.map((c) => c.startTime));
  const latest = Math.max(...selectedClips.map((c) => c.startTime + c.duration));

  const onConfirm = () => {
    useProjectStore.getState().restoreOriginalClips(selectedClips.map((c) => c.id));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60">
      <div className="w-80 rounded-xl border border-white/15 bg-[#1e1e1e] p-5 shadow-2xl shadow-black/80">
        <p className="mb-1 text-[13px] font-semibold text-white">Restore Original Clip</p>
        <p className="mb-4 text-[11px] leading-relaxed text-white/60">
          Revert <span className="font-medium text-white/80">{selectedClips.length} fragment{selectedClips.length !== 1 ? "s" : ""}</span> of{" "}
          <span className="font-medium text-white/80">&apos;{mediaName}&apos;</span> between{" "}
          <span className="tabular-nums text-white/80">{formatTimeSec(earliest)}</span> –{" "}
          <span className="tabular-nums text-white/80">{formatTimeSec(latest)}</span> to one uncut clip?
          All cuts and edits within this range will be removed.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-blue-500"
          >
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
