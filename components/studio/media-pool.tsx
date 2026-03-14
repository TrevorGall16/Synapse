export function MediaPool() {
  return (
    <div className="flex h-full flex-col border-t border-white/20 bg-[#1a1a1a]">
      <div className="shrink-0 border-b border-white/10 px-4 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-white/60">
          Media Pool
        </h2>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        <p className="text-sm text-white/30">
          Drop files or link a folder to begin
        </p>
      </div>
    </div>
  );
}
