# **UI Specification: Synapse Interactive Hub (Master Blueprint)**

> **CRITICAL INSTRUCTION FOR THE BUILDER AI:** You are not building a webpage. You are building a real-time mathematical rendering engine that simulates a physical timeline[cite: 2]. Every pixel and frame must be calculated using pure mathematics. Standard CSS flow is strictly forbidden. Read every word of this document.

## **1. The Golden Rule: The DOM Architecture**
* **No Flexbox for Clips:** The timeline is an infinite Cartesian plane. The X-axis is time (microseconds), and the Y-axis is tracks. 
* **The Spacer Div Method:** The track container must be a single, absolutely positioned `<div>` with `overflow: auto`. Inside it, you must place a "Spacer Div." The width of this Spacer Div is `Total Timeline Duration * pixelsPerSecond`. This creates the scrollable area without breaking standard web layouts.
* **GPU Transforms ONLY:** Every single clip must be placed inside this Spacer Div using absolute positioning driven by GPU transforms: `transform: translate3d(${x}px, ${y}px, 0)`. Never use `left` or `top`[cite: 3].

## **2. The Exact Mathematics of Positioning**
To place a clip on the screen, you must use these exact formulas:
* **X Position (Horizontal):** `x = (clip.startTime / 1_000_000) * pixelsPerSecond`
* **Width:** `width = (clip.duration / 1_000_000) * pixelsPerSecond`
* **Y Position (Vertical):** `y = Sum of the heights of all tracks ABOVE this clip's track.` (e.g., if Video 1 is 60px high, and the clip is on Video 2, its Y position is 60px).

## **3. Focal-Point Zooming (The "Sticky" Cursor)**
Standard zooming (where the screen shrinks to the left) will disorient the user. You must implement Focal-Point Zooming[cite: 14]. The exact timecode under the user's mouse must stay pinned to the exact same pixel on their monitor while the timeline expands or contracts around it[cite: 18].
* **The 4-Step Algorithm for Mouse-Wheel Zoom:**
  1. **Capture Pre-Zoom:** Find exactly where the mouse is. 
     `const mouseX = e.clientX - containerRect.left;`
     `const timeAtMouse = (container.scrollLeft + mouseX) / oldPixelsPerSecond;`
  2. **Change Zoom Level:** Multiply or divide the `zoomLevel`. Calculate `newPixelsPerSecond`.
  3. **Adjust Scroll:** Force the scrollbar to keep the mouse anchored. 
     `container.scrollLeft = (timeAtMouse * newPixelsPerSecond) - mouseX;` [cite: 28, 30]
  4. **Save:** Update the Zustand store with the new zoom.

## **4. Viewport-Driven Rendering (Anti-Crash System)**
You must never render all clips at once. If a 2-hour movie is on the timeline, drawing the whole thing will crash the browser[cite: 75].
* **The Viewport Math:** Calculate what is visible on the screen:
  `startTimeVisible = (scrollLeft / pps) * 1_000_000`
  `endTimeVisible = ((scrollLeft + clientWidth) / pps) * 1_000_000`
* **Virtualization:** Only mount React components for clips that intersect with this visible time range. For everything else, render a blank, empty `<div>` to hold the space.
* **Video Filmstrips:** Do NOT use dozens of `<video>` tags. Use a single hidden `<video>` element in the background. Seek to the necessary timestamps, draw the frames to an offscreen `<canvas>`, and render those as a simple string of Base64 `<img>` tags. Only do this for the visible portion of the clip[cite: 85, 86].

## **5. Media Ingestion & Ghost Drops**
* When a user drags a file from their OS over the timeline, you must show a translucent "Ghost Clip" following their mouse.
* **Y-Axis Track Calculation:** Calculate which track the mouse is hovering over using `mouseY`. If the user drags the ghost clip down into the empty space below the last track, highlight that empty space to indicate a new track will be born there[cite: 54].
* **Snapping Priority:** The ghost clip's left edge must mathematically snap (within a 10px threshold) to the Playhead first, then Markers, then other Clip Edges[cite: 105, 106, 107].

## **6. Visual Fades (Overlap Physics)**
* If two clips on the same track are moved so they overlap, do not hide one. 
* Calculate the overlap: `overlapDuration = clipA.startTime + clipA.duration - clipB.startTime`.
* Draw a visual fade curve (using SVG or Canvas) on the top-right corner of Clip A, and the top-left corner of Clip B, representing this crossfade[cite: 121, 124].