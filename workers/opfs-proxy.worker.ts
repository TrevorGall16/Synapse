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

interface OkResponse   { id: string; status: "ok" }
interface DataResponse { id: string; status: "ok"; buffer: ArrayBuffer }
interface ListResponse { id: string; status: "ok"; files: string[] }
interface ErrorResponse { id: string; status: "error"; message: string }
type WorkerOutMessage = OkResponse | DataResponse | ListResponse | ErrorResponse;

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

async function decodeProxy(
  videoData: ArrayBuffer,
  targetWidth: number,
  targetHeight: number,
): Promise<ArrayBuffer> {
  // Use VideoDecoder (WebCodecs) to extract the first keyframe as a proxy thumbnail.
  return new Promise<ArrayBuffer>((resolve, reject) => {
    // OffscreenCanvas for frame capture without DOM
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("OffscreenCanvas 2D context unavailable")); return; }

    let resolved = false;

    const decoder = new VideoDecoder({
      output: async (frame) => {
        if (resolved) { frame.close(); return; }
        try {
          ctx.drawImage(frame, 0, 0, targetWidth, targetHeight);
          frame.close();
          const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
          const buf = await blob.arrayBuffer();
          resolved = true;
          decoder.close();
          resolve(buf);
        } catch (e) {
          frame.close();
          reject(e);
        }
      },
      error: (e) => { reject(e); },
    });

    decoder.configure({ codec: "avc1.42001f" });

    // Wrap the raw video data in an EncodedVideoChunk and decode.
    // In practice this requires a valid encoded chunk — here we decode from raw H.264 data.
    const chunk = new EncodedVideoChunk({
      type: "key",
      timestamp: 0,
      data: videoData,
    });
    decoder.decode(chunk);
    decoder.flush().catch(reject);
  });
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
        await writeFile(msg.fileName, msg.buffer);
        reply({ id: msg.id, status: "ok" });
        break;
      }
      case "READ_FILE": {
        const buffer = await readFile(msg.fileName);
        // Transfer the ArrayBuffer (zero-copy) back to the main thread.
        const readReply: DataResponse = { id: msg.id, status: "ok", buffer };
        self.postMessage(readReply, { transfer: [buffer] });
        break;
      }
      case "DELETE_FILE": {
        await deleteFile(msg.fileName);
        reply({ id: msg.id, status: "ok" });
        break;
      }
      case "LIST_FILES": {
        const files = await listFiles();
        reply({ id: msg.id, status: "ok", files } as ListResponse);
        break;
      }
      case "DECODE_PROXY": {
        const buffer = await decodeProxy(msg.videoData, msg.targetWidth, msg.targetHeight);
        const decodeReply: DataResponse = { id: msg.id, status: "ok", buffer };
        self.postMessage(decodeReply, { transfer: [buffer] }); // Transfer ownership — zero-copy
        break;
      }
      default: {
        reply({ id: (msg as WorkerInMessage).id, status: "error", message: "Unknown message type" });
      }
    }
  } catch (err) {
    reply({
      id: msg.id,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
