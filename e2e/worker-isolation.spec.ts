// e2e/worker-isolation.spec.ts
// Proof that OPFS operations run in the worker — [WORKER_EVENT] sequence gates.
// Requires at least one video item in the Media Bin (seeded via beforeEach).

import path from "path";
import { test, expect } from "./fixtures/audit-page";

const FIXTURE_VIDEO = path.resolve(__dirname, "fixtures/test-proxy.mp4");

test.describe("Worker Isolation", () => {
  test.beforeEach(async ({ page, auditPage }) => {
    await page.goto("/studio");
    await auditPage.waitForReady();

    // Create project if splash is showing
    const createBtn = page.locator('[data-testid="studio-create-project"]');
    if (await createBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await createBtn.click();
    }

    // Dismiss any blocking modal (e.g. ProjectSettingsModal auto-opened by IDB hydration)
    const closeBtn = page.locator('button[aria-label="Close"]').first();
    if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // Switch to the Media Bin tab
    await page.waitForSelector('[data-testid="media-bin"]', { state: "attached", timeout: 10_000 });

    // Import test fixture via the hidden file input in MediaBin
    await page.setInputFiles('[data-testid="media-bin-file-input"]', FIXTURE_VIDEO);

    // Wait for the generate proxy button to appear for the imported video
    await page.waitForSelector('[data-testid^="generate-proxy-btn-"]', {
      state: "visible",
      timeout: 10_000,
    });

    // Brief wait for saveMediaToDB (fire-and-forget IDB write) to complete before
    // any test clicks "Gen Proxy", which reads from IDB via getStoredMediaItem.
    await page.waitForTimeout(500);
  });

  test("OPFS write operations emit ordered worker events", async ({ page, auditPage }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    const generateProxyBtn = page.locator('[data-testid^="generate-proxy-btn-"]').first();
    await generateProxyBtn.click();

    const writeStart = await auditPage.waitForWorkerEvent("write_start", { timeoutMs: 15_000 });
    await auditPage.assertWorkerSequence(writeStart.id, "write_start", "write_done");
  });

  test("OPFS decode operations emit ordered worker events with monotonic timestamps", async ({
    page,
    auditPage,
  }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    const generateProxyBtn = page.locator('[data-testid^="generate-proxy-btn-"]').first();
    await generateProxyBtn.click();

    const decodeStart = await auditPage.waitForWorkerEvent("decode_start", {
      timeoutMs: 15_000,
    });
    await auditPage.assertWorkerSequence(decodeStart.id, "decode_start", "decode_done");
  });

  test("all worker events have monotonically increasing timestamps", async ({
    page,
    auditPage,
  }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Trigger worker activity
    const generateProxyBtn = page.locator('[data-testid^="generate-proxy-btn-"]').first();
    await generateProxyBtn.click();
    await page.waitForTimeout(3_000);

    const events = await page.evaluate(
      ({ startTs }: { startTs: number }) =>
        (window.__synapseAudit?.workerEvents ?? [])
          .filter((e) => e.ts >= startTs)
          .sort((a, b) => a.ts - b.ts),
      { startTs: await page.evaluate(() => window.__auditStartTs ?? 0) },
    );

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.ts).toBeGreaterThan(0);
    }
    for (let i = 1; i < events.length; i++) {
      expect(events[i].ts).toBeGreaterThanOrEqual(events[i - 1].ts);
    }
  });
});
