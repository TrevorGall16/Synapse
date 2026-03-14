**Data & Protocol Specification: Synapse Interactive Hub**

### **1. Code Modularity & Architecture Strict Rules**
To ensure long-term maintainability, the codebase must be strictly modular. 
* **Zero Monoliths:** No single file may exceed 400 lines of code. If a file grows too large, its logic must be extracted into focused utility functions, custom hooks, or sub-components.
* **Separation of Concerns:** UI rendering logic must be completely isolated from Engine/Sequencer logic. The Player code must remain entirely separate from the Studio UI so that the interface can be updated without touching the playback engine.
* **Plug-and-Play Architecture:** Shaders and effects (spirals, strobes) must be written as independent WebGPU modules that can be added, removed, and tweaked dynamically like plugins.

### **2. Core Object Structure (The .SYNAPSE Protocol)**
Every recipe is a strictly typed JSON object. It is stored locally in IndexedDB, publicly in Supabase, or exported manually as a `.synapse.backup` file. It operates under a strict **5MB size limit**.

```json
{
  "id": "uuid-string",
  "slug": "lowercase-hyphen-slug",
  "version": "2026.1",
  "metadata": {
    "title": "Human-readable label",
    "description": "SEO-friendly summary",
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
    "global_bpm": 120,
    "strobe_scalar": 1.0,
    "swing_rhythm": 0
  },
  "timeline": [],
  "plugins": []
}

Creator Metadata: The root_affiliate_link is hardcoded to the original creator's account. If the recipe is remixed, the original creator's link remains locked, while the remixer can populate the remixer_link.

Relative Local Paths: Local file paths are stored as relative references (./video1.mp4) based on the linked folder handle, ensuring portability if the user moves their media folder.

Shader Version Hashes: The plugins array stores a Shader Version Hash for every effect used. If a shader is updated in the future, the recipe will explicitly load the older logic tied to that hash to preserve the original visual intent.

3. Timeline & Event Schema
The timeline array contains the instructions for the WebGPU engine.

Relative Integer Timestamps: To prevent floating-point drift over 6-hour sessions, all internal timestamps are stored as Microsecond Integers (Int64) representing relative offsets from the start of the clip, rather than absolute project time. This ensures 0.1ms sub-frame precision.

Event Density Compression: If a 10-second window contains >50,000 events, the engine automatically compresses them into a single procedural pattern (e.g., a "High-Frequency Function") to keep the JSON size small and prevent memory bloat.

4. Storage & Persistence Tiers
The application uses a tri-tier storage architecture to prevent browser crashes and save cloud costs.

Tier 1: IndexedDB (Metadata & State)

Stores the local file handles (requiring user re-verification via a "Secure Vault Link" on reload).

Stores the Lazy Index Cache (filename, size, extension) for massive 200GB+ folders so they don't have to be re-scanned.

Performs 1-Minute Atomic Autosaves (writing to a temp file before swapping) to prevent corruption. Stores the last 3 project versions automatically.

Manages the Undo Stack: Capped at 20 steps for memory safety. Stores incremental diffs (only what changed) rather than full timeline snapshots.

Tier 2: OPFS - Origin Private File System (Heavy Assets)

Stores all low-res WebCodecs Proxies (generated for 8K video or files over 20 minutes).

Proxies are shared across projects and deduplicated based on the content hash.

Staleness Check: The engine uses XXHash on the first 5MB of a video file (and the entire file for Master Audio tracks) to detect if a source file was modified. If the hash mismatches, the proxy is flagged for regeneration.

Tier 3: Supabase (Cloud & Ecosystem)

Accounts are required for sharing and downloading. Guest users operate locally via IndexedDB ($0 cost).

Guest-to-Account Migration: Batch-uploads local IndexedDB projects to the cloud. Prompts the user on name conflicts ("Rename local or overwrite cloud?").

Cloud Snapshots: Limited to the last 5 versions to save database storage.

5. Collaboration & Integrity Rules
The "First-In" Lock: Projects opened from the cloud are locked to the first device. The lock uses a 15-minute heartbeat timeout. If a tab crashes or an IP changes, the lock expires.

Force Unlock: A "Force Unlock" button exists in the dashboard, handled by Supabase on a first-come-first-served basis with strict 30-second throttling to prevent backend spam.

Optimistic Locking (Diff Merging): If two users edit offline and sync, the Diff Tool highlights changes. Users can "Cherry-Pick" markers, retaining original parameters (color/intensity).

Security Sanitization: Schema validation prevents corrupted files from loading. All metadata text is HTML-escaped to prevent XSS attacks. Parameters are strictly clamped (e.g., malicious payloads setting strobes to 1,000,000Hz are clamped to a safe hardware limit like 60Hz).