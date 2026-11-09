import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "kb",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
