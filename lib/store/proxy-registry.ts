// lib/store/proxy-registry.ts
// Machine-local IDB store for OPFS proxy metadata.
// Keys: "synapse-proxy-{mediaId}"
// Intentionally separate from .SYNAPSE recipe — proxy files are device-local.

import { get, del } from "idb-keyval";
import { idbSafeSet } from "./idb-safe-write";

export interface ProxyMeta {
  hasProxy: boolean;
  proxySizeBytes: number;        // bytes of the JPEG in OPFS
  proxyUpdatedAt: number | null; // epoch ms when proxy was last generated; null = absent
}

const ABSENT_META: ProxyMeta = { hasProxy: false, proxySizeBytes: 0, proxyUpdatedAt: null };
const KEY_PREFIX = "synapse-proxy-";

function proxyKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/** Read proxy metadata for one item. Returns absent-state defaults if no record found. */
export async function getProxyMeta(id: string): Promise<ProxyMeta> {
  const stored = await get<ProxyMeta>(proxyKey(id));
  return stored ?? { ...ABSENT_META };
}

/** Atomically persist proxy metadata after generate or clear. */
export async function setProxyMeta(id: string, meta: ProxyMeta): Promise<void> {
  await idbSafeSet(proxyKey(id), meta);
}

/** Load proxy metadata for a batch of IDs in one pass. */
export async function batchGetProxyMeta(ids: string[]): Promise<Record<string, ProxyMeta>> {
  const result: Record<string, ProxyMeta> = {};
  await Promise.all(
    ids.map(async (id) => {
      result[id] = await getProxyMeta(id);
    })
  );
  return result;
}

/** Remove proxy metadata record when the media item itself is removed. */
export async function deleteProxyMeta(id: string): Promise<void> {
  await del(proxyKey(id));
}
