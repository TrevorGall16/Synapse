import { test, expect } from "@playwright/test";

// Default sort (Trending + Today) filters all mock posts out by age, so the
// grid would be empty. Force Latest + All-time via localStorage before the app
// hydrates so seed cards are guaranteed to render.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("synapse-feed-sort", "latest");
      localStorage.setItem("synapse-feed-window", "all");
    } catch { /* ignore — no storage access */ }
  });
});

test.describe("Home ↔ Theater navigation", () => {
  test("rapid open/close produces no IPC throttling warnings", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning" && msg.text().includes("IPC")) {
        warnings.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForSelector("article");

    for (let i = 0; i < 5; i++) {
      const firstCard = page.locator("article").first();
      await firstCard.click();
      await page.waitForURL(/\/video\//);
      await page.keyboard.press("Escape");
      await page.waitForURL(/^(?!.*\/video\/).*$/);
    }

    expect(warnings).toEqual([]);
  });

  test("home → theater open completes under 150ms", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("article");
    const t0 = Date.now();
    await page.locator("article").first().click();
    await page.waitForURL(/\/video\//);
    expect(Date.now() - t0).toBeLessThan(150);
  });

  test("swiping then Back returns to Home, not the previous video", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("article");

    await page.locator("article").first().click();
    await page.waitForURL(/\/video\//);

    // Simulate five downward swipes → five replaceState updates.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(120);
    }

    await page.goBack();
    await page.waitForURL((url) => !url.pathname.startsWith("/video/"));
    expect(new URL(page.url()).pathname).toBe("/");
  });
});
