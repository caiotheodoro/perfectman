import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    name: "hotel",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    // The suite pins the body as it was before the human layer (cinematic revamp B5): a test that wants the layer builds it, or stubs this variable.
    env: { PERFECTMAN_HUMAN_LIKENESS: "0" },
  },
  resolve: {
    alias: {
      // Most specific first: the narrow hotel entry, never the barrel (it loads discord.js).
      "@perfectman/server/hotel": resolve(__dirname, "../server/src/hotel.ts"),
      "@perfectman/shared": resolve(__dirname, "../shared/src/index.ts"),
      "@perfectman/engine": resolve(__dirname, "../engine/src/index.ts"),
    },
  },
});
