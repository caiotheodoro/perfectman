import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/shared/vitest.config.ts",
  "packages/engine/vitest.config.ts",
  "packages/server/vitest.config.ts",
  "packages/eval/vitest.config.ts",
  "packages/web/vitest.config.ts",
]);
