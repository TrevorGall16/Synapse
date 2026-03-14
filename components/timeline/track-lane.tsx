interface TrackLaneProps {
  trackId: string;
}

export function TrackLane({ trackId }: TrackLaneProps) {
  return (
    <div
      className="min-h-[48px] flex-1 border-b border-white/5 bg-[#1e1e1e]"
      data-track={trackId}
    />
  );
}
