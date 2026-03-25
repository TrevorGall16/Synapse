# Synapse Interactive Hub: Claude Code System Instructions

## Project Context
You are building "Synapse Interactive Hub," a Next.js 15+ browser-native NLE (Non-Linear Editor) and Discovery Platform. It serves two distinct purposes:
1. **The Studio:** A "Vegas Pro in the browser" tailored for high-intensity, audio-synced visual experiences.
2. **The Theater (Discovery Feed):** A high-performance, vertical-scrolling consumption feed for viewing these experiences with native web technologies.

## Strict Architectural Rules
1. **The Core Split (Studio vs. Theater):**
   - **Studio (`/app/studio`):** Follow strict mathematical rendering. Use absolute positioning, Canvas/WebGPU, and strict sub-frame engine logic.
   - **Theater (`/app/page.tsx`, Feed Components):** Use standard DOM flow! Rely on Tailwind Flexbox/Grid, standard HTML5 `<video>` tags, and native CSS filters (like `backdrop-filter` or `blur()`). DO NOT over-engineer the UI feed with Canvas or complex controllers.
2. **Extreme Modularity (Atomic Design):** No single file may exceed 900 lines. You must separate UI rendering logic from the WebGPU/Sequencer engine.
3. **Hardware Guardrails:** You must implement background workers for heavy tasks (OPFS proxy generation) and strictly manage React state to prevent VRAM memory leaks.
4. **Hydration Safety:** Do not use `window` or `Date.now()` during initial render passes.

## Video Lifecycle & Autoplay Guardrails (Theater Mode)
When working on the Theater Mode or video playback outside of the Studio, you MUST adhere to these rules:
- **Autoplay Locks:** Autoplay requires `muted={true}` and `playsInline={true}` directly in the JSX. 
- **Stable Sources:** `<video src={...}>` must be stable. Do NOT continuously call `URL.createObjectURL()` inside `useEffect` dependencies. Use `sessionAliveBlobUrls` from the MediaPool to prevent "interrupted load request" browser errors.
- **Loops & Selections:** Frame-accurate looping must be handled by `requestAnimationFrame` gated behind an `onLoadedMetadata` check, NOT `onTimeUpdate`.
- **Memory:** Always use `URL.revokeObjectURL()` on component unmount for any blobs.

## Documentation Imports
Do not guess the project requirements. You must read and strictly adhere to the following specification documents before implementing features:
- `@file: docs/overview.md` - Core philosophy, target audience, and system limits.
- `@file: docs/tech.md` - WebGPU pipeline, Audio Master Clock, and OPFS caching logic.
- `@file: docs/ui.md` - The layout rules, Vegas Pro timeline mechanics, and UI components.
- `@file: docs/data.md` - The `.SYNAPSE` JSON schema, Supabase cloud sync, and IndexedDB autosave rules.

## Workflow & Git Practices
- **Plan Mode:** Use Plan Mode for complex tasks (like building the timeline sequencer) to ensure thorough planning before implementation.
- **Git Restores:** If a feature breaks the WebGPU context or Audio Sync, immediately restore to the last commit and rethink the approach.