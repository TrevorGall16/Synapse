# **UI Specification: Synapse Interactive Hub**

### **1. Extreme Modularity & Atomic Design (Strict Rules)**
Because the UI will evolve, the codebase must be built using strict Atomic Design principles.
* **Component Isolation:** The Sidebar, Video Player, Feed Cards, and Studio Timeline must be completely independent React components. 
* **Zero UI Monoliths:** No UI file may exceed 400 lines. If the Studio gets too complex, break it down into `<Timeline />`, `<TrackHeader />`, `<PreviewMonitor />`, etc.
* **Layout Swappability:** The main layout must act as a simple "wrapper." If the Sidebar needs to be moved to the right later, it should require changing exactly one line of CSS/Flexbox code.

### **2. Global Layout (The Platform Vibe)**
* **Visual Identity:** Backgrounds must use `#1a1a1a` (slate-900); pure black is forbidden. UI cards require a 1px top highlight (`border-t border-white/20`) to simulate physical depth.
* **Fixed Left Sidebar:** A fixed navigation panel containing: **Home, Explore, Upload (Studio), Niche (Tags/Categories), and Login/Profile**.
* **Flexible Center Stage:** The main content area. On the Home/Explore pages, this is a scrolling feed. On the Studio/Player pages, it locks to `100vh` to prevent scrolling while editing or watching.

### **3. Page Templates & User Flow**

**A. The Landing / Discovery Feed (Home)**
* **Adult & Privacy Gates:** On the very first visit, a standard 18+ Adult Content Warning and a Cookie/Privacy pop-up appear. *No strobe warnings yet.*
* **The Feed:** A scrolling, Reddit/RedGIFs-style feed of "Recipe Cards." 
* **Thumbnails:** Cards feature auto-playing, silent, low-res preview loops of the experiences.
* **Metadata Badges:** Each card displays SEO/Filter tags (e.g., *120 BPM, 15Hz Intensity, High Shader Complexity*).

**B. The Player Page (Viewing an Experience)**
* **The Strobe Warning:** *This* is where the high-contrast strobe/epilepsy warning appears. The user must click "I Understand" before the player initializes.
* **The "Fuel" Prompt:** If the recipe requires local media the user hasn't linked, a Red "Missing Source" placeholder prompts them to link their folder.
* **The Player:** Renders the WebGPU overlays over the media. Features a clean control bar at the bottom (Play/Pause, Global Intensity Slider, Sync Offset Slider).
* **Creator Support:** High-visibility CPA affiliate buttons (*"Support this Creator / See Full Video"*) are placed next to the player, styled in OnlyFans/Fansly brand colors. They open in a new `target="_blank"` tab to protect the WebGPU context.

**C. User Profiles**
* **The Hub:** Shows the creator's username, bio, and all uploaded/remixed recipes in a grid.
* **Affiliate Links:** Prominent buttons linking to the creator's external monetization platforms.

**D. The Studio (Upload Page / Vegas Pro Editor)**
* **The Workspace:** Professional 3-panel layout (Media Pool, Preview Window, Timeline). All panels must be resizable via draggable borders.
* **Timeline Architecture (Dynamic Tracks):** The timeline uses a dynamic layer system, not fixed tracks.
    * *Standard Tracks:* Users can add unlimited stackable Video and Audio tracks (`Video 1`, `Video 2`, `Audio 1`). Higher video tracks visually override lower tracks (compositing/overlays).
    * *Special Tracks:* The timeline also contains dedicated tracks for `Text`, `Pulse`, and `Strobe`.
* **Track Controls:** The left side of every track (Track Header) must include standard NLE controls: `[M] Mute`, `[S] Solo`, `[FX]`, and a Volume/Opacity slider placeholder.
* **Timeline Events (Clips):** Dragging an A/V file to the timeline creates linked Video and Audio events. Clips can be dragged, trimmed at the edges, split (using `S`), and grouped.
* **Crossfades & Fades:** Overlapping two clips on the same track automatically generates a crossfade. Clips have fade-in/out handles at the top corners.
* **Marker Heat-Maps:** Zooming out collapses thousands of beat markers into color-coded intensity clusters. Zooming in expands them.
* **Fractional Loops:** Loop regions feature a sub-pixel indicator glow indicating timing between exact frames.

### **4. Interaction & Shortcuts (Studio)**
* **Standard NLE Shortcuts:** `S` (Split), `M` (Marker), `Space` (Play/Pause), `J/K/L` (Transport), `I/O` (In/Out points).
* **Action-Ghosting:** Clicking a UI button briefly "flashes" its corresponding keyboard shortcut over the button to train muscle memory.
* **Snapping:** Elements snap globally to beat markers, frames, and clips (respecting BPM ramps). Hold `Shift` to bypass. 

### **5. Modals & Feedback Overlays**
* **Cloud Conflict Split-Screen:** A Visual Diff Tool showing a split-screen timeline (Local vs. Cloud) allowing the user to "Cherry-Pick" specific markers before merging.
* **Recovery Modal:** After a crash, presents two autosave timeline thumbnails side-by-side to confirm which version to restore.
* **VRAM Purge Toast:** Multi-tab VRAM purges show an aggregated toast: *"GPU Optimizing (Tab: Project Name)"* with a percentage progress bar.
* **Hardware Badges:** A pinned "Low Perf" badge appears if thermal limits cause frame drops. Clicking it reveals live VRAM/CPU %.
* **Audio Resync Overlay:** Switching audio devices triggers a *"Syncing Audio..."* countdown overlay (ms remaining) while the engine recalibrates Bluetooth latency.