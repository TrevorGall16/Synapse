// e2e/razor-correctness.spec.ts
// Rule 1 (Schema Strictness) + Razor data integrity:
// A split produces exactly 2 clips that share the same sourceId, sum to the
// original duration, and mark the project dirty.

import { test, expect } from "./fixtures/audit-page";

test.describe("Razor Correctness", () => {
  test.beforeEach(async ({ page, auditPage }) => {
    await page.goto("/studio");
    // Wait for all AUDIT_MODE hooks to be mounted via deterministic readiness flag
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
  });

  test("split operation produces two clips sharing the same sourceId", async ({
    page,
    auditPage,
  }) => {
    // Seed a 10-second clip onto the first video track via the AUDIT_MODE hook
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>)["__auditAddTestClip"];
      if (typeof fn === "function") fn();
    });

    // Precondition: confirm the seeded clip is present in a video track before proceeding
    await page.waitForFunction(
      () => {
        const getTracks = (window as unknown as Record<string, unknown>)["__auditGetTracks"] as (() => { type: string; clips: { sourceId: string }[] }[]) | undefined;
        if (!getTracks) return false;
        return getTracks().some((t) => t.type === "video" && t.clips.some((c) => c.sourceId === "audit-source-1"));
      },
      { timeout: 5_000 },
    );

    // Position the playhead at the midpoint of the clip (5s = 5_000_000µs)
    const ORIGINAL_DURATION = 10_000_000; // 10 seconds in microseconds
    const SPLIT_POINT = ORIGINAL_DURATION / 2; // 5_000_000µs

    await page.evaluate((splitMicros: number) => {
      const fn = (window as unknown as Record<string, unknown>)["__auditSetPlayhead"];
      if (typeof fn === "function") fn(splitMicros);
    }, SPLIT_POINT);

    await page.waitForTimeout(100);

    // Reset audit buffers and capture start timestamp before the split
    await auditPage.resetAuditBuffers();
    await auditPage.markAuditStart();

    // Ensure the timeline keyboard handler is mounted before sending the split key
    await page.waitForSelector('[data-testid="timeline-track-area"]', { timeout: 10_000 });

    // Press 'S' to split the clip under the playhead
    // Focus the page first to ensure keyboard events are received by the timeline
    await page.keyboard.press("s");

    await page.waitForTimeout(200);

    // Read the tracks state via the AUDIT_MODE hook
    interface ClipData {
      id: string;
      sourceId: string;
      startTime: number;
      duration: number;
    }
    interface TrackData {
      id: string;
      type: string;
      clips: ClipData[];
    }

    const tracks: TrackData[] = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>)["__auditGetTracks"];
      if (typeof fn === "function") return fn() as TrackData[];
      return [];
    });

    // Find the video track that received our test clip
    const videoTrack = tracks.find(
      (t) => t.type === "video" && t.clips.some((c) => c.sourceId === "audit-source-1"),
    );
    expect(videoTrack, "Video track with audit-source-1 clips must exist").toBeTruthy();

    const splitClips = videoTrack!.clips.filter((c) => c.sourceId === "audit-source-1");

    // 1. Assert: exactly 2 clips exist with the original sourceId
    expect(splitClips).toHaveLength(2);

    // 2. Assert: both clips share the same sourceId
    expect(splitClips[0].sourceId).toBe("audit-source-1");
    expect(splitClips[1].sourceId).toBe("audit-source-1");

    // 3. Assert: durationA + durationB === original duration
    const totalDuration = splitClips[0].duration + splitClips[1].duration;
    expect(totalDuration).toBe(ORIGINAL_DURATION);

    // 4. Assert: isDirty === true (split triggered the save-barrier)
    // The split changes tracks in the project store, which triggers GlobalHydrator's
    // subscribe callback to call setDirty(true). This should happen within milliseconds.
    const indicator = page.locator('[data-testid="dirty-state-indicator"]');
    await expect(indicator).toHaveAttribute("data-dirty", "true", { timeout: 5_000 });
  });

  test("split clips occupy contiguous time with no gap", async ({ page }) => {
    // Seed clip
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>)["__auditAddTestClip"];
      if (typeof fn === "function") fn();
    });

    // Precondition: confirm clip is present before splitting
    await page.waitForFunction(
      () => {
        const getTracks = (window as unknown as Record<string, unknown>)["__auditGetTracks"] as (() => { type: string; clips: { sourceId: string }[] }[]) | undefined;
        if (!getTracks) return false;
        return getTracks().some((t) => t.type === "video" && t.clips.some((c) => c.sourceId === "audit-source-1"));
      },
      { timeout: 5_000 },
    );

    // Split at 3s mark (3_000_000µs)
    const SPLIT_POINT = 3_000_000;
    await page.evaluate((splitMicros: number) => {
      const fn = (window as unknown as Record<string, unknown>)["__auditSetPlayhead"];
      if (typeof fn === "function") fn(splitMicros);
    }, SPLIT_POINT);

    await page.waitForTimeout(100);

    // Ensure the timeline keyboard handler is mounted before sending the split key
    await page.waitForSelector('[data-testid="timeline-track-area"]', { timeout: 10_000 });

    await page.keyboard.press("s");
    await page.waitForTimeout(200);

    interface ClipData {
      id: string;
      sourceId: string;
      startTime: number;
      duration: number;
    }
    interface TrackData {
      id: string;
      type: string;
      clips: ClipData[];
    }

    const tracks: TrackData[] = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>)["__auditGetTracks"];
      if (typeof fn === "function") return fn() as TrackData[];
      return [];
    });

    const videoTrack = tracks.find(
      (t) => t.type === "video" && t.clips.some((c) => c.sourceId === "audit-source-1"),
    );
    expect(videoTrack).toBeTruthy();

    const splitClips = videoTrack!.clips
      .filter((c) => c.sourceId === "audit-source-1")
      .sort((a, b) => a.startTime - b.startTime);

    expect(splitClips).toHaveLength(2);

    // First clip ends exactly where the second begins — no gap
    const endOfFirst = splitClips[0].startTime + splitClips[0].duration;
    expect(endOfFirst).toBe(splitClips[1].startTime);
  });
});
