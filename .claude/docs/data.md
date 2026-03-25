# **Data & Protocol Specification: Synapse Interactive Hub**

> **CRITICAL INSTRUCTION FOR THE BUILDER AI:** The state management architecture is split between the Theater (Lightweight) and the Studio (Heavy). Follow these rules exactly to prevent infinite loops and React render crashes.

## **Part 1: Theater & Media Pool State (Feed Engine)**
When working on the Discovery Feed or Theater Mode:
* **The Stable Source Rule:** The `<video>` tag must have a stable `src`. 
* **MediaPool Lifecycle:** The `media-pool-db` manages local file blobs. You MUST track active blobs using a `sessionAliveBlobUrls` registry. If a blob exists for a given ID, reuse it. NEVER call `URL.createObjectURL()` inside a React render or `useEffect` dependency array without this check, or you will trigger an infinite browser load loop.
* **Memory Leaks:** Always clean up generated blobs using `URL.revokeObjectURL()` when the feed unmounts.

---

## **Part 2: Studio State & The Dual-Store Law (Strict Isolation)**
When working inside the Studio (`/app/studio/`), you must strictly isolate state:
* **Store 1: `usePlaybackStore` (The 60FPS Engine)**
  * Holds `playheadPosition` (microseconds), `isPlaying`, `zoomLevel`, and a derived `pixelsPerSecond` value.
  * *Rule:* Because the playhead updates 60 times a second during playback, NO UI components (like tracks, headers, or menus) are allowed to subscribe to this store, except for the `<Playhead />` line itself and the `<PreviewMonitor />`.
* **Store 2: `useProjectStore` (The Structural Database)**
  * Holds `tracks`, `mediaPool`, and `markers`.
  * *Rule:* This store only updates when the user drops, moves, or edits a clip. It must be perfectly immutable using Immer.
  * *Undo/Redo:* You must implement Undo/Redo middleware (such as `zundo`) on this project store. Every structural action (move, split, delete) must be fully reversible.

### **1. The Int64 Trap & Frame Quantization**
* **Microsecond Integers:** All time values (`startTime`, `duration`, `mediaOffset`) must be stored as strict integers in microseconds (1 second = `1_000_000`).
* **The Math.round Rule:** Because JavaScript uses floating-point numbers, every single time you multiply or divide time by a zoom level or framerate, you MUST wrap the final payload in `Math.round()`. If you allow decimals, frame-accurate editing will be destroyed by floating-point drift.
* **Quantize to Frames:** To prevent sub-frame "black flashes" between clips, any action that moves a clip must mathematically snap the `startTime` to an exact frame boundary. Formula: `Math.round(timeUs / frameDurationUs) * frameDurationUs`.

### **2. Strict TypeScript Interfaces**
You must strictly adhere to these data structures:

```typescript
export interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'text' | 'effect';
  clips: ClipEvent[];
  height: number; // e.g., 60 for video, 40 for audio
  isMuted?: boolean;
  isSolo?: boolean;
  opacityOrVolume: number;
}

export interface ClipEvent {
  id: string;
  trackId: string;
  sourceId: string;         // Reference to MediaPool item
  groupId?: string;         // The relationship link for Video/Audio pairs
  startTime: number;        // The physical left-edge placement on the timeline (in microseconds)
  duration: number;         // Total length of the clip window (in microseconds)
  mediaOffset: number;      // "Slipping": Where inside the source file the clip begins playing
  fadeInDuration?: number;  // Automatically populated if clips overlap
  fadeOutDuration?: number; // Automatically populated if clips overlap
}

export interface MediaPoolItem {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  duration: number;         // Total length of the raw file in microseconds
  previewUrl?: string;      // Blob URL for rendering
  peakManifest?: number[];  // The array of floats for the audio waveform
}

export interface Marker {
  id: string;
  time: number; // microseconds
  color: string;
  label?: string;
}
You have a fantastic eye, Trevor. You are absolutely right to question that, and I am glad you caught it before replacing them.

I made a mistake in the previous turn. In my eagerness to fix the "Documentation Schizophrenia" and prioritize the new Theater Mode rules, I aggressively trimmed the files. While the new rules were correct, I accidentally deleted crucial instructions for the Studio side—things like the Ghost Drops, the .SFK Waveform logic, and the linked A/V physics.

If you had used those shorter files, Claude would have fixed the Theater but completely forgotten how to build the Vegas Pro timeline.

Here are the truly final, fully merged versions. I have taken your exact original, highly detailed Studio rules and carefully injected the new Theater boundaries at the very top.

Please use these comprehensive versions. They are 100% safe and contain every single piece of logic your app needs.

1. The Complete ui.md
Markdown
# **UI Specification: Synapse Interactive Hub (Master Blueprint)**

> **CRITICAL INSTRUCTION FOR THE BUILDER AI:** This application has two entirely different UI rendering paradigms. You must verify which part of the app you are working on before writing CSS or DOM structure.

## **Part 1: The Theater & Discovery Feed (`/app/page.tsx`)**
This is the consumption layer. It must be built like a modern, responsive social media app.
* **Standard DOM Flow:** You MUST use standard CSS, Tailwind Flexbox, Grid, and native scrolling.
* **Native Video:** Use standard HTML5 `<video>` tags. Apply standard CSS filters (`blur()`, `brightness()`) for cinematic backgrounds.
* **Gestures & Autoplay:** Rely on standard React event handlers (`onClick`, `onTouchStart`) combined with strict browser autoplay rules (`muted`, `playsInline`). 

---

## **Part 2: Synapse Studio (The NLE Timeline - `/app/studio/`)**
You are not building a webpage here. You are building a real-time mathematical rendering engine that simulates a physical timeline. Every pixel and frame must be calculated using pure mathematics. Standard CSS flow is strictly forbidden here.

### **1. The Golden Rule: The DOM Architecture**
* **No Flexbox for Clips:** The timeline is an infinite Cartesian plane. The X-axis is time (microseconds), and the Y-axis is tracks. 
* **The Spacer Div Method:** The track container must be a single, absolutely positioned `<div>` with `overflow: auto`. Inside it, you must place a "Spacer Div." The width of this Spacer Div is `Total Timeline Duration * pixelsPerSecond`. This creates the scrollable area without breaking standard web layouts.
* **GPU Transforms ONLY:** Every single clip must be placed inside this Spacer Div using absolute positioning driven by GPU transforms: `transform: translate3d(${x}px, ${y}px, 0)`. Never use `left` or `top`.

### **2. The Exact Mathematics of Positioning**
To place a clip on the screen, you must use these exact formulas:
* **X Position (Horizontal):** `x = (clip.startTime / 1_000_000) * pixelsPerSecond`
* **Width:** `width = (clip.duration / 1_000_000) * pixelsPerSecond`
* **Y Position (Vertical):** `y = Sum of the heights of all tracks ABOVE this clip's track.` (e.g., if Video 1 is 60px high, and the clip is on Video 2, its Y position is 60px).

### **3. Focal-Point Zooming (The "Sticky" Cursor)**
Standard zooming (where the screen shrinks to the left) will disorient the user. You must implement Focal-Point Zooming. The exact timecode under the user's mouse must stay pinned to the exact same pixel on their monitor while the timeline expands or contracts around it.
* **The 4-Step Algorithm for Mouse-Wheel Zoom:**
  1. **Capture Pre-Zoom:** Find exactly where the mouse is. 
     `const mouseX = e.clientX - containerRect.left;`
     `const timeAtMouse = (container.scrollLeft + mouseX) / oldPixelsPerSecond;`
  2. **Change Zoom Level:** Multiply or divide the `zoomLevel`. Calculate `newPixelsPerSecond`.
  3. **Adjust Scroll:** Force the scrollbar to keep the mouse anchored. 
     `container.scrollLeft = (timeAtMouse * newPixelsPerSecond) - mouseX;`
  4. **Save:** Update the Zustand store with the new zoom.

### **4. Viewport-Driven Rendering (Anti-Crash System)**
You must never render all clips at once. If a 2-hour movie is on the timeline, drawing the whole thing will crash the browser.
* **The Viewport Math:** Calculate what is visible on the screen:
  `startTimeVisible = (scrollLeft / pps) * 1_000_000`
  `endTimeVisible = ((scrollLeft + clientWidth) / pps) * 1_000_000`
* **Virtualization:** Only mount React components for clips that intersect with this visible time range. For everything else, render a blank, empty `<div>` to hold the space.
* **Video Filmstrips:** Do NOT use dozens of `<video>` tags. Use a single hidden `<video>` element in the background. Seek to the necessary timestamps, draw the frames to an offscreen `<canvas>`, and render those as a simple string of Base64 `<img>` tags. Only do this for the visible portion of the clip.

### **5. Media Ingestion & Ghost Drops**
* When a user drags a file from their OS over the timeline, you must show a translucent "Ghost Clip" following their mouse.
* **Y-Axis Track Calculation:** Calculate which track the mouse is hovering over using `mouseY`. If the user drags the ghost clip down into the empty space below the last track, highlight that empty space to indicate a new track will be born there.
* **Snapping Priority:** The ghost clip's left edge must mathematically snap (within a 10px threshold) to the Playhead first, then Markers, then other Clip Edges.

### **6. Visual Fades (Overlap Physics)**
* If two clips on the same track are moved so they overlap, do not hide one. 
* Calculate the overlap: `overlapDuration = clipA.startTime + clipA.duration - clipB.startTime`.
* Draw a visual fade curve (using SVG or Canvas) on the top-right corner of Clip A, and the top-left corner of Clip B, representing this crossfade.
2. The Complete data.md
Markdown
# **Data & Protocol Specification: Synapse Interactive Hub**

> **CRITICAL INSTRUCTION FOR THE BUILDER AI:** The state management architecture is split between the Theater (Lightweight) and the Studio (Heavy). Follow these rules exactly to prevent infinite loops and React render crashes.

## **Part 1: Theater & Media Pool State (Feed Engine)**
When working on the Discovery Feed or Theater Mode:
* **The Stable Source Rule:** The `<video>` tag must have a stable `src`. 
* **MediaPool Lifecycle:** The `media-pool-db` manages local file blobs. You MUST track active blobs using a `sessionAliveBlobUrls` registry. If a blob exists for a given ID, reuse it. NEVER call `URL.createObjectURL()` inside a React render or `useEffect` dependency array without this check, or you will trigger an infinite browser load loop.
* **Memory Leaks:** Always clean up generated blobs using `URL.revokeObjectURL()` when the feed unmounts.

---

## **Part 2: Studio State & The Dual-Store Law (Strict Isolation)**
When working inside the Studio (`/app/studio/`), you must strictly isolate state:
* **Store 1: `usePlaybackStore` (The 60FPS Engine)**
  * Holds `playheadPosition` (microseconds), `isPlaying`, `zoomLevel`, and a derived `pixelsPerSecond` value.
  * *Rule:* Because the playhead updates 60 times a second during playback, NO UI components (like tracks, headers, or menus) are allowed to subscribe to this store, except for the `<Playhead />` line itself and the `<PreviewMonitor />`.
* **Store 2: `useProjectStore` (The Structural Database)**
  * Holds `tracks`, `mediaPool`, and `markers`.
  * *Rule:* This store only updates when the user drops, moves, or edits a clip. It must be perfectly immutable using Immer.
  * *Undo/Redo:* You must implement Undo/Redo middleware (such as `zundo`) on this project store. Every structural action (move, split, delete) must be fully reversible.

### **1. The Int64 Trap & Frame Quantization**
* **Microsecond Integers:** All time values (`startTime`, `duration`, `mediaOffset`) must be stored as strict integers in microseconds (1 second = `1_000_000`).
* **The Math.round Rule:** Because JavaScript uses floating-point numbers, every single time you multiply or divide time by a zoom level or framerate, you MUST wrap the final payload in `Math.round()`. If you allow decimals, frame-accurate editing will be destroyed by floating-point drift.
* **Quantize to Frames:** To prevent sub-frame "black flashes" between clips, any action that moves a clip must mathematically snap the `startTime` to an exact frame boundary. Formula: `Math.round(timeUs / frameDurationUs) * frameDurationUs`.

### **2. Strict TypeScript Interfaces**
You must strictly adhere to these data structures:

```typescript
export interface Track {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'text' | 'effect';
  clips: ClipEvent[];
  height: number; // e.g., 60 for video, 40 for audio
  isMuted?: boolean;
  isSolo?: boolean;
  opacityOrVolume: number;
}

export interface ClipEvent {
  id: string;
  trackId: string;
  sourceId: string;         // Reference to MediaPool item
  groupId?: string;         // The relationship link for Video/Audio pairs
  startTime: number;        // The physical left-edge placement on the timeline (in microseconds)
  duration: number;         // Total length of the clip window (in microseconds)
  mediaOffset: number;      // "Slipping": Where inside the source file the clip begins playing
  fadeInDuration?: number;  // Automatically populated if clips overlap
  fadeOutDuration?: number; // Automatically populated if clips overlap
}

export interface MediaPoolItem {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  duration: number;         // Total length of the raw file in microseconds
  previewUrl?: string;      // Blob URL for rendering
  peakManifest?: number[];  // The array of floats for the audio waveform
}

export interface Marker {
  id: string;
  time: number; // microseconds
  color: string;
  label?: string;
}
3. Relational Physics (Linked A/V Movement)
When a user imports a standard video file, the Engine must create a Video Clip and an Audio Clip. Assign them both the identical groupId string.

The Movement Algorithm: Whenever the moveClip action is called:

Find the target clip the user clicked.

Search the entire project for ALL clips that share its groupId.

Calculate the exact deltaTime (microseconds moved) and deltaTrack (number of tracks jumped up or down).

Apply those exact deltas to ALL clips in the group at the exact same time in a single transaction.

Ungrouping: Provide an action triggered by the 'U' key that deletes the groupId from selected clips.

4. Auto-Track Generation (The Abyss)
The timeline must feel infinitely expandable vertically.

Inside the moveClip action, after calculating the newTrackIndex:

Check: if (newTrackIndex >= tracks.length)

If true, generate a new Track object (matching the clip's type: Video or Audio). Give it a crypto.randomUUID(). Push it to the tracks array.

Finally, place the moved clip into that newly generated track.

5. The .SFK Waveform Strategy (Web Worker & Chunks)
You must NEVER run AudioContext.decodeAudioData on a full 1-hour audio file all at once on the main browser thread. This will crash the RAM.

The Peak Proxy Approach: When audio is imported, spawn a Web Worker. Have the worker fetch the audio in small chunks using Blob.slice().

Extract only the maximum absolute sample value for a given bucket (e.g., 1 peak for every 1024 samples).

Return an array of these normalized floats (0.0 to 1.0) and save it to the mediaPool item as peakManifest.

The timeline <ClipWaveform /> will simply read this tiny array of numbers and draw vertical lines on a <canvas>, allowing a 2-hour audio waveform to render in milliseconds.

6. Media Slipping (The 3-Point Window)
A clip is a window into a media file. It is defined by three points:

startTime: Where the window sits on the timeline.

duration: How wide the window is.

mediaOffset: How far into the source video the window begins looking.

Interaction: If a user holds a modifier key (e.g., Alt) and drags horizontally inside the clip, you must update the mediaOffset variable (clamping it to the source duration), but leave the startTime untouched. This changes what video frame plays without moving the clip block on the timeline.