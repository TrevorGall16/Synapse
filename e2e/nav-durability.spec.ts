// e2e/nav-durability.spec.ts
// Rule 3 (Persistence Durability): flush-before-nav + dirty guard verification.

import { test, expect } from "./fixtures/audit-page";

test.describe("Navigation Durability", () => {
  test("flush completes before route transition after project mutation", async ({
    page,
    auditPage,
  }) => {
    await page.goto("/studio");
    // Wait for AppBootstrap (and AUDIT_MODE hooks) to mount
    await page.waitForSelector('[data-testid="dirty-state-indicator"]', {
      state: "attached",
      timeout: 15_000,
    });

    await auditPage.resetAuditBuffers();

    // Seed dirty=true via the AUDIT_MODE test hook.
    // This is equivalent to any project mutation that modifies tracks/history/savedProjects.
    await page.evaluate(() => {
      const fn = (window as Record<string, unknown>)["__auditTriggerDirty"];
      if (typeof fn === "function") fn();
    });

    // Confirm dirty=true before initiating navigation
    await page.waitForSelector('[data-testid="dirty-state-indicator"][data-dirty="true"]', {
      state: "attached",
      timeout: 3_000,
    });

    // Initiate navigation — this dispatches the click and the async ensureFlushedBeforeNav
    // starts running. We do NOT await a URL change here; that comes after flush.
    const galleryBtn = page.locator('[data-testid="sidebar-nav-gallery"]');
    await expect(galleryBtn).toBeVisible({ timeout: 5_000 });
    await galleryBtn.click();

    // Wait for dirty to clear (flush completed).
    // waitForFlushComplete does NOT re-check dirty=true — caller already verified above.
    await auditPage.waitForFlushComplete();

    // URL must be /gallery (navigation completed after flush)
    await expect(page).toHaveURL("/gallery", { timeout: 15_000 });

    const indicator = page.locator('[data-testid="dirty-state-indicator"]');
    await expect(indicator).toHaveAttribute("data-dirty", "false");
  });
});
