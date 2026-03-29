# Playwright E2E Audit Suite — Design Spec
**Date:** 2026-03-29 | **Status:** Approved | **Scope:** Tier 1 Engine & Safety Verification

---

## 1. Purpose

A deterministic, studio-grade automated verification suite that proves the Tier 1 engine and Fail-Safe architecture defined in `docs/whitepaper.md` behave correctly under real browser load. No API stubbing — WebCodecs, OPFS, and AudioContext run for real in headless Chromium.

---

## 2. Architecture: Fixture-First (`AuditPage`)

All test infrastructure lives in `e2e/fixtures/audit-page.ts`. Spec files remain declarative — they call fixture helpers without reimplementing log parsing or buffer access.

### 2.1 File Layout

```
types/
  audit.d.ts                   ← global Window type augmentation (app + test)

e2e/
  fixtures/
    audit-page.ts              ← AuditPage fixture: all helpers + types
  nav-durability.spec.ts       ← Rule 3: flush-before-nav + dirty guard
  export-accuracy.spec.ts      ← pipeline: deterministic settings + A/V sync
  long-task-budget.spec.ts     ← maxLongTaskMs <= 50 for scrub/delete/proxy
  worker-isolation.spec.ts     ← [WORKER_EVENT] proof gates (OPFS path)

playwright.config.ts           ← webServer: next dev, headless Chromium, artifacts

components/AppBootstrap.tsx    ← add PerformanceObserver (AUDIT_MODE gated)
workers/opfs-proxy.worker.ts   ← add [WORKER_EVENT] structured postMessages
components/SaveBarrierOverlay.tsx ← add data-testid hook
lib/store/opfs-manager.ts      ← branch __auditEvent messages into audit buffer
```

### 2.2 `window.__synapseAudit` Shape

Declared in `types/audit.d.ts` (app writes) and re-used in `e2e/fixtures/audit-page.ts` (test reads).

```typescript
interface SynapseAuditLongTask {
  /** Absolute epoch time (ms) derived from performance.timeOrigin + entry.startTime. */
  epochStartTime: number;
  duration: number;    // ms
  name: string;
}

interface SynapseAuditWorkerEvent {
  type: string;        // e.g. "decode_start", "decode_done", "write_start"
  id: string;          // correlates request ↔ response
  /** Date.now() in the worker at event emission time. Same epoch domain as __auditStartTs. */
  ts: number;
  meta?: unknown;
}

interface Window {
  __synapseAudit?: {
    longTasks: SynapseAuditLongTask[];
    exportSummaries: string[];        // raw [SynapseExport] SUMMARY lines
    workerEvents: SynapseAuditWorkerEvent[];
  };
  /**
   * Set by markAuditStart() / resetAuditBuffers() as Date.now() (epoch ms).
   * All filter helpers compare against this value.
   * Long tasks are stored as epochStartTime (Date.now() domain).
   * Worker events use ts = Date.now() (same domain).
   * No performance.now() values are stored — clocks are unified in Date.now() epoch.
   */
  __auditStartTs?: number;
}
```

---

## 3. Instrumentation Layer

### 3.1 Feature Flag

All `window.__synapseAudit` writes are **strictly gated** behind `NEXT_PUBLIC_AUDIT_MODE === "1"`. Production builds are unaffected. The env var is set in the `npm run audit` script and in CI only.

### 3.2 `AppBootstrap.tsx` — PerformanceObserver

```typescript
// Inside useEffect (client component — NOT layout.tsx):
if (process.env.NEXT_PUBLIC_AUDIT_MODE === "1") {
  window.__synapseAudit = { longTasks: [], exportSummaries: [], workerEvents: [] };
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__synapseAudit!.longTasks.push({
        // Convert performance-relative startTime → absolute epoch ms so it's
        // comparable to __auditStartTs (Date.now()) and worker ts (Date.now()).
        epochStartTime: Math.round(performance.timeOrigin + e.startTime),
        duration: e.duration,
        name: e.name,
      });
    }
  });
  obs.observe({ type: "longtask", buffered: true });
  return () => obs.disconnect();  // cleanup on unmount
}
```

**Guards:**
- `AppBootstrap` is already a client component — no server/client boundary issue.
- Observer is disconnected on cleanup to avoid leaking between hot-reloads.
- The buffer is initialized inside the effect, not at module level, so SSR never touches `window`.

### 3.3 `opfs-proxy.worker.ts` — Structured Event Emissions

A single helper at the top of the worker file:

```typescript
function emitAuditEvent(type: string, id: string, meta?: unknown): void {
  self.postMessage({ __auditEvent: true, type, id, ts: Date.now(), meta });
}
```

Emitted events:
| Event | When | Meta fields |
|---|---|---|
| `write_start` | Before `writeFile()` | `{ fileName }` |
| `write_done` | After `writeFile()` resolves | `{ fileName }` |
| `read_start` | Before `readFile()` | `{ fileName }` |
| `read_done` | After `readFile()` resolves | `{ byteLength }` |
| `delete_start` | Before `deleteFile()` | `{ fileName }` |
| `delete_done` | After `deleteFile()` resolves | — |
| `decode_start` | Before `decodeProxy()` | `{ targetWidth, targetHeight }` |
| `decode_done` | After `decodeProxy()` resolves | `{ byteLength }` |

Normal worker message handling (`WRITE_FILE`, `READ_FILE`, etc.) is unaffected — `__auditEvent` messages are a **separate postMessage path** that the main thread branches on before the normal response handler.

### 3.4 `opfs-manager.ts` — Audit Event Bridge

```typescript
worker.onmessage = (e: MessageEvent) => {
  // Branch audit events FIRST, before normal response handling
  if (e.data?.__auditEvent === true && process.env.NEXT_PUBLIC_AUDIT_MODE === "1") {
    window.__synapseAudit?.workerEvents.push({
      type: e.data.type,
      id: e.data.id,
      ts: e.data.ts,
      meta: e.data.meta,
    });
    return; // audit events are not responses — do not resolve any pending promise
  }
  // ... existing response routing
};
```

### 3.5 Dirty-State Sentinel

An always-present, always-rendered hidden element in `AppBootstrap` (client component):

```tsx
<span
  data-testid="dirty-state-indicator"
  data-dirty={isDirty ? "true" : "false"}
  data-flushing={isFlushing ? "true" : "false"}
  className="sr-only"
  aria-hidden
/>
```

This element is always in the DOM regardless of overlay visibility, allowing tests to observe `isDirty` and `isFlushing` state transitions independently.

### 3.5.1 `export-pipeline.ts` — Export Summary Capture

`export-pipeline.ts` already calls `console.info("[SynapseExport] SUMMARY ...")`. To feed that into `window.__synapseAudit.exportSummaries`, `AppBootstrap.tsx` installs a `console.info` interceptor under the same `AUDIT_MODE` gate:

```typescript
// In AppBootstrap useEffect, after window.__synapseAudit initialization:
if (process.env.NEXT_PUBLIC_AUDIT_MODE === "1") {
  const originalInfo = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    const line = args.join(" ");
    if (line.includes("[SynapseExport] SUMMARY")) {
      window.__synapseAudit?.exportSummaries.push(line);
    }
  };
  // Restore on cleanup:
  return () => { console.info = originalInfo; obs.disconnect(); };
}
```

This keeps `export-pipeline.ts` free of any window/audit dependencies (it has zero React/DOM deps by spec), while the capture is entirely opt-in and gated.

### 3.6 `SaveBarrierOverlay.tsx` — Test Hook

```tsx
<div
  data-testid="save-barrier-overlay"
  className="fixed inset-0 ..."
>
```

---

## 4. AuditPage Fixture API

### 4.1 Buffer Management

```typescript
/** Record Date.now() as the start of an audited flow. */
markAuditStart(): Promise<void>
  // stores window.__auditStartTs = Date.now()

/** Clear all audit buffers and reset the start timestamp. */
resetAuditBuffers(): Promise<void>
  // sets window.__synapseAudit = { longTasks: [], exportSummaries: [], workerEvents: [] }
  // sets window.__auditStartTs = Date.now()
```

**Clock domain:** `__auditStartTs` is always `Date.now()` (epoch ms). Long-task `epochStartTime`, worker event `ts`, and `__auditStartTs` are all in the same domain — no conversion needed at filter time.

**Rule:** `resetAuditBuffers()` is called at the beginning of every test flow. All filtering helpers (`readLongTasks`, `parseExportSummary`, `waitForWorkerEvent`) filter their results to entries with `epochStartTime` / `ts` ≥ `window.__auditStartTs`.

### 4.2 `readLongTasks()`

```typescript
interface LongTaskResult {
  entries: SynapseAuditLongTask[];
  maxLongTaskMs: number;
}
readLongTasks(): Promise<LongTaskResult>
```

- Reads `window.__synapseAudit.longTasks`.
- Filters to entries where `epochStartTime >= __auditStartTs` (both in Date.now() epoch domain).
- Returns entries array + computed `maxLongTaskMs = Math.max(0, ...entries.map(e => e.duration))`.

### 4.3 `parseExportSummary()`

```typescript
interface ExportSummary {
  fps: number;
  frames: number;
  maxDriftMicros: number;
  toleranceMicros: number;
  status: "PASS" | "FAIL";
  rawLine: string;
}
parseExportSummary(): Promise<ExportSummary>
```

- Reads `window.__synapseAudit.exportSummaries`.
- **Strict mode:** throws if buffer is empty. Throws if buffer contains >1 entry AND no `markAuditStart()` timestamp was set (prevents cross-test pollution). When multiple summaries exist, returns the **latest** by order of insertion (last element).
- Parses the `[SynapseExport] SUMMARY fps=... frames=... maxDrift=...µs tolerance=...µs status=...` format.

### 4.4 `waitForWorkerEvent(type, options?)`

```typescript
interface WaitForWorkerEventOptions {
  id?: string;         // filter to a specific request id
  timeoutMs?: number;  // default 5000
}
waitForWorkerEvent(type: string, options?: WaitForWorkerEventOptions): Promise<SynapseAuditWorkerEvent>
```

- Polls `window.__synapseAudit.workerEvents` (100ms interval) until a matching entry appears.
- Matches on `event.type === type` and, if `id` is provided, `event.id === id`.
- Filters to events where `event.ts >= __auditStartTs` (both Date.now() epoch).
- Returns the matched event.
- Throws `TimeoutError` if not found within `timeoutMs`.

**Ordering assertion helper** (used in worker-isolation spec):
```typescript
assertWorkerSequence(id: string, ...expectedTypes: string[]): Promise<void>
// Collects all events for `id`, asserts they appear in expectedTypes order
// with monotonically increasing `ts` values.
```

### 4.5 `waitForFlushComplete()`

```typescript
waitForFlushComplete(): Promise<void>
```

Behavioral contract:
1. Assert `dirty-state-indicator` eventually has `data-dirty="true"` (mutation is registered).
2. Wait for `data-flushing` to cycle. **If `data-flushing="true"` is ever observed**, assert that `save-barrier-overlay` is visible during that interval.
3. Primary invariant: route transition must not complete before `data-dirty` returns to `"false"` **or** `data-flushing` returns to `"false"`. Uses `page.waitForSelector` with `state: "attached"` checks on the route change, not a fixed sleep.

---

## 5. Test Flows

### 5.1 Navigation Durability (`nav-durability.spec.ts`)
1. Navigate to `/studio`.
2. `resetAuditBuffers()`.
3. Trigger a project mutation (e.g. rename the project via the settings modal).
4. Assert `data-dirty="true"` on the sentinel.
5. Click a sidebar nav link (e.g. Gallery).
6. `await waitForFlushComplete()`.
7. Assert current URL is `/gallery` only **after** flush completes.
8. Assert `data-dirty="false"` post-navigation.

### 5.2 Export Accuracy (`export-accuracy.spec.ts`)
1. Navigate to `/studio` with a seeded project.
2. `resetAuditBuffers()` + `markAuditStart()`.
3. Trigger export via `data-testid="export-btn"`.
4. Wait for export modal close / completion signal.
5. `const summary = await parseExportSummary()`.
6. Assert: `summary.status === "PASS"`.
7. Assert: `summary.maxDriftMicros <= summary.toleranceMicros`.
8. Assert: `summary.fps` matches the preset config value.

### 5.3 Long-Task Budget (`long-task-budget.spec.ts`)
Three sub-flows, each preceded by `resetAuditBuffers()` + `markAuditStart()`:
- **Scrub flow:** drag the timeline playhead across the full timeline.
- **Batch delete flow:** select all clips, trigger batch delete confirmation.
- **Proxy generate flow:** trigger OPFS proxy generation for a media item.

After each: `const { maxLongTaskMs } = await readLongTasks()` → assert `maxLongTaskMs <= 50`.

### 5.4 Worker Isolation (`worker-isolation.spec.ts`)
1. Navigate to `/studio`.
2. `resetAuditBuffers()` + `markAuditStart()`.
3. Trigger proxy generation for a media item (drives `WRITE_FILE` + `DECODE_PROXY` messages).
4. Capture the request `id` from the `write_start` event.
5. `await assertWorkerSequence(id, "write_start", "write_done")`.
6. For decode: `await assertWorkerSequence(decodeId, "decode_start", "decode_done")`.
7. Assert all events have monotonically increasing `ts`.

---

## 6. Playwright Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [
    // HTML report for human review
    ["html", { outputFolder: "playwright-report", open: "never" }],
    // JUnit XML for CI systems (GitHub Actions, Jenkins, etc.)
    ["junit", { outputFile: "playwright-report/results.xml" }],
  ],
  webServer: {
    command: "NEXT_PUBLIC_AUDIT_MODE=1 npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

**`package.json` script:**
```json
"audit": "playwright test"
```

Reporters are defined exclusively in `playwright.config.ts` — no `--reporter` flag in the script, preventing duplication and drift.

Artifacts on failure: `playwright-report/index.html`, `playwright-report/results.xml`, per-test screenshots, video, and `.zip` trace files in `playwright-report/`.

---

## 7. Implementation Constraints

| Constraint | Detail |
|---|---|
| No API stubbing | WebCodecs, OPFS, AudioContext run for real in headless Chromium |
| Feature flag | All `window.__synapseAudit` writes gated on `NEXT_PUBLIC_AUDIT_MODE === "1"` |
| Server component safety | Dirty-state sentinel lives in `AppBootstrap` (client), never `layout.tsx` |
| Observer cleanup | `obs.disconnect()` in `useEffect` return |
| Worker message safety | `__auditEvent` branch fires `return` before normal response routing |
| Stable selectors | All test interactions use `data-testid` attributes — never CSS class selectors |
| Unified clock | All timestamps (`epochStartTime`, worker `ts`, `__auditStartTs`) use `Date.now()` epoch ms — never `performance.now()` for stored values |
| Time isolation | All fixture helpers filter to entries where timestamp ≥ `window.__auditStartTs` |
