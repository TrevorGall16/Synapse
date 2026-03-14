Project Overview: Synapse Interactive Hub
1. Project Type
High-Performance, Browser-Native Media Sequencing & Discovery Engine (A "Vegas Pro" for the browser).

2. One-Sentence Summary
Synapse is a browser-native "Meta-Engine" that applies high-intensity WebGPU effects over local media and external streams, perfectly synchronized to an audio master clock, without ever hosting the source files.

3. Core Purpose
To empower creators to build, edit, and share high-intensity interactive sessions (sensory-overload/trance content) legally. It provides frame-perfect precision and leverages the user's local hardware for zero-storage, low-latency playback of massive media libraries.

4. Target Users & Philosophy

Audience: Niche content creators, VJs, and sensory-enthusiasts.

Core Philosophy (Option A): Synapse is officially a High-Performance Creative Tool. It is optimized for mid-to-high-tier hardware. While it features graceful degradation and proxy workflows for lower-end devices, it prioritizes creator control and frame-perfect rendering over universal mass-market compatibility.

5. Feature List

The Master Sequencer: A flawless playback engine where Audio is the Master Clock. All video layers, WebGPU shaders, and strobe events act as "slaves" to the audio timestamp, ensuring zero drift during long sessions.

Synapse Studio (NLE): A professional-grade, multi-track timeline editor running in the browser. Supports 0.1ms sub-frame precision, velocity envelopes (speed ramps), automatic crossfading, and dynamic keyframing.

Heavy Media Engine: Capable of handling massive local folders (200GB+) via "Lazy Virtual Indexing" and automatically generating high-speed OPFS (Origin Private File System) proxies for 4K/8K and long-form video.

Discovery Hub & Community: A Supabase-powered ecosystem where creators can share, download, and "Remix" lightweight .SYNAPSE recipes. Includes a strict Local-Only Mode for guests to edit without creating an account (costing the platform $0 in storage).

Local Rendering (Baking): Strict frame-by-frame 4K MP4 export via ffmpeg.wasm. Bakes are processed entirely on the user's hardware to generate a permanent, offline version of their custom-built session.

6. Constraints & Priorities

Hardware Resilience: The browser is a chaotic environment. The app must proactively manage its own survival using a Global Resource Manager (monitoring VRAM, RAM, and OPFS limits) and an Adaptive Resolution Manager (automatically downscaling preview graphics if FPS drops below 45).

Legal & Storage Constraint: Strictly zero-hosting of copyrighted media. The platform acts solely as a Secondary Service Provider. Heavy assets (proxies, undo states) remain 100% client-side.

Data Portability: All sessions are saved as lightweight, heavily sanitized JSON recipes (.SYNAPSE). Paths to local media are stored as relative references to ensure projects remain portable.

7. Success Criteria

Maintain flawless audio-visual sync across hour-long sessions, automatically re-anchoring to the audio context every 100ms.

Survive catastrophic browser events—such as GPU driver resets, tab suspension, or thermal throttling—by automatically rebuilding the WebGPU pipeline from IndexedDB autosaves without losing the user's place.

Achieve a Lighthouse Performance score of 95+ on mobile for the Discovery Hub (viewing and browsing recipes).

Execute sub-16ms latency for all real-time visual effect texture-swaps on mid-range 2026 hardware.