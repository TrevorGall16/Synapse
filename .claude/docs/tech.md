# **Tech Stack: Synapse Interactive Hub**

> **CRITICAL INSTRUCTION FOR THE BUILDER AI:** This tech stack operates in two distinct modes. The Heavy Engine (WebGPU, AudioContext) is strictly for the `/app/studio/` environment. The Discovery Feed (`/app/page.tsx`) uses standard, lightweight web APIs. Do not mix them.

### **1. Primary Stack Selection**
* **Core Technologies:** Next.js 15+ (App Router), TypeScript, Tailwind CSS.
* **Studio Graphics & Media Pipeline:** WebGPU (Rendering/Shaders), WebCodecs (Hardware Decoding), `ffmpeg.wasm` (Multithreaded Export).
* **Theater/Feed Pipeline:** Native HTML5 `<video>`, CSS GPU-acceleration (`transform`, `filter`), and `requestAnimationFrame`.
* **Backend & Auth:** Supabase (PostgreSQL, Auth, REST API for Discovery Hub).
* **Browser Storage APIs:** IndexedDB (State/Metadata) and OPFS (Origin Private File System).

### **2. File & Folder Structure (Deterministic)**
```text
/root
  ├── app/                     (Next.js App Router)
  │   ├── layout.tsx           
  │   ├── page.tsx             (Discovery Hub / Home Feed - LIGHTWEIGHT)
  │   ├── studio/              (Vegas Pro-style NLE workspace - HEAVY)
  │   └── vault/               (User's saved .SYNAPSE recipes)
  ├── components/              
  │   ├── feed/                (Theater Mode, standard React/Tailwind)
  │   ├── gpu/                 (Shader logic & Compute Shader Sandboxes)
  │   └── timeline/            (Sub-frame precision tracks & keyframe UI)
  ├── lib/                     
  │   ├── engine/              (Master Audio Clock & Event Queue - STUDIO ONLY)
  │   ├── managers/            (Centralized Resource & Adaptive Res Managers)
  │   └── protocols/           (.SYNAPSE JSON schema & Version Hashes)
  └── workers/                 (Web Workers for OPFS Proxies & Deep Hash checks)

  3. Data Structures & Storage Protocols
IndexedDB (Metadata & State): Stores local file handles, .SYNAPSE recipes, and the 20-step diff-based undo stack.

OPFS (Heavy Assets): Stores all generated Low-Res Proxies for the Studio. Proxies are shared across projects and deduplicated.

Supabase (Cloud): Stores the 5MB capped .SYNAPSE JSON recipes for the Discovery Hub.

4. API & Core Engine Logic (STUDIO ONLY)
The Master Clock: In the Studio, Audio is the Master Clock. Video, strobes, and shaders are Slaves. The engine re-anchors visual timing to AudioContext.currentTime every 100ms. (Note: The Theater feed does NOT use this; it relies on standard HTML5 video timing).

Event Scheduling (Model A): The Studio engine uses an Event Queue. Timeline events for the next 10 seconds are pre-calculated.

Proxy Generator (Background Worker): Videos 20–60 minutes long trigger proxy generation. 8K videos are forced into proxy mode.

5. Hardware Guardrails & Performance
Centralized Resource Manager: Continuously monitors GPU VRAM, System RAM, and OPFS limits. Triggers LRU (Least Recently Used) Eviction at 85% capacity.

Adaptive Resolution Manager: Target is 60 FPS in the Studio. If FPS drops below 45 for >3 seconds, the engine auto-downscales the preview (e.g., 4K → 1080p).

GPU Tier Detection: Runs a hardware benchmark at startup to categorize the GPU (High/Medium/Low).

6. Security & Environment
GPU Watchdog Prevention: Complex shaders are split into multiple compute passes to prevent triggering the browser's 2-second GPU watchdog kill-switch.

Export Determinism: Final MP4 bakes disable all preview optimizations, rendering strictly frame-by-frame via ffmpeg.wasm.

Hydration Guardrail: Strictly forbid logic checking for window or using Date.now() during the initial render pass to prevent hydration mismatches.