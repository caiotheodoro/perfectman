/**
 * Drama OFF is byte-identical to today (act-contract.md NEG-2, 11.3): every prompt a run without drama builds, full or compact,
 * in either language, and the decode grammar it sends, hash to what the code produced before the `act` key reached the prompt.
 * `drama-off.golden.json` was written from the tree before the drama prompt existed; a change to a run without drama moves a
 * hash here. Regenerate on purpose with `UPDATE_DRAMA_GOLDEN=1`, never to make a failure go away.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ModelIntentPacketJsonSchema, ModelIntentPacketWithBodyJsonSchema, modelIntentPacketFieldContract } from "@perfectman/shared";
import type { CommittedEvent } from "@perfectman/shared";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { PromptBuilder } from "../prompt-builder.js";
import { hotelInput, humanLine } from "./hotel-test-helpers.js";
import { makeAgentRuntimeInput } from "./agent-input-test-helpers.js";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "drama-off.golden.json");
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

const profileOf = (language: "pt-BR" | "en") => ({ ...EXAMPLE_PROMPT_PROFILE, language, hotelMode: true, relationshipBiases: {}, messageLength: "short" as const });

function busy(): CommittedEvent[] {
  return Array.from({ length: 8 }, (_, i) => ({ ...humanLine(`linha ${i} sobre o gato do telhado e a assembleia de amanhã`, i % 2 ? "Visitante" : "Duda"), id: `evt-${i}`, pulseIndex: i }));
}

/** Every build a drama-off run can make, by name, as `{system, user}` hashes plus the template version. */
function builds(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const language of ["pt-BR", "en"] as const) {
    const profile = profileOf(language);
    const quiet = hotelInput();
    const loud = hotelInput(busy());
    for (const style of [undefined, "compact"] as const) {
      for (const [name, input] of [["quiet", quiet], ["busy", loud]] as const) {
        const built = PromptBuilder.build(input, profile, "action_intent", undefined, style);
        out[`${language}/${style ?? "full"}/${name}`] = { system: sha(built.system), user: sha(built.user), templateVersion: built.templateVersion, tokens: built.inputTokensEstimate };
      }
    }
  }
  const plain = PromptBuilder.build(makeAgentRuntimeInput(), EXAMPLE_PROMPT_PROFILE, "action_intent");
  out["non-hotel"] = { system: sha(plain.system), user: sha(plain.user), templateVersion: plain.templateVersion };
  return out;
}

function grammar(): Record<string, string> {
  return {
    plain: sha(JSON.stringify(ModelIntentPacketJsonSchema)),
    withBody: sha(JSON.stringify(ModelIntentPacketWithBodyJsonSchema)),
    fieldsPlain: sha(JSON.stringify(modelIntentPacketFieldContract())),
    fieldsBody: sha(JSON.stringify(modelIntentPacketFieldContract({ body: true }))),
  };
}

describe("a run without drama builds the prompts and the decode grammar it always did", () => {
  const now = { prompts: builds(), grammar: grammar() };
  if (process.env["UPDATE_DRAMA_GOLDEN"] === "1") writeFileSync(GOLDEN, `${JSON.stringify(now, null, 2)}\n`);
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as typeof now;

  it("[NEG-2] every drama-off prompt, full and compact, in both languages, hashes to the golden", () => {
    expect(now.prompts).toEqual(golden.prompts);
  });

  it("[NEG-2] the decode grammar and the field contract of a run without drama hash to the golden", () => {
    expect(now.grammar).toEqual(golden.grammar);
  });

  it("[NEG-2] the golden covers both languages, both styles and a non-hotel prompt", () => {
    expect(Object.keys(golden.prompts).sort()).toEqual(
      ["en/compact/busy", "en/compact/quiet", "en/full/busy", "en/full/quiet", "non-hotel", "pt-BR/compact/busy", "pt-BR/compact/quiet", "pt-BR/full/busy", "pt-BR/full/quiet"],
    );
  });
});
