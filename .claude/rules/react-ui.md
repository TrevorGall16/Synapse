# React & UI Architecture Rules

- **Strict Modularity:** Never write a UI component file longer than 900 lines. If it grows larger, extract sub-components (e.g., `<TimelineTrack />`, `<Playhead />`) into their own files.
- **State Decoupling:** Do not put Heavy Engine State (like the 10-second Event Queue) inside React `useState`. Use refs (`useRef`) or an external state manager (Zustand/Context) to prevent the entire UI from re-rendering 60 times a second.
- **Tailwind Constraints:** Use standard Tailwind CSS classes. Do not write custom CSS unless absolutely necessary for the timeline sub-pixel grid. 
- **Styling Vibe:** Enforce the `#1a1a1a` dark mode and 1px top-borders for depth. No pure black.
- **Hydration:** Never use `window`, `document`, or `performance.now()` directly in the root of a component before the `useEffect` mounts.