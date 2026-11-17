import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside a React Server Component build; it's a no-op in tests.
      "server-only": path.resolve(__dirname, "src/test/empty.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Real-MongoDB tests run separately: npm run test:integration
    exclude: ["src/**/*.it.test.ts", "node_modules/**"],
  },
});
