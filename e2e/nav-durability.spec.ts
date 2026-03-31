// e2e/nav-durability.spec.ts
// Rule 3 (Persistence Durability): flush-before-nav + dirty guard verification.

import { test, expect } from "./fixtures/audit-page";

test.describe("Navigation Durability", () => {
  test("studio → /niche route is gated by save barrier when dirty", async ({
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

    // Seed dirty=true via the AUDIT_MODE test hook
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>)["__auditTriggerDirty"];
      if (typeof fn === "function") fn();
    });

    // Confirm dirty=true (or flushing=true) before initiating navigation
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="dirty-state-indicator"]');
        return (
          el?.getAttribute("data-dirty") === "true" ||
          el?.getAttribute("data-flushing") === "true"
        );
      },
      { timeout: 5_000 },
    );

    // Click the Niche nav link — this triggers ensureFlushedBeforeNav + router.push("/niche")
    const nicheBtn = page.locator('[data-testid="sidebar-nav-niche"]');
    await expect(nicheBtn).toBeVisible({ timeout: 5_000 });
    await nicheBtn.click();

    // Wait for flush to complete (dirty cleared) — verifies the barrier ran
    await auditPage.waitForFlushComplete();

    // URL must be /niche (navigation completed after flush)
    await expect(page).toHaveURL("/niche", { timeout: 15_000 });

    // Confirm dirty is false post-navigation
    const indicator = page.locator('[data-testid="dirty-state-indicator"]');
    await expect(indicator).toHaveAttribute("data-dirty", "false");
  });

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
      const fn = (window as unknown as Record<string, unknown>)["__auditTriggerDirty"];
      if (typeof fn === "function") fn();
    });

    // Confirm dirty=true (or flushing=true — the transition is allowed) before initiating
    // navigation. We poll rather than a single-point wait to avoid race conditions where
    // the flush cycle runs very quickly.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="dirty-state-indicator"]');
        return (
          el?.getAttribute("data-dirty") === "true" ||
          el?.getAttribute("data-flushing") === "true"
        );
      },
      { timeout: 5_000 },
    );

    // Initiate navigation — this dispatches the click and the async ensureFlushedBeforeNav
    // starts running. We do NOT await a URL change here; that comes after flush.
    const projectsBtn = page.locator('[data-testid="sidebar-nav-projects"]');
    await expect(projectsBtn).toBeVisible({ timeout: 5_000 });
    await projectsBtn.click();

    // Wait for dirty to clear (flush completed).
    // waitForFlushComplete does NOT re-check dirty=true — caller already verified above.
    await auditPage.waitForFlushComplete();

    // URL must be /projects (navigation completed after flush)
    await expect(page).toHaveURL("/projects", { timeout: 15_000 });

    const indicator = page.locator('[data-testid="dirty-state-indicator"]');
    await expect(indicator).toHaveAttribute("data-dirty", "false");
  });
});
