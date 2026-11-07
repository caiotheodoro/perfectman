// Lets `node --experimental-transform-types` run scripts that import the sidecar's own sources, which spell
// their relative imports `./x.js` (NodeNext): a relative `.js` that has no file but has a `.ts` sibling resolves to it.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
      const target = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(target)) && existsSync(fileURLToPath(target).replace(/\.js$/, ".ts"))) {
        return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
      }
    }
    return nextResolve(specifier, context);
  },
});
