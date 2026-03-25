# Project Overview: Synapse Interactive Hub

## 1. Project Type
High-Performance, Browser-Native Media Sequencing Engine & Social Discovery Platform.

## 2. One-Sentence Summary
Synapse is a browser-native "Meta-Engine" that applies high-intensity WebGPU effects over local media and external streams, perfectly synchronized to an audio master clock, without ever hosting the source files. 

## 3. Core Purpose
To empower creators to build, edit, and share high-intensity interactive sessions (sensory-overload/trance content) legally. It provides a dual-experience: a frame-perfect timeline for creators (Studio), and a frictionless, immersive endless feed for viewers (Theater).

## 4. Target Users & Philosophy
* **Audience:** Niche content creators, VJs, and sensory-enthusiasts.
* **Core Philosophy:** Synapse is officially a High-Performance Creative Tool. While it prioritizes creator control and frame-perfect rendering for mid-to-high-tier hardware, its consumption layer (Discovery Hub) is built to feel as fast and native as a mobile social media app.

## 5. Feature List

* **The Discovery Hub & Theater Mode:** A TikTok-style, endless vertical feed. It features instant-autoplay, "Mirror Blur" cinematic backgrounds for vertical video, and interactive elements (Double-tap to like, Hashtag filtering) powered by a lightweight local database.
* **Synapse Studio (NLE):** A professional-grade, multi-track timeline editor running in the browser. Supports 0.1ms sub-frame precision, velocity envelopes (speed ramps), automatic crossfading, and dynamic keyframing.
* **The Master Sequencer:** A flawless playback engine where Audio is the Master Clock. All video layers, WebGPU shaders, and strobe events act as "slaves" to the audio timestamp, ensuring zero drift during long sessions.
* **Heavy Media Engine:** Capable of handling massive local folders (200GB+) via "Lazy Virtual Indexing" and automatically generating high-speed OPFS proxies for 4K/8K and long-form video.
* **Local Rendering (Baking):** Strict frame-by-frame 4K MP4 export via `ffmpeg.wasm`. Bakes are processed entirely on the user's hardware.

## 6. Constraints & Priorities

* **Legal & Storage Constraint:** Strictly zero-hosting of copyrighted media. The platform acts solely as a Secondary Service Provider. Heavy assets (proxies, undo states) remain 100% client-side.
* **Data Portability:** All sessions are saved as lightweight, heavily sanitized JSON recipes (`.SYNAPSE`). Paths to local media are stored as relative references to ensure projects remain portable.
* **Hardware Resilience:** The browser is a chaotic environment. The app must proactively manage its own survival using a Global Resource Manager and an Adaptive Resolution Manager.

## 7. Success Criteria
* **Instant Feed:** The Discovery Hub must load and autoplay videos with zero latency upon user interaction.
* **Flawless Sync:** Maintain flawless audio-visual sync across hour-long sessions, automatically re-anchoring to the audio context every 100ms.
* **Crash Recovery:** Survive catastrophic browser events by automatically rebuilding the WebGPU pipeline from IndexedDB autosaves without losing the user's place.