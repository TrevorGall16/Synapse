// e2e/fixtures/audit-page.ts
// AuditPage fixture: all helpers for the Synapse E2E audit suite.
// Spec files remain declarative — they call these helpers without reimplementing
// log parsing or buffer access.

import { test as base, expect, type Page } from "@playwright/test";

// ── Types (mirror of types/audit.d.ts, re-declared for test-only import) ────────

interface SynapseAuditLongTask {
  epochStartTime: number;
  duration: number;
  name: string;
}

interface SynapseAuditWorkerEvent {
  type: string;
  id: string;
  ts: number;
  meta?: unknown;
}

interface LongTaskResult {
  entries: SynapseAuditLongTask[];
  maxLongTaskMs: number;
}

interface ExportSummary {
  fps: number;
  frames: number;
  maxDriftMicros: number;
  toleranceMicros: number;
  status: "PASS" | "FAIL";
  rawLine: string;
}

interface WaitForWorkerEventOptions {
  id?: string;
  timeoutMs?: number;
}

// ── AuditPage class ──────────────────────────────────────────────────────────────

export class AuditPage {
  constructor(public readonly page: Page) {}

  // ── Buffer management ────────────────────────────────────────────────────────

  /** Record Date.now() as the start of an audited flow. */
  async markAuditStart(): Promise<void> {
    await this.page.evaluate(() => {
      window.__auditStartTs = Date.now();
    });
  }

  /** Clear all audit buffers and reset the start timestamp. */
  async resetAuditBuffers(): Promise<void> {
    await this.page.evaluate(() => {
      window.__synapseAudit = { longTasks: [], exportSummaries: [], workerEvents: [] };
      window.__auditStartTs = Date.now();
    });
  }

  // ── Long tasks ───────────────────────────────────────────────────────────────

  /** Read long-task entries that occurred after markAuditStart(). */
  async readLongTasks(): Promise<LongTaskResult> {
    return this.page.evaluate((): LongTaskResult => {
      const startTs = window.__auditStartTs ?? 0;
      const all = window.__synapseAudit?.longTasks ?? [];
      const entries = all.filter((e) => e.epochStartTime >= startTs);
      const maxLongTaskMs = entries.length > 0 ? Math.max(...entries.map((e) => e.duration)) : 0;
      return { entries, maxLongTaskMs };
    });
  }

  // ── Export accuracy ──────────────────────────────────────────────────────────

  /**
   * Parse the most recent [SynapseExport] SUMMARY line captured in the audit buffer.
   * Throws if buffer is empty.
   */
  async parseExportSummary(): Promise<ExportSummary> {
    const summaries: string[] = await this.page.evaluate(() => {
      const startTs = window.__auditStartTs ?? 0;
      const all = window.__synapseAudit?.exportSummaries ?? [];
      // All summaries after markAuditStart are valid; return all for caller to pick latest.
      // We can't timestamp individual lines; rely on buffer isolation via resetAuditBuffers.
      if (startTs > 0 && all.length > 1) {
        // Multiple summaries present without per-line timestamps — return last.
      }
      return all;
    });

    if (summaries.length === 0) {
      throw new Error("AuditPage.parseExportSummary: exportSummaries buffer is empty");
    }

    const rawLine = summaries[summaries.length - 1];
    // Format: [SynapseExport] SUMMARY fps=X frames=Y maxDrift=ZΜs tolerance=Wµs status=S
    const fpsMatch = rawLine.match(/fps=(\d+(?:\.\d+)?)/);
    const framesMatch = rawLine.match(/frames=(\d+)/);
    const driftMatch = rawLine.match(/maxDrift=(\d+)µs/);
    const toleranceMatch = rawLine.match(/tolerance=(\d+)µs/);
    const statusMatch = rawLine.match(/status=(PASS|FAIL)/);

    if (!fpsMatch || !framesMatch || !driftMatch || !toleranceMatch || !statusMatch) {
      throw new Error(`AuditPage.parseExportSummary: failed to parse summary line: ${rawLine}`);
    }

    return {
      fps: parseFloat(fpsMatch[1]),
      frames: parseInt(framesMatch[1], 10),
      maxDriftMicros: parseInt(driftMatch[1], 10),
      toleranceMicros: parseInt(toleranceMatch[1], 10),
      status: statusMatch[1] as "PASS" | "FAIL",
      rawLine,
    };
  }

  // ── Worker events ────────────────────────────────────────────────────────────

  /**
   * Poll workerEvents until a matching entry (type + optional id) appears after __auditStartTs.
   * Throws TimeoutError if not found within timeoutMs.
   */
  async waitForWorkerEvent(
    type: string,
    options: WaitForWorkerEventOptions = {},
  ): Promise<SynapseAuditWorkerEvent> {
    const { id, timeoutMs = 5_000 } = options;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const event: SynapseAuditWorkerEvent | null = await this.page.evaluate(
        ({ type, id, startTs }: { type: string; id?: string; startTs: number }) => {
          const events = window.__synapseAudit?.workerEvents ?? [];
          const match = events.find(
            (e) => e.type === type && e.ts >= startTs && (id === undefined || e.id === id),
          );
          return match ?? null;
        },
        { type, id, startTs: await this.page.evaluate(() => window.__auditStartTs ?? 0) },
      );

      if (event) return event;
      await this.page.waitForTimeout(100);
    }

    throw new Error(
      `AuditPage.waitForWorkerEvent: timed out waiting for type="${type}"${id ? ` id="${id}"` : ""} after ${timeoutMs}ms`,
    );
  }

  /**
   * Assert that all worker events for a given id appear in the expected order
   * with monotonically increasing ts values.
   */
  async assertWorkerSequence(id: string, ...expectedTypes: string[]): Promise<void> {
    const events = await this.page.evaluate(
      ({ id, startTs }: { id: string; startTs: number }) => {
        return (window.__synapseAudit?.workerEvents ?? [])
          .filter((e) => e.id === id && e.ts >= startTs)
          .sort((a, b) => a.ts - b.ts);
      },
      { id, startTs: await this.page.evaluate(() => window.__auditStartTs ?? 0) },
    );

    const actualTypes = events.map((e) => e.type);
    expect(actualTypes).toEqual(expectedTypes);

    // Assert monotonically increasing ts
    for (let i = 1; i < events.length; i++) {
      expect(events[i].ts).toBeGreaterThanOrEqual(events[i - 1].ts);
    }
  }

  // ── Navigation / flush guard ─────────────────────────────────────────────────

  /**
   * Waits for a complete dirty → flushing → clean cycle.
   * Verifies the save-barrier overlay is visible during flushing.
   */
  /**
   * Waits for dirty=false, asserting that the save-barrier overlay appeared if
   * flushing was observed during the wait. Designed to be called AFTER the caller
   * has already confirmed dirty=true AND initiated a navigation/flush action.
   *
   * Does NOT re-check for dirty=true at entry — the caller's pre-condition owns that.
   * This prevents false failures when flush completes before waitForFlushComplete() enters.
   */
  async waitForFlushComplete(): Promise<void> {
    const overlayLocator = this.page.locator('[data-testid="save-barrier-overlay"]');

    // If we observe flushing=true at any point, the overlay must be visible at that moment.
    // We poll at 50ms intervals for up to 8s to catch the flushing window.
    const flushWindowMs = 8_000;
    const pollIntervalMs = 50;
    const deadline = Date.now() + flushWindowMs;

    while (Date.now() < deadline) {
      const isFlushing = await this.page
        .locator('[data-testid="dirty-state-indicator"][data-flushing="true"]')
        .isVisible()
        .catch(() => false);

      if (isFlushing) {
        await expect(overlayLocator).toBeVisible();
        break;
      }

      const isDirtyFalse = await this.page
        .locator('[data-testid="dirty-state-indicator"][data-dirty="false"]')
        .isVisible()
        .catch(() => false);

      if (isDirtyFalse) break;

      await this.page.waitForTimeout(pollIntervalMs);
    }

    // Primary assertion: dirty must be false (flush completed) before we return
    await this.page.waitForSelector('[data-testid="dirty-state-indicator"][data-dirty="false"]', {
      state: "attached",
      timeout: 15_000,
    });
  }
}

// ── Fixture extension ────────────────────────────────────────────────────────────

export const test = base.extend<{ auditPage: AuditPage }>({
  auditPage: async ({ page }, use) => {
    await use(new AuditPage(page));
  },
});

export { expect };
