import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // RLS tests talk to the hosted Supabase project.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
