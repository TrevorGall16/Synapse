// workers/opfs-proxy.worker.ts
// OPFS proxy worker — handles all file I/O and video proxy generation.
// All heavy work (ArrayBuffer reads/writes, frame extraction) is off the main thread.
// Communication is strictly via postMessage — no main-thread fallbacks.

// ── Message Types ──────────────────────────────────────────────────────────────

interface WriteFileMsg  { type: "WRITE_FILE";  id: string; fileName: string; buffer: ArrayBuffer }
interface ReadFileMsg   { type: "READ_FILE";   id: string; fileName: string }
interface DeleteFileMsg { type: "DELETE_FILE"; id: string; fileName: string }
interface ListFilesMsg  { type: "LIST_FILES";  id: string }
interface DecodeProxyMsg {
  type: "DECODE_PROXY";
  id: string;
  videoData: ArrayBuffer;
  /** Target proxy dimensions (smaller = faster scrubbing). */
  targetWidth: number;
  targetHeight: number;
}

type WorkerInMessage = WriteFileMsg | ReadFileMsg | DeleteFileMsg | ListFilesMsg | DecodeProxyMsg;

interface OkResponse    { id: string; status: "ok" }
interface DataResponse  { id: string; status: "ok"; buffer: ArrayBuffer }
interface ListResponse  { id: string; status: "ok"; files: string[] }
interface ErrorResponse { id: string; status: "error"; message: string }

/** Explicit contract for DECODE_PROXY success — jpegBuf is the zero-copy transfer target. */
interface DecodeSuccessResponse { ok: true;  id: string; jpegBuf: ArrayBuffer }
/** Explicit contract for DECODE_PROXY failure — no buffer transferred. */
interface DecodeFailureResponse { ok: false; id: string; error: string }

type WorkerOutMessage =
  | OkResponse
  | DataResponse
  | ListResponse
  | ErrorResponse
  | DecodeSuccessResponse
  | DecodeFailureResponse;

// ── Audit Event Emission ───────────────────────────────────────────────────────
// Emits structured audit events as a SEPARATE postMessage path.
// Main thread branches on __auditEvent before normal response routing.
// The worker always emits; the main-thread bridge decides whether to capture.

function emitAuditEvent(type: string, id: string, meta?: unknown): void {
  self.postMessage({ __auditEvent: true, type, id, ts: Date.now(), meta });
}

// ── OPFS Helpers ───────────────────────────────────────────────────────────────

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

async function getSubDir(dirName: string): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot();
  return root.getDirectoryHandle(dirName, { create: true });
}

async function writeFile(fileName: string, buffer: ArrayBuffer): Promise<void> {
  const dir = await getSubDir("proxies");
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(buffer);
  await writable.close();
}

async function readFile(fileName: string): Promise<ArrayBuffer> {
  const dir = await getSubDir("proxies");
  const fileHandle = await dir.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

async function deleteFile(fileName: string): Promise<void> {
  const dir = await getSubDir("proxies");
  await dir.removeEntry(fileName);
}

async function listFiles(): Promise<string[]> {
  const dir = await getSubDir("proxies");
  const names: string[] = [];
  const iterable = dir as unknown as AsyncIterable<[string, FileSystemHandle]>;
  for await (const [name] of iterable) {
    names.push(name);
  }
  return names;
}

// ── Video Proxy Decoding ───────────────────────────────────────────────────────

/**
 * Create a minimal JPEG from a blank OffscreenCanvas.
 * Used as a fallback when VideoDecoder cannot process the input data
 * (e.g. the caller supplied an MP4 container instead of raw NAL units).
 */
async function createFallbackJpeg(width: number, height: number): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, width, height);
  }
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.6 });
  return blob.arrayBuffer();
}

/**
 * Attempt to extract the first keyframe via WebCodecs VideoDecoder.
 * Rejects if the input cannot be decoded (wrong format, unsupported codec, etc.).
 */
async function decodeViaVideoDecoder(
  videoData: ArrayBuffer,
  targetWidth: number,
  targetHeight: number,
): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("OffscreenCanvas 2D context unavailable")); return; }

    let settled = false;

    /** Guard: only resolve/reject the outer Promise once. */
    const settle = (result: ArrayBuffer | null, err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err != null) reject(err instanceof Error ? err : new Error(String(err)));
      else if (result != null) resolve(result);
    };

    const decoder = new VideoDecoder({
      output: async (frame) => {
        if (settled) { frame.close(); return; }
        try {
          ctx.drawImage(frame, 0, 0, targetWidth, targetHeight);
          frame.close();
          const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
          settle(await blob.arrayBuffer());
          try { decoder.close(); } catch { /* may throw if already errored */ }
        } catch (e) {
          frame.close();
          settle(null, e);
        }
      },
      error: (e) => settle(null, e),
    });

    decoder.configure({ codec: "avc1.42001f" });

    const chunk = new EncodedVideoChunk({
      type: "key",
      timestamp: 0,
      data: videoData,
    });
    decoder.decode(chunk);
    decoder.flush().catch((e) => settle(null, e));
  });
}

/**
 * Decode a video's first keyframe into a JPEG proxy thumbnail.
 * Tries VideoDecoder (WebCodecs) first; falls back to a blank canvas JPEG
 * when the input cannot be decoded (e.g., full MP4 container vs raw NAL units).
 * Always resolves to a valid ArrayBuffer — never rejects on success path.
 */
async function decodeProxy(
  videoData: ArrayBuffer,
  targetWidth: number,
  targetHeight: number,
): Promise<ArrayBuffer> {
  try {
    return await decodeViaVideoDecoder(videoData, targetWidth, targetHeight);
  } catch {
    // VideoDecoder failed (unsupported input format, codec error, etc.)
    // — fall back to a placeholder proxy so the write pipeline can proceed.
    return createFallbackJpeg(targetWidth, targetHeight);
  }
}

// ── Message Dispatcher ─────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  const reply = (payload: WorkerOutMessage) => {
    self.postMessage(payload);
  };

  try {
    switch (msg.type) {
      case "WRITE_FILE": {
        emitAuditEvent("write_start", msg.id, { fileName: msg.fileName });
        await writeFile(msg.fileName, msg.buffer);
        emitAuditEvent("write_done", msg.id, { fileName: msg.fileName });
        reply({ id: msg.id, status: "ok" });
        break;
      }
      case "READ_FILE": {
        emitAuditEvent("read_start", msg.id, { fileName: msg.fileName });
        const buffer = await readFile(msg.fileName);
        emitAuditEvent("read_done", msg.id, { byteLength: buffer.byteLength });
        // Transfer the ArrayBuffer (zero-copy) back to the main thread.
        const readReply: DataResponse = { id: msg.id, status: "ok", buffer };
        self.postMessage(readReply, { transfer: [buffer] });
        break;
      }
      case "DELETE_FILE": {
        emitAuditEvent("delete_start", msg.id, { fileName: msg.fileName });
        await deleteFile(msg.fileName);
        emitAuditEvent("delete_done", msg.id);
        reply({ id: msg.id, status: "ok" });
        break;
      }
      case "LIST_FILES": {
        const files = await listFiles();
        reply({ id: msg.id, status: "ok", files } as ListResponse);
        break;
      }
      case "DECODE_PROXY": {
        emitAuditEvent("decode_start", msg.id, { targetWidth: msg.targetWidth, targetHeight: msg.targetHeight });
        const jpegBuf = await decodeProxy(msg.videoData, msg.targetWidth, msg.targetHeight);
        emitAuditEvent("decode_done", msg.id, { byteLength: jpegBuf.byteLength });
        // Explicit contract: ok/jpegBuf — zero-copy transfer of the JPEG buffer.
        const decodeReply: DecodeSuccessResponse = { ok: true, id: msg.id, jpegBuf };
        self.postMessage(decodeReply, { transfer: [jpegBuf] });
        break;
      }
      default: {
        reply({ id: (msg as WorkerInMessage).id, status: "error", message: "Unknown message type" });
      }
    }
  } catch (err) {
    // For DECODE_PROXY failures, use the ok/error contract.
    if (msg.type === "DECODE_PROXY") {
      const failReply: DecodeFailureResponse = {
        ok: false,
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(failReply);
    } else {
      reply({
        id: msg.id,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
