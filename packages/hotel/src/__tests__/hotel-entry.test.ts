import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dist = fileURLToPath(new URL("../../../server/dist/hotel.js", import.meta.url));
const canRun = existsSync(dist) && "registerHooks" in nodeModule;

/** Imports the built entry in a clean process and lists every bare specifier it resolved. */
function resolvedSpecifiers(entry: string): string[] {
  const script = `
    import { registerHooks } from "node:module";
    const seen = new Set();
    registerHooks({ resolve(spec, ctx, next) { if (!spec.startsWith(".") && !spec.startsWith("node:") && !spec.startsWith("file:")) seen.add(spec); return next(spec, ctx); } });
    await import(${JSON.stringify(entry)});
    console.log(JSON.stringify([...seen]));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" })) as string[];
}

describe("narrow server entry (hotel-package.md 19.1, checklist item 26)", () => {
  it.runIf(canRun)("loads no discord.js, ollama or better-sqlite3 at init", () => {
    const seen = resolvedSpecifiers(dist);
    expect(seen).toEqual(expect.arrayContaining(["zod"]));
    expect(seen.filter((s) => /^(discord\.js|ollama|better-sqlite3)/.test(s))).toEqual([]);
  });

  it.runIf(canRun)("the package barrel still does, which is why the sidecar does not import it", () => {
    const barrel = fileURLToPath(new URL("../../../server/dist/index.js", import.meta.url));
    const seen = resolvedSpecifiers(barrel);
    expect(seen.some((s) => /^(discord\.js|ollama|better-sqlite3)/.test(s))).toBe(true);
  });
});
