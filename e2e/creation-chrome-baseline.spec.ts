import { test, expect } from "@playwright/test";

/** Pre-restructure baseline: capture every route that must remain byte-identical
 *  after the (creation) group is introduced. The restructure branch runs this
 *  same test against the snapshots committed here. */
const ROUTES = [
  { path: "/studio/dashboard", name: "studio-dashboard" },
  { path: "/studio",           name: "studio-root" },
  { path: "/profile/you",      name: "profile-you" },
  { path: "/projects",         name: "projects" },
  { path: "/upload",           name: "upload" },
];

for (const { path, name } of ROUTES) {
  test(`creation chrome baseline — ${name}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("[data-testid='sidebar-nav-home']")).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  });
}
