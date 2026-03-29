// e2e/export-accuracy.spec.ts
// Export pipeline: deterministic settings + A/V sync validation.

import { test, expect } from "./fixtures/audit-page";

test.describe("Export Accuracy", () => {
  test("export produces PASS A/V sync status within tolerance", async ({ page, auditPage }) => {
    await page.goto("/studio");
    await page.waitForSelector('[data-testid="dirty-state-indicator"]', { state: "attached", timeout: 15_000 });

    // If the studio splash is showing, create a new project to get the toolbar
    const createBtn = page.locator('[data-testid="studio-create-project"]');
    if (await createBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await createBtn.click();
    }

    // Wait for export-btn to exist in DOM (confirms toolbar is rendered)
    await page.waitForSelector('[data-testid="export-btn"]', { state: "attached", timeout: 20_000 });

    // Dismiss any blocking modal (e.g. ProjectSettingsModal auto-opened by IDB hydration)
    const closeBtn = page.locator('button[aria-label="Close"]').first();
    if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // Verify export-btn is now interactable
    const exportBtn = page.locator('[data-testid="export-btn"]');
    await expect(exportBtn).toBeVisible({ timeout: 5_000 });

    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Open the Export modal
    await exportBtn.click({ timeout: 10_000 });
    await expect(page.locator('[data-testid="export-modal"]')).toBeVisible({ timeout: 5_000 });

    // Click Render (triggers stub or real MediaRecorder path; emits [SynapseExport] SUMMARY on done)
    await page.click('[data-testid="export-render-btn"]');

    // Wait for the done state
    await page.waitForSelector('[data-testid="export-done"]', {
      state: "attached",
      timeout: 90_000,
    });

    const summary = await auditPage.parseExportSummary();

    expect(summary.status).toBe("PASS");
    expect(summary.maxDriftMicros).toBeLessThanOrEqual(summary.toleranceMicros);
    expect(summary.fps).toBeGreaterThan(0);
    expect(summary.frames).toBeGreaterThan(0);
  });
});
