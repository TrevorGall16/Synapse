/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock the Master Clock with a manual tick driver.
let tickCallbacks: Array<() => void> = [];
vi.mock("@/lib/store/global-ticker", () => ({
  registerTickCallback: (cb: () => void) => {
    tickCallbacks.push(cb);
    return tickCallbacks.length;
  },
  unregisterTickCallback: (id: number) => {
    tickCallbacks[id - 1] = () => {};
  },
}));

import { useGlassIslandState } from "./use-glass-island-state";

function tick() {
  for (const cb of tickCallbacks) cb();
}

function setup() {
  const el = { scrollTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLElement;
  const listener = vi.fn(() => { /* assigned below */ });
  // Capture the scroll listener registered by the hook.
  (el.addEventListener as ReturnType<typeof vi.fn>).mockImplementation((evt: string, cb: () => void) => {
    if (evt === "scroll") listener.mockImplementation(cb);
  });
  const { result } = renderHook(() =>
    useGlassIslandState({ current: el }),
  );
  const setScrollAndTick = (top: number) => {
    (el as { scrollTop: number }).scrollTop = top;
    listener();
    tick();
  };
  return { result, setScrollAndTick };
}

beforeEach(() => { tickCallbacks = []; });
afterEach(() => { tickCallbacks = []; });

describe("useGlassIslandState — hysteresis math", () => {
  it("starts expanded at scroll 0", () => {
    const { result } = setup();
    expect(result.current).toBe(false);
  });

  it("remains expanded on sub-20px jitter", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(10);   // down 10
      setScrollAndTick(5);    // up 5
      setScrollAndTick(13);   // down 8
    });
    expect(result.current).toBe(false);
  });

  it("compresses once sustained downscroll ≥ 20px past the floor", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(100);  // well past FLOOR_PX; delta = 100 ≥ 20
    });
    expect(result.current).toBe(true);
  });

  it("expands once sustained upscroll ≥ 20px from compressed", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(500);  // compress
      setScrollAndTick(470);  // up 30 — should expand
    });
    expect(result.current).toBe(false);
  });

  it("near-top override — always expanded at scrollTop ≤ FLOOR_PX", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(500);  // compress
      setScrollAndTick(5);    // scrollTop ≤ 8 — force expand
    });
    expect(result.current).toBe(false);
  });

  it("clamps accumulator so first upscroll pixel counts after big down", () => {
    const { result, setScrollAndTick } = setup();
    act(() => {
      setScrollAndTick(400);  // big downscroll → compress, accumulator clamped at 20
      setScrollAndTick(380);  // -20 delta, would underflow accumulator to exactly -20
    });
    // A user who scrolls up only 20 px after a 400 px down should see expand
    // without needing to unwind 400 px of debt.
    expect(result.current).toBe(false);
  });
});
