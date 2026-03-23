import { buildChromaticAberrationFilter } from "@/lib/utils/svg-filters";

// Computed once at module evaluation time — no client-side work needed.
const CA_FILTER = buildChromaticAberrationFilter("synapse-ca", 5, 1);

/**
 * Injects global SVG filter definitions and CSS keyframe animations into the document.
 * Rendered once in root layout. Filters are referenced by ID throughout the app.
 *
 * Filters defined:
 *   #synapse-ca        — Chromatic aberration (feOffset per RGB channel)
 *
 * Animations defined:
 *   synapse-strobe     — Rapid brightness 10 / 0 toggle
 *   synapse-glitch     — Horizontal translate + skew jitter
 */
export function GlobalSvgFilters() {
  return (
    <>
      {/* Hidden SVG — url(#synapse-ca) referenced by CSS filter on video elements */}
      <svg
        aria-hidden
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
        dangerouslySetInnerHTML={{ __html: `<defs>${CA_FILTER}</defs>` }}
      />
      <style>{`
        @keyframes synapse-strobe {
          0%,  49.9% { filter: brightness(10) saturate(1.2); }
          50%, 100%  { filter: brightness(0); }
        }
        @keyframes synapse-glitch {
          0%   { transform: translateX(0)    skewX(0);       }
          14%  { transform: translateX(-8px) skewX(0.6deg);  }
          28%  { transform: translateX(5px)  skewX(-0.4deg); }
          43%  { transform: translateX(-5px) skewX(0.2deg);  }
          57%  { transform: translateX(9px)  skewX(-0.5deg); }
          71%  { transform: translateX(-4px) skewX(0.3deg);  }
          85%  { transform: translateX(6px)  skewX(-0.1deg); }
          100% { transform: translateX(0)    skewX(0);       }
        }
      `}</style>
    </>
  );
}
