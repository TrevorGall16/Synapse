// e2e/long-task-budget.spec.ts
// Jank budget: maxLongTaskMs <= 50ms for scrub, batch-delete, and proxy-generate flows.

import { test, expect } from "./fixtures/audit-page";

const MAX_LONG_TASK_MS = 50;

test.describe("Long-Task Budget", () => {
  test.beforeEach(async ({ page, auditPage }) => {
    await page.goto("/studio");
    await auditPage.waitForReady();
  });

  test("scrub playhead stays under 50ms long-task budget", async ({ page, auditPage }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    const playhead = page.locator('[data-testid="timeline-playhead"]');
    if (await playhead.isVisible()) {
      const box = await playhead.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 300, box.y + box.height / 2, { steps: 30 });
        await page.mouse.up();
      }
    }

    const { maxLongTaskMs } = await auditPage.readLongTasks();
    expect(maxLongTaskMs).toBeLessThanOrEqual(MAX_LONG_TASK_MS);
  });

  test("batch delete stays under 50ms long-task budget", async ({ page, auditPage }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Select all and delete
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");

    // Confirm deletion dialog if present
    const confirmBtn = page.locator('[data-testid="confirm-delete-btn"]');
    if (await confirmBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await page.waitForTimeout(500);

    const { maxLongTaskMs } = await auditPage.readLongTasks();
    expect(maxLongTaskMs).toBeLessThanOrEqual(MAX_LONG_TASK_MS);
  });

  test("razor split stays under 50ms long-task budget", async ({ page, auditPage }) => {
    // Create project if splash is showing
    const createBtn = page.locator('[data-testid="studio-create-project"]');
    if (await createBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await createBtn.click();
    }

    // Dismiss any blocking modal
    const closeBtn = page.locator('button[aria-label="Close"]').first();
    if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }

    // Seed a clip via the AUDIT_MODE hook
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>)["__auditAddTestClip"];
      if (typeof fn === "function") fn();
    });

    // Deterministic wait: confirm the clip is present before proceeding
    await page.waitForFunction(
      () => {
        const getTracks = (window as unknown as Record<string, unknown>)["__auditGetTracks"] as (() => { type: string; clips: { sourceId: string }[] }[]) | undefined;
        if (!getTracks) return false;
        return getTracks().some((t) => t.type === "video" && t.clips.some((c) => c.sourceId === "audit-source-1"));
      },
      { timeout: 5_000 },
    );

    // Position playhead at midpoint (5s)
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>)["__auditSetPlayhead"];
      if (typeof fn === "function") fn(5_000_000);
    });
    await page.waitForTimeout(100);

    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Trigger the split
    await page.keyboard.press("s");
    await page.waitForTimeout(200);

    const { maxLongTaskMs } = await auditPage.readLongTasks();
    expect(maxLongTaskMs).toBeLessThanOrEqual(MAX_LONG_TASK_MS);
  });

  test("proxy generation stays under 50ms long-task budget on main thread", async ({
    page,
    auditPage,
  }) => {
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Trigger proxy generation via media pool if available
    const generateProxyBtn = page.locator('[data-testid="generate-proxy-btn"]').first();
    if (await generateProxyBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await generateProxyBtn.click();
      await page.waitForTimeout(2_000);
    }

    const { maxLongTaskMs } = await auditPage.readLongTasks();
    // Main thread must not block — proxy work runs in the OPFS worker
    expect(maxLongTaskMs).toBeLessThanOrEqual(MAX_LONG_TASK_MS);
  });
});
