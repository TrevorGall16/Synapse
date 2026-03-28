# Synapse Interactive Hub: Claude Code System Instructions

## Project Context
You are building "Synapse Interactive Hub," a Next.js 15+ browser-native NLE and Discovery Platform. 
- **The Studio:** High-intensity, audio-synced rendering.
- **The Theater:** High-performance DOM-based discovery feed.

## The Synapse Constitution (Hardening Rules)
These 4 invariants are non-negotiable laws. Any violation is a hard-fail.

1. **Schema Strictness (Zero-Trust Ingress):**
   - **NO** `z.unknown()` or `.passthrough()` in `lib/schema.ts` for runtime state.
   - Use `JsonValueSchema` (recursive JSON-safe) for complex objects.
   - Use `.strict()` for core edit models and `.strip()` for feed items.
   - **Legacy Exception:** Only one versioned `legacy_v1` adapter allowed in `lib/schema.ts`.

2. **Authoritative Policy (Mutation Boundary):**
   - `loadSnapshot` in the store is the sole gatekeeper.
   - It **MUST** receive the `post: FeedPost` object and call `canRemix(post)`.
   - Never trust a caller-supplied boolean (e.g., `remixAllowed`).
   - Hard-fail (throw Error + Toast) on policy violation.

3. **Persistence Durability (Async Barrier):**
   - Navigation (`router.push`) **MUST** be `awaited` via `flushProjectToIDB()`.
   - No navigation in `finally` blocks.
   - UI must show a "Saving..." overlay during the await; block navigation if the write fails.
   - Listen to `visibilitychange` and `pagehide` for background flushes.

4. **Ticker Unification (The Master Clock):**
   - **NO** logic-driven `requestAnimationFrame` (rAF).
   - All continuous clocks (Playback, Scrubber, Timeline, Audio Meters) **MUST** use `registerTickCallback` from the `GlobalTicker`.
   - **Whitelist Only:** rAF is only for library wrappers (`confetti.tsx`) or pure CSS-in-JS micro-animations.

## Strict Architectural Rules
- **Modularity:** No file > 900 lines. Separate UI from the Sequencer engine.
- **Theater Logic:** Use standard DOM flow and `<video>` tags. No over-engineering.
- **Hardware Management:** manage React state to prevent VRAM leaks; use OPFS for heavy caching.

## Documentation Imports
- `@file: docs/overview.md` - Philosophy & limits.
- `@file: docs/tech.md` - WebGPU & Audio Master Clock.
- `@file: docs/ui.md` - Vegas Pro timeline mechanics.
- `@file: docs/data.md` - .SYNAPSE JSON schema.