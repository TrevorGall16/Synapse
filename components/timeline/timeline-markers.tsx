"use client";

import { useProjectStore } from "@/lib/store/project-store";
import { usePlaybackStore } from "@/lib/store/playback-store";

/** Orange vertical marker lines spanning the full track area.
 *  Placed in the same absolute overlay as <Playhead /> so they cross all tracks. */
export function TimelineMarkers() {
  const markers = useProjectStore((s) => s.markers);
  const pps = usePlaybackStore((s) => s.pixelsPerSecond);

  if (!markers.length) return null;

  return (
    <>
      {markers.map((marker) => {
        const xPx = (marker.time / 1_000_000) * pps;
        return (
          <div
            key={marker.id}
            className="pointer-events-none absolute top-0 z-10 flex flex-col items-center"
            style={{ left: xPx, height: "100%" }}
          >
            {/* Marker line */}
            <div
              className="w-px"
              style={{
                height: "100%",
                background: marker.color,
                opacity: 0.75,
                boxShadow: `0 0 4px ${marker.color}60`,
              }}
            />
            {/* Marker flag (tiny triangle at top) */}
            <div
              className="absolute top-0 -translate-x-1/2"
              style={{
                width: 0,
                height: 0,
                borderLeft: "4px solid transparent",
                borderRight: "4px solid transparent",
                borderTop: `6px solid ${marker.color}`,
              }}
            />
          </div>
        );
      })}
    </>
  );
}
