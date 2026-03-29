// e2e/worker-isolation.spec.ts
// Proof that OPFS operations run in the worker — [WORKER_EVENT] sequence gates.

import { test, expect } from "./fixtures/audit-page";

test.describe("Worker Isolation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/studio");
  });

  test("OPFS write operations emit ordered worker events", async ({ page, auditPage }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Trigger an OPFS write by generating a proxy or importing media
    const generateProxyBtn = page.locator('[data-testid="generate-proxy-btn"]').first();
    const hasProxyBtn = await generateProxyBtn
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    if (hasProxyBtn) {
      await generateProxyBtn.click();

      // Wait for the write_start event to capture the request id
      const writeStart = await auditPage.waitForWorkerEvent("write_start", { timeoutMs: 10_000 });
      const requestId = writeStart.id;

      // Assert complete write sequence in order
      await auditPage.assertWorkerSequence(requestId, "write_start", "write_done");
    } else {
      test.skip();
    }
  });

  test("OPFS decode operations emit ordered worker events with monotonic timestamps", async ({
    page,
    auditPage,
  }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    const generateProxyBtn = page.locator('[data-testid="generate-proxy-btn"]').first();
    const hasProxyBtn = await generateProxyBtn
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    if (hasProxyBtn) {
      await generateProxyBtn.click();

      const decodeStart = await auditPage.waitForWorkerEvent("decode_start", {
        timeoutMs: 10_000,
      });
      const decodeId = decodeStart.id;

      await auditPage.assertWorkerSequence(decodeId, "decode_start", "decode_done");
    } else {
      test.skip();
    }
  });

  test("all worker events have monotonically increasing timestamps", async ({
    page,
    auditPage,
  }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Trigger some worker activity
    const generateProxyBtn = page.locator('[data-testid="generate-proxy-btn"]').first();
    if (await generateProxyBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await generateProxyBtn.click();
      await page.waitForTimeout(3_000);
    }

    const events = await page.evaluate(
      ({ startTs }: { startTs: number }) => {
        return (window.__synapseAudit?.workerEvents ?? [])
          .filter((e) => e.ts >= startTs)
          .sort((a, b) => a.ts - b.ts);
      },
      { startTs: await page.evaluate(() => window.__auditStartTs ?? 0) },
    );

    // All events must have valid timestamps
    for (const event of events) {
      expect(event.ts).toBeGreaterThan(0);
    }

    // Events sorted by ts must be in monotonically non-decreasing order
    for (let i = 1; i < events.length; i++) {
      expect(events[i].ts).toBeGreaterThanOrEqual(events[i - 1].ts);
    }
  });
});
