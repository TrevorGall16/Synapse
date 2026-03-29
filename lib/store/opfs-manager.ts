// lib/store/opfs-manager.ts
// Main-thread bridge to workers/opfs-proxy.worker.ts.
// All OPFS operations must go through this manager — never call OPFS APIs directly
// from the main thread for heavy decoding/proxy work.

let _worker: Worker | null = null;
let _pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!_worker) {
    // new Worker() is the only permitted way to create an OPFS worker.
    _worker = new Worker(new URL("../../workers/opfs-proxy.worker.ts", import.meta.url), {
      type: "module",
    });
    _worker.onmessage = (event: MessageEvent<{ id: string; status: "ok" | "error"; buffer?: ArrayBuffer; files?: string[]; message?: string }>) => {
      const { id, status, ...rest } = event.data;
      const pending = _pendingRequests.get(id);
      if (!pending) return;
      _pendingRequests.delete(id);
      if (status === "error") {
        pending.reject(new Error(rest.message ?? "OPFS worker error"));
      } else {
        pending.resolve(rest);
      }
    };
    _worker.onerror = (e) => {
      console.error("[OPFSManager] Worker error:", e.message);
    };
  }
  return _worker;
}

function sendMessage<T>(msg: Record<string, unknown>, transfer?: Transferable[]): Promise<T> {
  const id = crypto.randomUUID();
  const worker = getWorker();
  return new Promise<T>((resolve, reject) => {
    _pendingRequests.set(id, { resolve: resolve as (v: unknown) => void, reject });
    if (transfer?.length) {
      worker.postMessage({ ...msg, id }, transfer);
    } else {
      worker.postMessage({ ...msg, id });
    }
  });
}

/** Write an ArrayBuffer to OPFS under the given file name. */
export async function opfsWriteFile(fileName: string, buffer: ArrayBuffer): Promise<void> {
  // Transfer the buffer to avoid copying — caller must not use `buffer` after this call.
  await sendMessage({ type: "WRITE_FILE", fileName, buffer }, [buffer]);
}

/** Read a file from OPFS. Returns a new ArrayBuffer owned by the main thread. */
export async function opfsReadFile(fileName: string): Promise<ArrayBuffer> {
  const result = await sendMessage<{ buffer: ArrayBuffer }>({ type: "READ_FILE", fileName });
  return result.buffer;
}

/** Delete a file from OPFS. */
export async function opfsDeleteFile(fileName: string): Promise<void> {
  await sendMessage({ type: "DELETE_FILE", fileName });
}

/** List all files in the OPFS proxies directory. */
export async function opfsListFiles(): Promise<string[]> {
  const result = await sendMessage<{ files: string[] }>({ type: "LIST_FILES" });
  return result.files;
}

/**
 * Decode a video's first keyframe into a JPEG proxy thumbnail.
 * The heavy decoding work runs entirely in the worker via WebCodecs VideoDecoder.
 *
 * @param videoData   - Raw encoded video data (H.264/AVC).
 * @param targetWidth - Proxy thumbnail width in pixels.
 * @param targetHeight - Proxy thumbnail height in pixels.
 * @returns JPEG ArrayBuffer of the first keyframe.
 */
export async function opfsDecodeProxy(
  videoData: ArrayBuffer,
  targetWidth: number,
  targetHeight: number,
): Promise<ArrayBuffer> {
  // Transfer the input buffer to avoid copying — caller must not use it after this call.
  const result = await sendMessage<{ buffer: ArrayBuffer }>(
    { type: "DECODE_PROXY", videoData, targetWidth, targetHeight },
    [videoData],
  );
  return result.buffer;
}

/** Terminate the worker. Call during app teardown. */
export function terminateOpfsWorker(): void {
  _worker?.terminate();
  _worker = null;
  _pendingRequests.clear();
}
