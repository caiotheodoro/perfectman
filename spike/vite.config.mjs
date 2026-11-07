import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
export default {
  resolve: {
    alias: {
      "@perfectman/shared": resolve(here, "../packages/shared/src/index.ts"),
      "@perfectman/engine": resolve(here, "../packages/engine/src/index.ts"),
    },
  },
};
