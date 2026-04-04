// e2e/niche-feed.spec.ts
// Task 3 (Niche Feed): IntersectionObserver gates video element mounting.
// Videos are only inserted into the DOM when the card is near the viewport
// (rootMargin: "100px"). This prevents all videos from mounting simultaneously.

import { test, expect } from "./fixtures/audit-page";

test.describe("Niche Feed Observer Loading", () => {
  test("no video elements on initial render of empty category", async ({ page }) => {
    // Navigate to cinematic niche — the feed store starts empty in a fresh browser context
    // (IDB is empty in a new Playwright browser), so the filtered posts array is [].
    await page.goto("/niche/cinematic");

    // Wait for the page to hydrate (no spinner or loading state to key off, so we wait
    // for the content area to be present)
    await page.waitForSelector("div.flex-1.overflow-y-auto", {
      state: "attached",
      timeout: 15_000,
    });

    // With no posts, there should be zero niche-card elements
    const cardCount = await page.locator('[data-testid="niche-card"]').count();
    expect(cardCount).toBe(0);

    // Consequently, zero video elements should be mounted
    const videoCount = await page.locator('[data-testid="niche-card-video"]').count();
    expect(videoCount).toBe(0);
  });

  test("videos are not all mounted simultaneously when many cards exist", async ({ page, auditPage }) => {
    // Use a small viewport so only the first few cards fit above the fold
    await page.setViewportSize({ width: 1024, height: 600 });

    // Navigate to cinematic niche first so the page is ready
    await page.goto("/niche/cinematic");

    // Wait for all AUDIT_MODE hooks to be mounted via deterministic readiness flag
    await auditPage.waitForReady();

    // Seed 30 posts with a non-empty videoUrl so that IntersectionObserver gating
    // (not an empty URL) is what prevents off-screen video elements from mounting.
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>)["__auditSeedNichePosts"];
      if (typeof fn === "function") fn(30);
    });

    // Wait for React to re-render the grid with the seeded posts
    await page.waitForSelector('[data-testid="niche-card"]', {
      state: "attached",
      timeout: 10_000,
    });

    // Give IntersectionObserver callbacks time to fire for above-fold cards
    await page.waitForTimeout(400);

    const cardCount = await page.locator('[data-testid="niche-card"]').count();
    expect(cardCount).toBeGreaterThanOrEqual(30);

    // IntersectionObserver gating: only above-fold cards should have video elements.
    // videoCount must be > 0 (above-fold cards DO get videos) but < cardCount
    // (off-screen cards are blocked from mounting their video element).
    const videoCount = await page.locator('[data-testid="niche-card-video"]').count();
    expect(videoCount).toBeGreaterThan(0);
    expect(videoCount).toBeLessThan(cardCount);
  });


});
