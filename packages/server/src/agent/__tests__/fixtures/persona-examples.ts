import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The "Style Examples" of the repo's preset personas (`examples/presets/casts/<cast>/<persona>.persona.md`), the lines a persona's author wrote to show how it talks.
 * 133 lines in 25 persona files; two casts (building-aurora and elevator-four) carry the same personas, so a line can be here twice, once per cast.
 */
export type PersonaExample = { cast: string; persona: string; text: string };

const ROOT = join(__dirname, "../../../../../../examples/presets/casts");

export const PERSONA_EXAMPLES: readonly PersonaExample[] = readdirSync(ROOT)
  .sort()
  .flatMap((cast) =>
    readdirSync(join(ROOT, cast))
      .filter((f) => f.endsWith(".persona.md"))
      .sort()
      .flatMap((file) => {
        const section = /## Style Examples\n([\s\S]*?)(?=\n## |$)/.exec(readFileSync(join(ROOT, cast, file), "utf8"));
        return (section?.[1] ?? "")
          .split("\n")
          .filter((l) => l.startsWith("- "))
          .map((l) => ({ cast, persona: file.replace(".persona.md", ""), text: l.slice(2).trim() }));
      }),
  );
