/**
 * components/feed/theater-cell.tsx — Backward-compatibility re-export.
 *
 * TheaterCell now lives in ./theater/TheaterPlayer (video/playback logic)
 * and ./theater/TheaterUI (overlays/interaction chrome).
 * This shim preserves all existing import paths.
 */
export { TheaterCell, fmtK, TX, type CellProps } from "./theater/TheaterPlayer";
