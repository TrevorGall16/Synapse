// types/audit.d.ts
// Global Window type augmentation for the Synapse audit infrastructure.
// App writes; e2e/fixtures/audit-page.ts reads.
// All writes are strictly gated on NEXT_PUBLIC_AUDIT_MODE === "1".

interface SynapseAuditLongTask {
  /** Absolute epoch time (ms): performance.timeOrigin + entry.startTime. */
  epochStartTime: number;
  duration: number;
  name: string;
}

interface SynapseAuditWorkerEvent {
  type: string;
  id: string;
  /** Date.now() in the worker at emission time — same epoch domain as __auditStartTs. */
  ts: number;
  meta?: unknown;
}

interface Window {
  __synapseAudit?: {
    longTasks: SynapseAuditLongTask[];
    exportSummaries: string[];
    workerEvents: SynapseAuditWorkerEvent[];
  };
  /**
   * Set by markAuditStart() / resetAuditBuffers() as Date.now() (epoch ms).
   * All fixture helpers filter to entries with epochStartTime / ts >= this value.
   */
  __auditStartTs?: number;
}
