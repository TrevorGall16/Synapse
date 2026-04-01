import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Exclude Playwright E2E specs — those run via `npm run audit` (playwright test)
    exclude: ["**/node_modules/**", "**/e2e/**"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
