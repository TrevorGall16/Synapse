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
