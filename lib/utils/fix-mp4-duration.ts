// lib/utils/fix-mp4-duration.ts
//
// Patch the duration field of every duration-bearing box in an MP4 file
// produced by `MediaRecorder`. Chrome's MP4 muxer ships with `duration = 0`
// in `mvhd`, `tkhd`, and `mdhd`, which leaves desktop players (VLC, Quicktime,
// Windows Media Player) unable to compute total runtime — the playbar stays
// frozen at 0:00 even though the audio/video data is intact.
//
// We walk the ISO-BMFF box tree looking for `moov` (top-level), then descend
// into its `mvhd` (movie header) and each `trak.tkhd` + `trak.mdia.mdhd`
// (track headers and media headers), overwriting the in-place duration field
// with the correct microsecond-derived value scaled by each box's timescale.
//
// Spec references: ISO/IEC 14496-12 §8.2.2 (mvhd), §8.3.2 (tkhd), §8.4.2 (mdhd).
//
// We DO NOT recreate the file, re-mux, or move bytes — only the four-/eight-
// byte duration field is rewritten in place. That keeps the operation O(box
// count) and side-effect-free for every other downstream property.

const TYPE_MOOV = 0x6d_6f_6f_76; // "moov"
const TYPE_MVHD = 0x6d_76_68_64; // "mvhd"
const TYPE_TRAK = 0x74_72_61_6b; // "trak"
const TYPE_TKHD = 0x74_6b_68_64; // "tkhd"
const TYPE_MDIA = 0x6d_64_69_61; // "mdia"
const TYPE_MDHD = 0x6d_64_68_64; // "mdhd"

interface Box {
  /** Offset of the box header (size+type), inclusive. */
  start: number;
  /** Offset of the byte just past this box. */
  end: number;
  /** Offset of the first content byte (i.e. start + header bytes). */
  contentStart: number;
  type: number;
}

/** Walk children of a container box, yielding each child as a Box. */
function* walkChildren(view: DataView, parent: Box): Generator<Box> {
  let off = parent.contentStart;
  while (off + 8 <= parent.end) {
    const size = view.getUint32(off, false);
    const type = view.getUint32(off + 4, false);
    let contentStart = off + 8;
    let actualSize = size;
    if (size === 1) {
      // 64-bit large size follows the 32-bit type field.
      const hi = view.getUint32(off + 8, false);
      const lo = view.getUint32(off + 12, false);
      actualSize = hi * 0x1_0000_0000 + lo;
      contentStart = off + 16;
    } else if (size === 0) {
      // Box extends to end of parent — the spec allows this only for the
      // top-level "mdat" box, but we honor it defensively here.
      actualSize = parent.end - off;
    }
    const end = off + actualSize;
    if (end <= off || end > parent.end) break; // malformed — stop walking
    yield { start: off, end, contentStart, type };
    off = end;
  }
}

/** Read a 32- or 64-bit unsigned big-endian integer from a DataView. */
function readU(view: DataView, offset: number, bytes: 4 | 8): number {
  if (bytes === 4) return view.getUint32(offset, false);
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  return hi * 0x1_0000_0000 + lo;
}

/** Write a 32- or 64-bit unsigned big-endian integer into a DataView. */
function writeU(view: DataView, offset: number, value: number, bytes: 4 | 8): void {
  if (bytes === 4) { view.setUint32(offset, value, false); return; }
  const hi = Math.floor(value / 0x1_0000_0000);
  const lo = value >>> 0;
  view.setUint32(offset, hi, false);
  view.setUint32(offset + 4, lo, false);
}

/** Patch mvhd (movie header). v0 → 32-bit fields, v1 → 64-bit fields.
 *  Layout: version(1) flags(3) creation(4|8) modification(4|8) timescale(4) duration(4|8). */
function patchMvhd(view: DataView, box: Box, durationSeconds: number): void {
  const version = view.getUint8(box.contentStart);
  const isV1 = version === 1;
  const tsOffset = box.contentStart + 4 + (isV1 ? 16 : 8);
  const durationOffset = tsOffset + 4;
  const timescale = view.getUint32(tsOffset, false);
  if (timescale === 0) return;
  const newDuration = Math.round(durationSeconds * timescale);
  writeU(view, durationOffset, newDuration, isV1 ? 8 : 4);
}

/** Patch tkhd (track header). v0/v1 select 32/64 bit duration after the
 *  track_id+reserved fields. Layout: version(1) flags(3) creation(4|8)
 *  modification(4|8) track_id(4) reserved(4) duration(4|8). */
function patchTkhd(view: DataView, box: Box, durationSeconds: number, movieTimescale: number): void {
  const version = view.getUint8(box.contentStart);
  const isV1 = version === 1;
  const durationOffset = box.contentStart + 4 + (isV1 ? 16 : 8) + 4 + 4;
  const newDuration = Math.round(durationSeconds * movieTimescale);
  writeU(view, durationOffset, newDuration, isV1 ? 8 : 4);
}

/** Patch mdhd (media header). Has its own per-track timescale.
 *  Layout: version(1) flags(3) creation(4|8) modification(4|8) timescale(4) duration(4|8). */
function patchMdhd(view: DataView, box: Box, durationSeconds: number): void {
  const version = view.getUint8(box.contentStart);
  const isV1 = version === 1;
  const tsOffset = box.contentStart + 4 + (isV1 ? 16 : 8);
  const durationOffset = tsOffset + 4;
  const timescale = view.getUint32(tsOffset, false);
  if (timescale === 0) return;
  const newDuration = Math.round(durationSeconds * timescale);
  writeU(view, durationOffset, newDuration, isV1 ? 8 : 4);
}

/**
 * Patch every duration-bearing header in an MP4 Blob so desktop players show
 * the correct runtime. Returns a fresh Blob; the input is not modified.
 *
 * On any parsing failure (malformed box tree, missing moov, unsupported size
 * encoding) we resolve to the original blob unchanged — better to ship a file
 * with a missing playbar than to corrupt the bytes. The export modal logs and
 * downloads the unpatched blob in that case.
 */
export async function fixMp4Duration(blob: Blob, durationMs: number): Promise<Blob> {
  if (durationMs <= 0) return blob;
  const buffer = await blob.arrayBuffer();
  // Copy into a writable buffer so the original Blob's backing memory (which
  // may be shared) isn't mutated.
  const writable = buffer.slice(0);
  const view = new DataView(writable);

  // Build a synthetic "root" so walkChildren() can iterate top-level boxes.
  const root: Box = { start: 0, end: writable.byteLength, contentStart: 0, type: 0 };

  let moov: Box | null = null;
  for (const child of walkChildren(view, root)) {
    if (child.type === TYPE_MOOV) { moov = child; break; }
  }
  if (!moov) return blob; // No moov — likely a fragmented MP4 we can't patch here.

  const durationSeconds = durationMs / 1000;

  // Locate mvhd first to learn the movie timescale needed by tkhd.
  let movieTimescale = 0;
  for (const child of walkChildren(view, moov)) {
    if (child.type === TYPE_MVHD) {
      const version = view.getUint8(child.contentStart);
      const isV1 = version === 1;
      const tsOffset = child.contentStart + 4 + (isV1 ? 16 : 8);
      movieTimescale = view.getUint32(tsOffset, false);
      patchMvhd(view, child, durationSeconds);
      break;
    }
  }

  if (movieTimescale > 0) {
    for (const child of walkChildren(view, moov)) {
      if (child.type !== TYPE_TRAK) continue;
      for (const trakChild of walkChildren(view, child)) {
        if (trakChild.type === TYPE_TKHD) {
          patchTkhd(view, trakChild, durationSeconds, movieTimescale);
        } else if (trakChild.type === TYPE_MDIA) {
          for (const mdiaChild of walkChildren(view, trakChild)) {
            if (mdiaChild.type === TYPE_MDHD) {
              patchMdhd(view, mdiaChild, durationSeconds);
            }
          }
        }
      }
    }
  }

  return new Blob([writable], { type: blob.type });
}

/** Test-only helpers — exported so the unit test suite can poke the parser
 *  without having to construct entire MP4 files. Not part of the public API. */
export const __mp4Internals = { walkChildren, readU, writeU };
