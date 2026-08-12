import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "eval",
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
