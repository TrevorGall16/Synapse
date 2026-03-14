# WebGPU & Master Clock Rules

- **Audio is Master:** The Engine must always derive its visual time from the `AudioContext.currentTime`. Never use `requestAnimationFrame` as the source of truth for synchronization.
- **Watchdog Prevention:** When writing Compute Shaders or heavy Fragment Shaders, break loops into multiple passes if necessary. Do not write monolithic shaders that take >2ms to execute, or the browser will kill the GPU context.
- **Context Loss Handling:** Every WebGPU initialization must include a `catch` or event listener for context loss, with a fallback function to restore from IndexedDB.
- **No UI in Engine:** The Engine (`/lib/engine`) must have zero dependencies on React or DOM elements. It should operate purely on data buffers and canvas contexts so it can run independently.