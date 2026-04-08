"use client";

/**
 * components/feed/share-sheet.tsx
 *
 * Shared glassmorphic share popover used by TheaterUI AND the Profile page.
 * Single component = single source of truth for:
 *   • canonical URL generation (via buildPostShareUrl / buildProfileCanonicalUrl)
 *   • optimistic "Copy Link" feedback
 *   • the exact list of social intents (Copy / X / WhatsApp)
 *   • the glassmorphic visual treatment
 *
 * Callers control placement + open state; the sheet itself handles the
 * clipboard + intent logic so behavior can never drift between surfaces.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { buildPostCanonicalUrl, buildProfileCanonicalUrl } from "@/lib/canonical";

export type ShareTarget =
  | { kind: "post";    id: string;       title: string }
  | { kind: "profile"; handle: string;   displayName: string };

interface ShareSheetProps {
  target: ShareTarget;
  open: boolean;
  onClose: () => void;
  /** Tailwind positioning classes — caller decides where the sheet anchors.
   *  Defaults to a centered fixed overlay (profile-page style). */
  positionClassName?: string;
  /** When true, renders a translucent full-screen backdrop behind the sheet
   *  that also closes on click. Profile uses this; Theater popover does not. */
  withBackdrop?: boolean;
}

/** Build the canonical share URL for either kind of target.
 *  Browser-aware: prefers window.location.origin so localhost devs get a
 *  link that actually opens on their own machine. */
function buildShareUrl(target: ShareTarget): string {
  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    return target.kind === "post"
      ? `${origin}/video/${target.id}`
      : `${origin}/profile/${target.handle}`;
  }
  return target.kind === "post"
    ? buildPostCanonicalUrl(target.id)
    : buildProfileCanonicalUrl(target.handle);
}

function buildShareText(target: ShareTarget, url: string): string {
  return target.kind === "post"
    ? `${target.title} — ${url}`
    : `Check out ${target.displayName} on Synapse — ${url}`;
}

export function ShareSheet({ target, open, onClose, positionClassName, withBackdrop = false }: ShareSheetProps) {
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside close (only when we're not rendering our own backdrop —
  // the backdrop already handles dismissal).
  useEffect(() => {
    if (!open || withBackdrop) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, withBackdrop, onClose]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset copied state whenever the sheet re-opens.
  useEffect(() => { if (open) { setCopied(false); setErrorMsg(null); } }, [open]);

  const handleCopy = useCallback(() => {
    const url = buildShareUrl(target);
    // Optimistic feedback: flip the ✓ state in the same frame as the click,
    // roll back only if the browser actually rejects the clipboard write.
    setCopied(true);
    setErrorMsg(null);
    setTimeout(() => setCopied(false), 1800);
    navigator.clipboard?.writeText(url).catch(() => {
      setCopied(false);
      setErrorMsg("Failed to copy");
    });
  }, [target]);

  const handleTwitter = useCallback(() => {
    const url = buildShareUrl(target);
    const text = target.kind === "post"
      ? `Check out "${target.title}" on Synapse`
      : `Check out ${target.displayName} on Synapse`;
    window.open(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    onClose();
  }, [target, onClose]);

  const handleWhatsApp = useCallback(() => {
    const url = buildShareUrl(target);
    const text = buildShareText(target, url);
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    onClose();
  }, [target, onClose]);

  if (!open) return null;

  const sheet = (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Share"
      className={[
        "z-[120] min-w-[220px] overflow-hidden rounded-2xl border border-white/20 py-2 shadow-2xl",
        positionClassName ?? "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
      ].join(" ")}
      style={{
        background: "rgba(20,20,20,0.72)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
      }}
    >
      <div className="px-4 pb-1 pt-1 text-[9px] font-bold uppercase tracking-widest text-white/35">Share</div>
      <button
        onClick={handleCopy}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-2.5 text-left text-[12px] font-semibold text-white/90 transition-colors hover:bg-white/10"
      >
        <span>Copy link</span>
        {copied
          ? <span className="text-emerald-400">✓ Copied</span>
          : errorMsg
            ? <span className="text-red-400">{errorMsg}</span>
            : <span className="text-white/30">⌘C</span>}
      </button>
      <button
        onClick={handleTwitter}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-[12px] font-semibold text-white/90 transition-colors hover:bg-white/10"
      >
        Share to X
      </button>
      <button
        onClick={handleWhatsApp}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-[12px] font-semibold text-white/90 transition-colors hover:bg-white/10"
      >
        Share to WhatsApp
      </button>
    </div>
  );

  if (!withBackdrop) return sheet;

  return (
    <div
      className="fixed inset-0 z-[115] flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {sheet}
    </div>
  );
}
