import { readFileSync } from "node:fs";
import { ACT_VERBS } from "@perfectman/shared";
import type { ActVerb } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { NO_REWARD_MS, TABLEAU_RADIUS_TILES } from "../embodiment/constants.js";
import { isReplaceable } from "../embodiment/reactions.js";
import { CONTACT_VERBS, HOLDS_THE_ROOM, verbMemory } from "../embodiment/verb-facts.js";

type Step = { reaction?: string };
type Entry = {
  contact: boolean;
  follow_ups?: Array<{ verb: string }>;
  roles: { target?: Step[]; witnesses: Step[] };
  memory: Record<"actor" | "target" | "witnesses", { event: string; tone: string }>;
};
const table = JSON.parse(readFileSync(new URL("../../schema/verb-vocab.json", import.meta.url), "utf8")) as { constants: Record<string, number>; verbs: Record<string, Entry> };
const REPLACEABLE_LABELS = new Set(["look_back", "watch", "freeze_gasp", "surprised"]);

describe("the planner's verb facts equal the table (VV-4)", () => {
  it("[VV-4] the contact verbs, the verbs that end in a tableau and the constants are the table's", () => {
    expect([...CONTACT_VERBS].filter((v) => (ACT_VERBS as readonly string[]).includes(v)).sort()).toEqual(ACT_VERBS.filter((v) => table.verbs[v]?.contact).sort());
    expect([...HOLDS_THE_ROOM].sort()).toEqual(ACT_VERBS.filter((v) => v === "tableau" || table.verbs[v]?.follow_ups?.some((f) => f.verb === "tableau")).sort());
    expect(NO_REWARD_MS).toBe(table.constants["no_reward_ms"]);
    expect(TABLEAU_RADIUS_TILES).toBe(table.constants["tableau_radius_tiles"]);
  });

  it("[VV-4] every verb's memory entry is the table's, and a verb the planner knows nothing of writes nothing", () => {
    for (const v of ACT_VERBS) {
      const t = table.verbs[v]!.memory;
      const mine = verbMemory(v);
      expect(mine, v).toEqual({ actor: t.actor, target: t.target, witnesses: t.witnesses });
    }
  });

  it("[REA-3] a label is replaceable by the planner exactly when the table says it is one of look_back, watch, freeze_gasp or surprised", () => {
    for (const v of ACT_VERBS as readonly ActVerb[]) {
      const e = table.verbs[v]!;
      for (const [role, steps] of [["target", e.roles.target ?? []], ["witness", e.roles.witnesses]] as const) {
        const labels = steps.map((s) => s.reaction).filter((l): l is string => l !== undefined);
        if (labels.length === 0) continue;
        expect(isReplaceable(v, role), `${v} ${role} ${labels.join(",")}`).toBe(labels.every((l) => REPLACEABLE_LABELS.has(l)));
      }
    }
  });
});
