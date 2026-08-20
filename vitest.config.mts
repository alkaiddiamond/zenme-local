import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    exclude: ["**/.next/**", "**/dist-desktop/**", "**/node_modules/**"],
    globals: true,
    // Windows filesystem/process tests exceed their local timeout when the
    // default worker count saturates the machine. Keep the committed gate
    // deterministic while retaining Vitest's normal concurrency elsewhere.
    maxWorkers: process.platform === "win32" ? 2 : undefined,
  },
});
