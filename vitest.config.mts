import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json.
    alias: [{ find: "@", replacement: join(projectRoot) }],
  },
  test: {
    // Unit tests are colocated with the code they cover. UI components are
    // rendered to static markup rather than driven in a browser, so they need
    // no DOM environment and no extra dependency.
    include: ["lib/**/*.test.ts", "lib/**/*.test.tsx", "app/**/*.test.tsx"],
    environment: "node",
    clearMocks: true,
  },
});
