# **Data & Protocol Specification: Synapse Interactive Hub (Master Blueprint)**

> **CRITICAL INSTRUCTION FOR THE BUILDER AI:** This is a high-performance Non-Linear Editor (NLE). State management and re-renders are your biggest enemies. You must strictly follow the dual-store Zustand architecture and exact mathematical clamping rules outlined below to prevent 60FPS React tree collapses.

## **1. Code Modularity & Architecture Strict Rules**
* **Zero Monoliths:** No single file may exceed 400 lines of code. Extract complex state mutators into separate utility files.
* **Separation of Concerns:** UI rendering logic must be completely isolated from Engine/Sequencer logic.
* **Zod Validation:** All incoming data (loading a `.synapse` file) must be strictly parsed and validated using Zod schemas before being injected into the Zustand store. Malicious values (e.g., Strobe `frequency` > 60Hz) must be clamped to safe boundaries. All user text must be HTML-escaped.

## **2. Runtime State Architecture (Dual Zustand Stores)**

**CRITICAL RULE:** To prevent 60FPS React tree collapses, the state MUST be split into two distinct Zustand stores. The Playback engine state must never trigger re-renders of the Project UI state.

### **Store 1: The Playback Engine (`usePlaybackStore`)**
Handles highly volatile, 60fps data. UI components (like tracks/clips) MUST NOT subscribe to this store. Only the `<Playhead />`, `<TimelineRuler />`, and `<PreviewMonitor />` may subscribe to this.
```typescript
export interface PlaybackState {
    playheadPosition: number;   // In microseconds (strictly enforced via Math.round)
    isPlaying: boolean;
    zoomLevel: number;          // 0.1 to 10
    loopRegion?: { in: number; out: number };
    
    // Actions
    setPlayhead: (time: number) => void;
    togglePlayback: () => void;
    setZoom: (zoom: number) => void;
}

```

### **Store 2: The Project Data (`useProjectStore`)**

Handles the structural timeline and media data. Mutations here are tracked by the Undo/Redo history.

```typescript
export interface ProjectState {
    tracks: Track[];
    mediaPool: MediaPoolItem[];
    markers: Marker[];
    duration: number;           // Total timeline length in microseconds
    selectedClipIds: string[];  // Multi-selection support
    selectedTrackId: string | null;
    snapEnabled: boolean;       // Global snapping toggle
    
    // Core Actions (Mutators)
    addClip: (trackId: string, clip: ClipEvent) => void;
    moveClip: (clipId: string, newTrackId: string, newStartTime: number) => void;
    splitClip: (clipId: string, splitTime: number) => void;
    deleteClip: (clipIds: string[]) => void;
    updateClipProperties: (clipId: string, properties: Partial<ClipEvent>) => void;
    addMedia: (item: MediaPoolItem) => void;
}

```

### **State Mutation Rules for the Builder AI:**

* **Immutability:** Zustand updates must use `immer` or strict spread operators to ensure deep immutability when updating nested clip properties.
* **The TypeScript Int64 Trap:** JavaScript does not have a native Int64 type; it uses double-precision floats. Any action modifying `startTime`, `duration`, or `playheadPosition` MUST wrap the payload in `Math.round()` or `Math.floor()` to prevent floating-point microsecond drift over time.
* **Command-Pattern Undo/Redo:** Do NOT save full copies of the Zustand store for Undo/Redo (this will blow up RAM). You must use `zundo` (or similar middleware) configured to store exact JSON patch diffs, capped at a 20-step history.

## **3. Strict Data Interfaces**

```typescript
type TrackType = "video" | "audio" | "text" | "effect";

export interface MediaPoolItem {
    id: string;
    name: string;
    type: "video" | "audio" | "image" | "text" | "effect-preset";
    fileHandle?: any;         // FileSystemFileHandle for OPFS or local access
    url?: string;             // Blob URL for hover-scrub preview
    duration: number;         // Microseconds
    hash: string;             // xxHash for staleness check
    proxyId?: string;         // Reference to OPFS proxy
}

export interface Track {
    id: string;
    type: TrackType;
    name: string;
    color?: string;          
    height: number;          
    collapsed: boolean;
    locked: boolean;
    clips: ClipEvent[];
    isMuted: boolean;
    isSolo: boolean;
    opacityOrVolume: number; 
}

export interface ClipEvent {
    id: string;
    type: TrackType;
    sourceId: string;         // References MediaPoolItem.id
    startTime: number;        // Microseconds (Math.round)
    duration: number;         // Microseconds (Math.round)
    linkedClipIds?: string[]; // Moving this clip also moves linked Audio/Video clips
    fadeIn?: number;          // Microseconds
    fadeOut?: number;         // Microseconds
    effects?: EffectInstance[];
    keyframes?: Keyframe[];
    panCrop?: PanCropData;
}

export interface Marker {
    id: string;
    time: number;             // Microseconds
    color: string;
    label?: string;
}

export interface EffectInstance {
    id: string;
    shaderId: string;         // Reference to WebGPU shader
    type: "strobe" | "pulse" | "chroma" | "wave" | string;
    // Strict schema, never just Record<string, any>
    parameters: StrobeParams | PulseParams | any; 
    keyframes?: Keyframe[];
}

export interface Keyframe {
    time: number;             // Relative to Clip start time (Microseconds)
    value: number | { x: number; y: number } | [number, number, number]; // Scalar, Vector, or Color
    interpolation?: "linear" | "ease-in" | "ease-out" | "step";
}

export interface PanCropData {
    position: { x: number; y: number };
    scale: { x: number; y: number };
    rotation: number;      
}

```

## **4. Core Object Structure (The Saved .SYNAPSE Protocol)**

When a project is saved, the `ProjectState` is serialized into a lightweight JSON object with a strict **5MB size limit**.

```json
{
  "id": "uuid-string",
  "slug": "lowercase-hyphen-slug",
  "version": "2026.1",
  "metadata": {
    "title": "Human-readable label",
    "tags": ["trance", "15Hz", "sync"]
  },
  "creator_metadata": {
    "author_id": "uuid-string",
    "root_affiliate_link": "[https://onlyfans.com/creator](https://onlyfans.com/creator)", 
    "remixer_link": "[https://fansly.com/remixer](https://fansly.com/remixer)"
  },
  "fuel": {
    "remote_links": ["[https://redgifs.com/watch/id](https://redgifs.com/watch/id)"],
    "local_requirements": ["./video1.mp4"] 
  },
  "engine_config": {
    "global_bpm": 120
  },
  "project_state": {} // Serialized useProjectStore data
}

```

* **Migration Strategy:** The `version` field dictates how the file is parsed. If an older version is loaded, it must be passed through a version-migration transformer function before reaching Zod validation.

## **5. Storage & Persistence Tiers**

The application uses a tri-tier storage architecture to prevent browser crashes and save cloud costs.

* **Tier 1: IndexedDB (Metadata & State)**
* Stores the local `FileSystemFileHandle` (requiring user re-verification on page reload).
* Performs **1-Minute Atomic Autosaves** (writing to a temp file before swapping) to prevent corruption.
* Stores the `zundo` incremental JSON patch diffs for the Undo Stack.


* **Tier 2: OPFS - Origin Private File System (Heavy Assets)**
* Stores all low-res WebCodecs **Proxies** (generated asynchronously in a Web Worker for 8K video or files > 5 minutes).
* **Staleness Check:** The engine uses **XXHash** on the first 5MB of a video file. If the hash mismatches, the proxy is flagged for async regeneration.


* **Tier 3: Supabase (Cloud & Ecosystem)**
* **The "First-In" Lock:** Projects opened from the cloud are locked to the first device. Uses a **15-minute heartbeat timeout**.
* **Optimistic Locking (Diff Merging):** If two users edit offline and sync, a Visual Diff Tool highlights changes. Users can "Cherry-Pick" markers, generating a `Conflict` merge object.


