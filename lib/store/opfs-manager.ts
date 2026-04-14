// lib/store/opfs-manager.ts
// Main-thread bridge to workers/opfs-proxy.worker.ts.
// All OPFS operations must go through this manager — never call OPFS APIs directly
// from the main thread for heavy decoding/proxy work.

const OPFS_REQUEST_TIMEOUT_MS = 30_000;

let _worker: Worker | null = null;
const _pendingRequests = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

// ── Worker message payload types (main-thread view) ───────────────────────────

interface AuditEventMsg {
  __auditEvent: true;
  type: string;
  id: string;
  ts: number;
  meta?: unknown;
}
/** Shared fields on all non-audit messages. */
interface BaseMsg { id: string }
/** DECODE_PROXY success — uses ok/jpegBuf contract. */
interface DecodeSuccessMsg extends BaseMsg { ok: true;  jpegBuf: ArrayBuffer }
/** DECODE_PROXY failure — uses ok/error contract. */
interface DecodeFailureMsg extends BaseMsg { ok: false; error: string }
/** All other operations use status/rest contract. */
interface StatusMsg extends BaseMsg { status: "ok" | "error"; [key: string]: unknown }

type WorkerMsg = AuditEventMsg | DecodeSuccessMsg | DecodeFailureMsg | StatusMsg;

function getWorker(): Worker {
  if (!_worker) {
    // new Worker() is the only permitted way to create an OPFS worker.
    _worker = new Worker(new URL("../../workers/opfs-proxy.worker.ts", import.meta.url), {
      type: "module",
    });
    _worker.onmessage = (event: MessageEvent<WorkerMsg>) => {
      const data = event.data;

      // ── Audit event branch ─────────────────────────────────────────────────
      // MUST return here — audit events share the same `id` as the originating
      // request. Falling through would erroneously resolve the pending promise.
      if ((data as AuditEventMsg).__auditEvent === true) {
        if (typeof window !== "undefined" && window.__synapseAudit) {
          const e = data as AuditEventMsg;
          window.__synapseAudit.workerEvents.push({
            type: e.type ?? "unknown",
            id: e.id,
            ts: e.ts ?? Date.now(),
            meta: e.meta,
          });
        }
        return; // never resolve/reject a pending promise from an audit event
      }

      const { id } = data as BaseMsg;
      const pending = _pendingRequests.get(id);
      if (!pending) return;
      _pendingRequests.delete(id);

      // ── DECODE_PROXY uses ok/jpegBuf contract ──────────────────────────────
      if ("ok" in data) {
        if ((data as DecodeSuccessMsg | DecodeFailureMsg).ok) {
          pending.resolve({ jpegBuf: (data as DecodeSuccessMsg).jpegBuf });
        } else {
          pending.reject(
            new Error((data as DecodeFailureMsg).error ?? "OPFS decode error"),
          );
        }
        return;
      }

      // ── All other operations use status/rest contract ──────────────────────
      const { status, ...rest } = data as StatusMsg;
      if (status === "error") {
        pending.reject(
          new Error(
            ((rest as unknown as { message?: string }).message) ?? "OPFS worker error",
          ),
        );
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

/**
 * Send a message to the worker and return a Promise for its response.
 * Every pending request is automatically rejected after OPFS_REQUEST_TIMEOUT_MS
 * to prevent orphaned promises leaking in case of worker silence.
 */
function sendMessage<T>(msg: Record<string, unknown>, transfer?: Transferable[]): Promise<T> {
  const id = crypto.randomUUID();
  const worker = getWorker();
  return new Promise<T>((resolve, reject) => {
    // Timeout guard: reject and clean up if the worker never responds.
    const timer = setTimeout(() => {
      if (_pendingRequests.delete(id)) {
        reject(
          new Error(`OPFS worker request timed out after ${OPFS_REQUEST_TIMEOUT_MS}ms`),
        );
      }
    }, OPFS_REQUEST_TIMEOUT_MS);

    _pendingRequests.set(id, {
      resolve: (v: unknown) => { clearTimeout(timer); (resolve as (v: unknown) => void)(v); },
      reject: (e: Error) => { clearTimeout(timer); reject(e); },
    });

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
 * The heavy decoding work runs entirely in the worker via WebCodecs VideoDecoder,
 * with a canvas fallback for inputs that VideoDecoder cannot process.
 *
 * Response contract: { ok: true, jpegBuf: ArrayBuffer } on success.
 * The JPEG buffer is transferred zero-copy from the worker.
 *
 * @param videoData   - Raw encoded video data (H.264/AVC or container).
 * @param targetWidth - Proxy thumbnail width in pixels.
 * @param targetHeight - Proxy thumbnail height in pixels.
 * @returns JPEG ArrayBuffer of the first keyframe (or a blank placeholder).
 */
export async function opfsDecodeProxy(
  videoData: ArrayBuffer,
  targetWidth: number,
  targetHeight: number,
): Promise<ArrayBuffer> {
  // Transfer the input buffer to avoid copying — caller must not use it after this call.
  const result = await sendMessage<{ jpegBuf: ArrayBuffer }>(
    { type: "DECODE_PROXY", videoData, targetWidth, targetHeight },
    [videoData],
  );
  return result.jpegBuf;
}

/** Terminate the worker. Call during app teardown. */
export function terminateOpfsWorker(): void {
  _worker?.terminate();
  _worker = null;
  _pendingRequests.clear();
}
