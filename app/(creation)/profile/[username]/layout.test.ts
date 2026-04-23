// app/profile/[username]/layout.test.ts
//
// Route-level regression guard for /profile/[username] — specifically the
// "/profile/you" branch. Protects against code-level breaks of the server
// metadata generator that would cause a 500 at request time.
//
// Does NOT guard against Turbopack/dev-server infrastructure crashes
// (e.g. "Jest worker encountered child process exceptions" from a stale
// compile worker) — those are tooling issues, not code regressions.

import { describe, it, expect } from "vitest";
import { generateMetadata } from "./layout";

function makeParams(username: string): Promise<{ username: string }> {
  return Promise.resolve({ username });
}

// generateMetadata's second arg is a ResolvingMetadata — for the branches we
// exercise below (which never await it) a stub Promise is safe.
const parentStub = Promise.resolve({}) as unknown as Parameters<typeof generateMetadata>[1];

describe("profile/[username] layout — generateMetadata", () => {
  it("returns owner-profile metadata for username 'you' without throwing", async () => {
    const meta = await generateMetadata({ params: makeParams("you") }, parentStub);

    expect(meta.title).toBe("Your Profile · Synapse");
    expect(meta.alternates?.canonical).toBe("/profile/you");
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.metadataBase).toBeInstanceOf(URL);
  });

  it("returns creator metadata for a known mock handle", async () => {
    const meta = await generateMetadata({ params: makeParams("aurora_vj") }, parentStub);

    expect(meta.title).toContain("Aurora VJ");
    expect(meta.title).toContain("@aurora_vj");
    expect(meta.openGraph).toBeDefined();
    expect(meta.openGraph?.type).toBe("profile");
  });

  it("returns noindex fallback metadata for an unknown username", async () => {
    const meta = await generateMetadata({ params: makeParams("nonexistent_ghost") }, parentStub);

    expect(meta.title).toBe("@nonexistent_ghost · Synapse");
    expect(meta.robots).toEqual({ index: false, follow: true });
  });
});
