import { defineConfig } from "vitest/config";

/**
 * Only the pure stream fold is covered. It is the one piece of web code with
 * behaviour rather than markup — and the piece that shipped a duplicate-run bug
 * the moment it met a real reconnect.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
