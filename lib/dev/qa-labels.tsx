// ── QA Overlay Labels ──────────────────────────────────────────────────────
// Tiny, absolutely-positioned red badges that mark UI zones during developer
// QA passes. Flip the `QA_LABELS_ENABLED` constant to `false` (or set the
// `NEXT_PUBLIC_QA_LABELS` env var to anything other than "1") to remove every
// badge in one motion. The component renders nothing at all when disabled, so
// it costs zero DOM weight in shipping builds.

import { memo } from "react";

const ENV_FLAG = (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_QA_LABELS : undefined);
/**
 * Master switch. Default ON during the active QA phase the user requested.
 * Set `NEXT_PUBLIC_QA_LABELS=0` to disable without touching code, or change
 * the fallback below to `false` to ship with the labels off.
 */
export const QA_LABELS_ENABLED: boolean = ENV_FLAG === undefined ? true : ENV_FLAG === "1";

interface QaLabelProps {
  /** Short uppercase tag — e.g. "MONITOR", "TIMELINE". */
  text: string;
  /** Corner anchor; defaults to top-left. */
  position?: "tl" | "tr" | "bl" | "br";
}

const POS_CLASS: Record<NonNullable<QaLabelProps["position"]>, string> = {
  tl: "top-1 left-1",
  tr: "top-1 right-1",
  bl: "bottom-1 left-1",
  br: "bottom-1 right-1",
};

/**
 * QA zone badge. Renders nothing when QA_LABELS_ENABLED is false, so callers
 * can leave it in the JSX permanently without conditional wrapping at the
 * call site.
 */
export const QaLabel = memo(function QaLabel({ text, position = "tl" }: QaLabelProps) {
  if (!QA_LABELS_ENABLED) return null;
  return (
    <span
      className={`pointer-events-none absolute ${POS_CLASS[position]} z-50 bg-red-500 text-white text-[10px] font-mono px-1`}
      aria-hidden
    >
      {text}
    </span>
  );
});
