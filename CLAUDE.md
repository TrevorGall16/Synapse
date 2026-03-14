# Synapse Interactive Hub: Claude Code System Instructions

## Project Context
You are building "Synapse Interactive Hub," a Next.js 15+ browser-native NLE (Non-Linear Editor) and Discovery Platform. It is a "Vegas Pro in the browser" tailored for high-intensity, audio-synced visual experiences. 

## Strict Architectural Rules
1. **Extreme Modularity (Atomic Design):** No single file may exceed 400 lines. You must separate UI rendering logic from the WebGPU/Sequencer engine. 
2. **Component Isolation:** The Sidebar, Video Player, Feed Cards, and Studio Timeline must be completely independent React components.
3. **Hardware Guardrails:** You must implement background workers for heavy tasks (OPFS proxy generation) and strictly manage React state to prevent VRAM memory leaks.
4. **Hydration Safety:** Do not use `window` or `Date.now()` during initial render passes.

## Documentation Imports
Do not guess the project requirements. You must read and strictly adhere to the following specification documents before implementing features:

- `@file: docs/overview.md` - Core philosophy, target audience, and system limits.
- `@file: docs/tech.md` - WebGPU pipeline, Audio Master Clock, and OPFS caching logic.
- `@file: docs/ui.md` - The RedGIFs-style layout, Vegas Pro timeline mechanics, and UI components.
- `@file: docs/data.md` - The `.SYNAPSE` JSON schema, Supabase cloud sync, and IndexedDB autosave rules.
- `@file: docs/ads.md` - Monetization placements, CPA affiliate link locking, and DMCA safety.

## Workflow & Git Practices
- **Plan Mode:** Use Plan Mode for complex tasks (like building the timeline sequencer) to ensure thorough planning before implementation.
- **Git Restores:** If a feature breaks the WebGPU context or Audio Sync, immediately restore to the last commit and rethink the approach.
- **Thinking:** Use "think hard" or "ultrathink" when writing the Master Audio Clock and Event Queue logic.

## Custom Commands
- `/build-ui` -> Focus strictly on React components using Tailwind, isolated from engine logic.
- `/build-engine` -> Focus strictly on WebGPU, WebCodecs, and the Event Queue.