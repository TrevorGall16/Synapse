# **Tech Stack: Synapse Interactive Hub**

### **1. Primary Stack Selection**
* **Core Technologies:** Next.js 15+ (App Router), TypeScript, Tailwind CSS.
* **Graphics & Media Pipeline:** WebGPU (Rendering/Shaders), WebCodecs (Hardware Decoding/Seeking), `ffmpeg.wasm` (Multithreaded Client-Side Export).
* **Backend & Auth:** Supabase (PostgreSQL, Auth, REST API for Discovery Hub).
* **Browser Storage APIs:** IndexedDB (State/Metadata) and OPFS (Origin Private File System).

### **2. Stack Justification**
* **WebGPU** ensures sub-16ms latency for complex multi-layer shaders. **OPFS** provides near-native read/write speeds for heavy 4K proxies without hitting IndexedDB quotas. **Supabase** enables lightweight cloud syncing and collaborative locking without heavy backend infrastructure.

### **3. File & Folder Structure (Deterministic)**
```text
/root
  ├── app/                     (Next.js App Router)
  │   ├── layout.tsx           
  │   ├── page.tsx             (Discovery Hub / Home)
  │   ├── studio/              (Vegas Pro-style NLE workspace)
  │   └── vault/               (User's saved .SYNAPSE recipes & Local-Only mode)
  ├── components/              
  │   ├── gpu/                 (Shader logic & Compute Shader Sandboxes)
  │   ├── timeline/            (Sub-frame precision tracks & keyframe UI)
  │   └── ui/                  (Anti-AI depth-styled components)
  ├── lib/                     
  │   ├── engine/              (Master Audio Clock & Model A Event Queue)
  │   ├── managers/            (Centralized Resource & Adaptive Res Managers)
  │   └── protocols/           (.SYNAPSE JSON schema & Version Hashes)
  ├── supabase/                (Migrations & DB Types)
  ├── workers/                 (Web Workers for OPFS Proxies & Deep Hash checks)
  ├── public/                  (Static assets & ffmpeg.wasm binaries)
  └── package.json

  4. Data Structures & Storage Protocols
IndexedDB (Metadata & State): Stores local file handles, lightweight index caches (for 200GB+ lazy indexing), 1-minute atomic autosaves, and the 20-step diff-based undo stack.

OPFS (Heavy Assets): Stores all generated Low-Res Proxies. Proxies are shared across projects and deduplicated based on the source file's XXHash.

Supabase (Cloud): Stores the 5MB capped .SYNAPSE JSON recipes. Uses a 15-minute "First-In" heartbeat lock for collaborative editing protection.

Timing Precision: All internal timestamps use Microsecond Integers (Int64) as relative offsets per clip to prevent floating-point drift over 6-hour sessions.

5. API & Core Engine Logic
The Master Clock: Audio is the Master Clock. Video, strobes, and shaders are Slaves. The engine re-anchors visual timing to AudioContext.currentTime every 100ms. For silent sessions, visual_time = frame_count / target_fps is used as a fallback.

Event Scheduling (Model A): The engine uses an Event Queue. Timeline events for the next 10 seconds are pre-calculated. If a 10s window exceeds 50k events, they are compressed into procedural patterns.

Proxy Generator (Background Worker): Videos 20–60 minutes long trigger proxy generation (1 worker at a time). 8K videos are forced into proxy mode.

6. Hardware Guardrails & Performance
Centralized Resource Manager: Continuously monitors GPU VRAM, System RAM, and OPFS limits. Triggers LRU (Least Recently Used) Eviction at 85% capacity. VRAM temporary buffers are aggressively purged after every bake.

Adaptive Resolution Manager: Target is 60 FPS. If FPS drops below 45 for >3 seconds, the engine auto-downscales the preview (e.g., 4K → 1080p).

GPU Tier Detection: Runs a hardware benchmark at startup to categorize the GPU (High/Medium/Low) and warns users on integrated graphics about feature limitations.

7. Security & Safety
GPU Watchdog Prevention: Complex shaders are split into multiple compute passes to prevent triggering the browser's 2-second GPU watchdog kill-switch.

Export Determinism: Final MP4 bakes disable all preview optimizations, rendering strictly frame-by-frame. Pre-export checks calculate Bitrate × Duration to abort if disk quota is insufficient.

8. Environment & Build Safety
Node.js: Runtime pinned to v20.x via .nvmrc.

Case-Sensitivity: All file names must use kebab-case.

Hydration Guardrail: Strictly forbid logic checking for window or using Date.now() during the initial render pass to prevent hydration mismatches.