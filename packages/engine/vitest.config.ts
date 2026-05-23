import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    name: "engine",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@perfectman/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
