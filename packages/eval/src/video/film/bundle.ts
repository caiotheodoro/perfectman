import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/** The film's page code, as one script: the director, the art and the stage the player draws. */
export async function bundleFilmPage(): Promise<string> {
  const entry = fileURLToPath(new URL("../../../../web/src/watch/film-embed.ts", import.meta.url));
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", minify: true,
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error("Bundling the film page produced no output");
  return out.text;
}
