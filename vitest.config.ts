import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.ts"],
      // Exclude files with no executable logic so the percentage reflects real
      // branch/line coverage: public-api barrels (pure re-exports), the package
      // and bin entry points, and the type-only vocabulary modules.
      exclude: ["src/**/public-api.ts", "src/**/index.ts", "src/core/types/**", "src/**/types.ts"]
    }
  }
});
