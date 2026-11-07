import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * The real-model probe (docs/plans/hotel-llm-chain.md). Not part of `pnpm test`: it spends money.
 * `pnpm --filter @perfectman/hotel probe:llm` loads PERFECTMAN_LLM_CHAIN from the environment.
 */
export default defineConfig({
  test: {
    name: "hotel-probe",
    include: ["probe/**/*.probe.ts"],
    environment: "node",
    testTimeout: 40 * 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@perfectman/server/hotel": resolve(__dirname, "../../server/src/hotel.ts"),
      "@perfectman/shared": resolve(__dirname, "../../shared/src/index.ts"),
      "@perfectman/engine": resolve(__dirname, "../../engine/src/index.ts"),
    },
  },
});
