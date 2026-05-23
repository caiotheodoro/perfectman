import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    name: "server",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@perfectman/shared": resolve(__dirname, "../shared/src/index.ts"),
      "@perfectman/engine": resolve(__dirname, "../engine/src/index.ts"),
    },
  },
});
