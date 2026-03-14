# **UI Specification: Synapse Interactive Hub (Master Blueprint)**

> **CRITICAL INSTRUCTION FOR THE BUILDER AI:** This is a high-performance Non-Linear Editor (NLE). Do not use native CSS scrolling for the timeline layout. Do not use relative DOM positioning for clips. The timeline is a mathematical canvas. Read all coordinate math and constraint rules carefully before implementing.

## **1. Architectural Principles & Atomic Design**
* **The 400-Line Limit:** Absolutely no React component or file may exceed 400 lines. If `<Timeline />` grows, immediately decompose it into `<TimelineRuler />`, `<TrackLane />`, `<Playhead />`, etc.
* **Layout Swappability:** `<MainWorkspace>` uses `react-resizable-panels`. Moving panels must strictly alter Flexbox layouts without triggering full DOM repaints of the timeline clips.
* **Zustand Render Optimization:** The global `currentTime` state MUST NOT trigger a re-render of the entire `<TimelineCanvas />`. Only the `<Playhead />` and `<PreviewMonitor />` components should directly subscribe to rapid time state updates. Clips should only subscribe to their own specific property states.
* **Performance & Virtualization:** Use `React.memo` on all clip components with deep equality checks on clip data to prevent unnecessary renders. If a track contains thousands of clips, it must be virtualized.
* **The Component Tree (Enforced):**
  ```text
  <StudioApp> (Strict 100vh, overflow: hidden)
  ├─ <Sidebar />                
  ├─ <MainWorkspace>            
  │  ├─ <MediaPool />           
  │  ├─ <PreviewMonitor />      
  │  └─ <TimelineCanvas>        # Custom Pan/Zoom Area
  │      ├─ <TimelineRuler />   # Dynamic ticks based on zoom
  │      ├─ <TrackStack>        
  │      │   ├─ <VideoTrack />  # Renders top-down (Track 3 over 2)
  │      │   │   └─ <ClipEvent /> # Absolute positioning ONLY
  │      │   ├─ <AudioTrack />  
  │      │   ├─ <TextTrack />   # Fixed top priority
  │      │   └─ <EffectTrack /> # Fixed top priority
  │      └─ <Playhead />        # Absolute position, z-index 9999
  └─ <Modals />                 

```

## **2. Global Layout Constraints & Visual Identity**

* **Zero Native Scrollbars:** The root `<body>` and `<StudioApp>` must have `overflow: hidden; height: 100vh;`. The timeline tracks container can use `overflow-x: scroll`, but you **MUST hide the scrollbar visually** using `::-webkit-scrollbar { display: none; }`.
* **Visual Depth:** Backgrounds are `#1a1a1a` (slate-900). Pure black is forbidden. All panels and track headers must have a 1px top highlight (`border-t border-white/20`) to simulate physical depth.

## **3. Timeline Canvas Mathematics (Core Engine)**

The timeline does NOT use CSS percentages or Flexbox for clips. It uses absolute positioning.

* **CRITICAL CSS TRAP:** Control horizontal position using GPU-accelerated CSS transforms (`transform: translate3d(Xpx, 0, 0)`) rather than the `left` property to prevent layout thrashing and CPU spikes. Control duration via the `width` property.
* **The Constants & State:**
* `BASE_PIXELS_PER_SECOND = 100` (1 second = 100px at 1.0 zoom).
* `zoomLevel` (Zustand state, float, e.g., 0.1 to 10.0).
* `pixelsPerSecond = BASE_PIXELS_PER_SECOND * zoomLevel`.


* **The Formulas:**
* To calculate pixel width/X-offset from time: $X = T \times \text{pixelsPerSecond}$
* To calculate time from pixels: $T = X / \text{pixelsPerSecond}$


* **Pixel-Perfect Scrubbing:** * Do NOT use standard bounding box ratios. To find the exact time clicked, use this exact math on the container ref:
* `const rawX = e.clientX - containerRect.left + container.scrollLeft;`
* `const targetTimeSeconds = rawX / pixelsPerSecond;`


* **Click, Drag & Pointer Capture:**
* When scrubbing the playhead or trimming a clip, the user will drag their mouse outside the container.
* On `onPointerDown`, you MUST call `e.currentTarget.setPointerCapture(e.pointerId)`.
* Track movement on `onPointerMove`.
* On `onPointerUp`, call `e.currentTarget.releasePointerCapture(e.pointerId)`.


* **Ctrl + Mouse Wheel Zooming:**
* Listen for `onWheel`. If `e.ctrlKey` or `e.metaKey` is true: `e.preventDefault()`.
* Calculate the time directly under the mouse cursor *before* the zoom.
* Adjust `zoomLevel` (e.g., multiply/divide by 1.1).
* Adjust `container.scrollLeft` so the time previously under the cursor remains exactly under the cursor after the zoom.


* **Ruler Tick Generation Algorithm:**
* The ruler must dynamically render ticks based on `pixelsPerSecond` to prevent overlapping numbers.
* If `pixelsPerSecond > 500` (Zoomed way in): Show ticks every 1 frame.
* If `pixelsPerSecond > 50` (Normal view): Show ticks every 1 second.
* If `pixelsPerSecond > 5` (Zoomed out): Show ticks every 10 seconds.
* Else (Extreme zoom out): Show ticks every 1 minute.



## **4. Track Hierarchy & Vegas Pro Layering**

* **Z-Index and Rendering Order:** Higher video tracks (Video 3) visually override lower tracks (Video 2).
* **Fixed Special Tracks:** `<TextTrack />` and `<EffectTrack />` are pinned to the top of the stack. They act as global adjustment layers.
* **WebGPU Effect Track:** Shaders are applied via a stack (`effectStack: Shader[]`). Dropping a shader onto the Effect Track applies it globally to all layers beneath it. Dropping a shader directly onto a Video Clip adds it to that specific clip's internal `effectStack`.
* **Track Headers:** Left-side controls for `[M]` (Mute), `[S]` (Solo), `[FX]`, and a generic slider (Opacity for video, Volume for audio).

## **5. Transport Control & 60FPS Precision**

* Standard HTML5 playback is not frame-accurate. We target **60 FPS**.
* **Microsecond Math (State vs. APIs):** The Zustand store strictly tracks time in integer microseconds to prevent floating-point drift over long editing sessions.
* 1 Frame = 16,666 microseconds.
* "Next Frame" adds exactly `16666` to the state. "Prev Frame" subtracts `16666`.


* **The API Trap:** When feeding this state to standard HTML5 Video APIs (`video.currentTime`), the AI MUST divide the microsecond state by `1_000_000` to yield exactly `0.016666` seconds.

## **6. Clip Lifecycle & The F4 Inspector (DOM Optimization)**

* **Clip Trimming & Fades:** Trim handles must mathematically update the clip's `startTime` and `duration` properties in Zustand, not just blindly change CSS width. Adjusting fade handles alters the crossfade curves (Linear, Smooth, Fast, Slow).
* **The Paradigm:** `<ClipEvent />` components should ONLY display their title, start/end trim handles, and a fade-in/out top-corner triangle. Do NOT put complex UI controls (opacity sliders, crop wheels) directly on the clip element to save DOM performance.
* **The F4 Inspector (Properties Panel):** Double-clicking a clip, or pressing F4, opens a dedicated properties modal/panel.
* **Video Tab:** Opacity, Pan/Crop (X/Y, Zoom, Rotation), Color Correction, Keyframe Editor.
* **Audio Tab:** Volume, Pan, Playback Speed.
* **Effects Tab:** WebGPU shader list for this specific clip.



## **7. Shortcuts, Snapping & Advanced UX Feedback**

* **Undo/Redo:** All timeline mutations (moving clips, trimming, adding tracks) must be fully undoable using a Zustand middleware or command pattern.
* **Snapping Logic:** Clips and the playhead automatically snap to markers, other clip edges, and precise frame boundaries. Holding `Shift` while dragging temporarily disables snapping for freeform placement.
* **Global Shortcuts:**
* `Space`: Play/Pause
* `S`: Split clip at playhead
* `M`: Add marker (color-coded by intensity)
* `F4`: Open Clip Inspector
* `Delete`: Delete selected clip


* **Action-Ghosting:** Clicking a UI button briefly "flashes" its corresponding keyboard shortcut over the button to train muscle memory.
* **Modals:**
* **Cloud Conflict Split-Screen:** Two timelines side-by-side (local vs cloud) for cherry-pick merging.
* **VRAM Purge Toast:** "GPU Optimizing (Tab: Project Name) – 45%" progress bar.



