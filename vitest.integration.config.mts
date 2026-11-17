import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests against a REAL MongoDB (unique indexes, atomic updates,
// multi-document transactions). Each test file creates its own throwaway
// database named pt_it_<random>_test and drops it afterwards; see
// src/test/it-setup.ts. Run with: npm run test:integration
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/empty.ts"),
    },
  },
  test: {
    include: ["src/**/*.it.test.ts"],
    setupFiles: ["src/test/it-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
