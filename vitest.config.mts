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
    // Unit tests are colocated with the code they cover.
    include: ["lib/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
  },
});
