// ── Video thumbnail extraction ─────────────────────────────
// Captures a single JPEG frame from a video source at
// min(1.0, duration/2). Runs fully on the main thread via an
// offscreen <video> + <canvas>. The result is a Blob ready to
// be persisted into IndexedDB and served back as an ObjectURL.
//
// Failures are soft: we resolve to null so callers can fall
// through to the next source in the chain (canonical URL →
// live frame capture → placeholder). We never throw.

/** Target thumbnail dimensions — 9:16 portrait matches feed card aspect. */
const THUMB_WIDTH = 360;
const THUMB_HEIGHT = 640;
const JPEG_QUALITY = 0.72;

/** Extract a single frame from the video URL as a JPEG Blob.
 *  Captures at min(1.0, duration/2) — far enough from frame 0 to
 *  skip leader/black frames, close enough to be deterministic.
 *  Resolves to null on any load/seek/encode failure. */
export async function extractThumbnail(videoUrl: string): Promise<Blob | null> {
  if (!videoUrl) return null;
  if (typeof document === "undefined") return null;

  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true;
  video.preload = "auto";
  // crossOrigin only applies to http(s) URLs; harmless for blob: URLs.
  video.crossOrigin = "anonymous";
  video.playsInline = true;

  try {
    // Wait for enough metadata that duration is known AND a frame is decodable.
    await new Promise<void>((resolve, reject) => {
      const onReady = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("video load failed")); };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    const seekTarget = Math.min(1.0, dur > 0 ? dur / 2 : 0);

    if (seekTarget > 0) {
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("seek failed")); };
        const cleanup = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
        video.currentTime = seekTarget;
      });
    }

    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Object-fit:cover equivalent so 16:9 sources don't letterbox the 9:16 thumb.
    const vw = video.videoWidth || THUMB_WIDTH;
    const vh = video.videoHeight || THUMB_HEIGHT;
    const scale = Math.max(THUMB_WIDTH / vw, THUMB_HEIGHT / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (THUMB_WIDTH - dw) / 2;
    const dy = (THUMB_HEIGHT - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    });
  } catch {
    return null;
  } finally {
    // Release decoder + buffer.
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * Extract the first decodable frame of a video Blob and return it as a JPEG
 * ArrayBuffer at the requested proxy dimensions.
 *
 * The earlier proxy path piped the raw container bytes into a Worker-side
 * `VideoDecoder` configured for raw H.264 NAL units. MP4 containers (the most
 * common case) failed to demux there, the worker fell through to its blank-
 * canvas fallback, and the editor persisted a 1.18 KB grey JPEG as the
 * "proxy" — visible as black-frame thumbnails everywhere downstream.
 *
 * We instead use a real `<video>` element + 2D canvas:
 *   1. Set src to a fresh ObjectURL of the source bytes.
 *   2. Wait for `loadeddata` so duration + first frame are committed.
 *   3. Seek to 0.1s and `await` the `seeked` event before drawing —
 *      currentTime=0 is unreliable; some browsers expose only an empty buffer
 *      until the first decoded frame is committed.
 *   4. Draw with object-fit:cover math, encode as JPEG.
 *
 * Resolves to `null` if the browser can't decode the file at all (corrupt
 * source, unsupported codec). Never throws — callers fall back gracefully.
 */
export async function extractProxyFrameFromBuffer(
  videoData: ArrayBuffer,
  mimeType: string,
  targetWidth: number,
  targetHeight: number,
): Promise<ArrayBuffer | null> {
  if (typeof document === "undefined") return null;

  const blob = new Blob([videoData], { type: mimeType || "video/mp4" });
  const url  = URL.createObjectURL(blob);

  const video = document.createElement("video");
  video.src        = url;
  video.muted      = true;
  video.playsInline = true;
  video.preload    = "auto";
  video.crossOrigin = "anonymous";

  try {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("video load failed")); };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    // Seek 0.1s in: avoids leader-black-frame corruption that some encoders
    // bake into frame 0, and forces the decoder to produce an actual frame
    // even on browsers that lazily defer the first paint.
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    const seekTarget = Math.min(0.1, dur > 0 ? Math.min(0.1, dur / 2) : 0);
    if (seekTarget > 0) {
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => { cleanup(); resolve(); };
        const onError  = () => { cleanup(); reject(new Error("seek failed")); };
        const cleanup  = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
        video.currentTime = seekTarget;
      });
    }

    // Belt-and-braces: even after `seeked` Chrome occasionally reports a
    // readyState of HAVE_METADATA and a videoWidth of 0 for a single tick.
    // Wait one rAF + canplaythrough for the frame to be committed before
    // calling drawImage, which would otherwise paint black.
    if (video.readyState < 2 || video.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 250);
        video.addEventListener("canplaythrough", () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width  = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Object-fit:cover math so the proxy shows a representative frame, not a
    // letterboxed thumbnail with grey bars.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(targetWidth / vw, targetHeight / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (targetWidth - dw) / 2;
    const dy = (targetHeight - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);

    const jpegBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8);
    });
    if (!jpegBlob) return null;
    return await jpegBlob.arrayBuffer();
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Capture the current visible frame of an already-playing <video> element
 *  as a JPEG Blob. Used as the runtime fallback when no persisted IDB
 *  thumbnail exists. Never throws. */
export async function captureLiveFrame(video: HTMLVideoElement): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  if (video.readyState < 2 /* HAVE_CURRENT_DATA */) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_WIDTH;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const vw = video.videoWidth || THUMB_WIDTH;
    const vh = video.videoHeight || THUMB_HEIGHT;
    const scale = Math.max(THUMB_WIDTH / vw, THUMB_HEIGHT / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (THUMB_WIDTH - dw) / 2;
    const dy = (THUMB_HEIGHT - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    });
  } catch {
    return null;
  }
}
