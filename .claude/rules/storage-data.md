# Storage & Data Protocols

- **Tiered Storage Strictness:** 1. `IndexedDB`: Only use for JSON metadata, `.SYNAPSE` recipes, and the 20-step Undo stack.
  2. `OPFS` (Origin Private File System): Use strictly for heavy binary data (WebCodecs video proxies). 
  3. `Supabase`: Use for cloud syncing the 5MB capped JSON files and account auth.
- **Zero Hosting:** Never write code that attempts to upload the user's local `.mp4` or `.webm` files to Supabase.
- **Relative Pathing:** Always store file paths in the JSON state as relative strings (e.g., `./video.mp4`) mapped to the local directory handle, never as absolute OS paths.