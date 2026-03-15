# **Data & Protocol Specification: Synapse Interactive Hub**

> **CRITICAL INSTRUCTION FOR THE BUILDER AI:** The state management architecture detailed below is a strict requirement. If you put the Playhead in the same store as the Tracks, the 60FPS render loop will destroy React's performance. Follow these rules exactly.

## **1. The Dual-Store Law (Strict Isolation)**
* **Store 1: `usePlaybackStore` (The 60FPS Engine)**
  * Holds `playheadPosition` (microseconds), `isPlaying`, `zoomLevel`, and a derived `pixelsPerSecond` value.
  * *Rule:* Because the playhead updates 60 times a second during playback, NO UI components (like tracks, headers, or menus) are allowed to subscribe to this store, except for the `<Playhead />` line itself and the `<PreviewMonitor />`.
* **Store 2: `useProjectStore` (The Structural Database)**
  * Holds `tracks`, `mediaPool`, and `markers`.
  * *Rule:* This store only updates when the user drops, moves, or edits a clip. It must be perfectly immutable using Immer.
  * *Undo/Redo:* You must implement Undo/Redo middleware (such as `zundo`) on this project store. Every structural action (move, split, delete) must be fully reversible.

## **2. The Int64 Trap & Frame Quantization**
* **Microsecond Integers:** All time values (`startTime`, `duration`, `mediaOffset`) must be stored as strict integers in microseconds (1 second = `1_000_000`).
* **The Math.round Rule:** Because JavaScript uses floating-point numbers, every single time you multiply or divide time by a zoom level or framerate, you MUST wrap the final payload in `Math.round()`. If you allow decimals, frame-accurate editing will be destroyed by floating-point drift.
* **Quantize to Frames:** To prevent sub-frame "black flashes" between clips, any action that moves a clip must mathematically snap the `startTime` to an exact frame boundary. Formula: `Math.round(timeUs / frameDurationUs) * frameDurationUs`.

## **3. Strict TypeScript Interfaces**
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
```

## **4. Relational Physics (Linked A/V Movement)**
* When a user imports a standard video file, the Engine must create a Video Clip and an Audio Clip. Assign them both the identical `groupId` string.
* **The Movement Algorithm:** Whenever the `moveClip` action is called (whether dragging horizontally in time, or vertically across tracks):
  1. Find the target clip the user clicked.
  2. Search the entire project for ALL clips that share its `groupId`.
  3. Calculate the exact `deltaTime` (microseconds moved) and `deltaTrack` (number of tracks jumped up or down).
  4. Apply those exact deltas to ALL clips in the group at the exact same time in a single transaction.
* **Ungrouping:** Provide an action triggered by the 'U' key that deletes the `groupId` from selected clips, permanently breaking the physics link and allowing them to move independently.

## **5. Auto-Track Generation (The Abyss)**
* The timeline must feel infinitely expandable vertically.
* Inside the `moveClip` action, after calculating the `newTrackIndex` for a clip based on how far down the user dragged it:
  * Check: `if (newTrackIndex >= tracks.length)`
  * If true, immediately generate a new Track object (matching the clip's type: Video or Audio). Give it a `crypto.randomUUID()`. Push it to the `tracks` array.
  * Finally, place the moved clip into that newly generated track. 

## **6. The .SFK Waveform Strategy (Web Worker & Chunks)**
* You must NEVER run `AudioContext.decodeAudioData` on a full 1-hour audio file all at once on the main browser thread. This will crash the RAM.
* **The Peak Proxy Approach:** When audio is imported, spawn a Web Worker. Have the worker fetch the audio in small chunks using `Blob.slice()` to avoid memory spikes.
* Extract only the maximum absolute sample value for a given bucket (e.g., 1 peak for every 1024 samples).
* Return an array of these normalized floats (0.0 to 1.0) and save it to the `mediaPool` item as `peakManifest`.
* The timeline `<ClipWaveform />` will simply read this tiny array of numbers and draw vertical lines on a `<canvas>`, allowing a 2-hour audio waveform to render in milliseconds.

## **7. Media Slipping (The 3-Point Window)**
* A clip is a window into a media file. It is defined by three points:
  1. `startTime`: Where the window sits on the timeline.
  2. `duration`: How wide the window is.
  3. `mediaOffset`: How far into the source video the window begins looking.
* **Interaction:** If a user holds a modifier key (e.g., `Alt`) and drags horizontally *inside* the clip, you must update the `mediaOffset` variable (clamping it to the source duration), but leave the `startTime` untouched. This changes what video frame plays without moving the clip block on the timeline.