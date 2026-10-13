import { defineConfig } from "vitest/config";

/**
 * Pure logic runs in node; anything ending in `.test.tsx` gets a DOM. The split
 * is by extension on purpose: a component test needs jsdom, a fold or a
 * geometry check does not, and jsdom start-up is most of a test's cost.
 */
export default defineConfig({
  test: {
    environment: "node",
    // The App-level e2e files take about a second alone and several under a full parallel run; five seconds is a coin flip there.
    testTimeout: 15_000,
    include: ["src/**/*.test.{ts,tsx}"],
    environmentMatchGlobs: [["src/**/*.test.tsx", "jsdom"]],
  },
});
