export function PreviewMonitor() {
  return (
    <div className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
      <div className="shrink-0 border-b border-white/10 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">
          Preview
        </h2>
      </div>
      <div className="flex flex-1 items-center justify-center">
        {/* Future WebGPU canvas mount point */}
        <div className="aspect-video w-full max-w-lg bg-[#111111] rounded" />
      </div>
      <div className="shrink-0 border-t border-white/10 px-4 py-2 text-center">
        <span className="text-xs tabular-nums text-white/40">00:00.000</span>
      </div>
    </div>
  );
}
