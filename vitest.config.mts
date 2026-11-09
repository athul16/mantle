import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  "server-only": path.resolve(import.meta.dirname, "tests/setup/server-only.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/lib/database.types.ts", "src/**/*.d.ts"],
      // No thresholds yet: coverage is reported, not enforced.
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/components/**", "**/node_modules/**"],
          environment: "node",
          setupFiles: ["tests/setup/node.ts"],
          globalSetup: ["tests/setup/global.ts"],
          // Database tests run against the local throwaway Supabase (tests/helpers/env.ts).
          testTimeout: 30_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "components",
          include: ["tests/components/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["tests/setup/components.ts"],
        },
      },
    ],
  },
});
