/**
 * The drama prompt through the real runtime, the way a hotel run reaches it: the space view says `drama`, the engine's body block carries it, the prompt
 * builder teaches the `act` key, and the model's `body.act` goes back through the real parser and resolver. Without the flag the same world builds
 * the prompts it always built. (The prompt text and the byte-identity golden are in packages/server; this is the wiring, end to end.)
 */
import { describe, expect, it } from "vitest";
import { ACT_VERBS } from "@perfectman/shared";
import { buildGridWorld } from "../embodiment/grid-world.js";
import type { GridWorld, ScriptedModel } from "../embodiment/grid-world.js";
import { promptIdentityHits } from "../probes/embodiment.js";

const ACTORS = [
  { id: "duda", name: "Duda", tile: [3, 4] as [number, number] },
  { id: "rafa", name: "Rafa", tile: [4, 4] as [number, number] },
  { id: "gabi", name: "Gabi", tile: [5, 4] as [number, number] },
];

/** A model that glares at the first person it sees, with its line: the packet a drama prompt teaches. */
const glaring: ScriptedModel = ({ input }) => {
  const person = Object.entries(input.perceptionPacket.bodyHandles ?? {}).find(([, t]) => t.kind === "person")?.[0];
  return {
    latencyMs: 300,
    packet: { intentType: "send_message", visibleContent: "Pode repetir, vai.", privateMotiveSummary: "quero que percebam que eu sei", ...(person ? { body: { act: { verb: "glare", target: person, intensity: 0.4 } } } : {}) },
  };
};

async function world(drama: boolean): Promise<GridWorld> {
  const w = await buildGridWorld({ actors: ACTORS, model: glaring, seed: 5, arbiter: {} });
  if (drama) {
    const view = w.grid.view.bind(w.grid);
    w.grid.view = (agentId, now) => {
      const v = view(agentId, now);
      return v ? { ...v, drama: true } : v;
    };
  }
  const human = w.grid.humanEnter("u1", "Visitante", "lounge", [2, 4]);
  await w.humanSay(human, "Duda, você mentiu para todo mundo?");
  w.loop.requestFocused(["duda", "rafa"]);
  await w.runFor(30_000);
  return w;
}

/** The persona block is scenario data; the lint is about what the hotel template adds. */
const templateOnly = (prompts: string[]): string[] => prompts.map((p) => p.replace(/<persona>[\s\S]*?<\/persona>/, ""));

describe("the drama flag from the view to the prompt, in a real run", () => {
  it("[NEG-2] with drama on every prompt teaches the 18 verbs, the ladder and the telenovela rule, and says nothing about what anyone is", async () => {
    const w = await world(true);
    expect(w.prompts.length).toBeGreaterThan(0);
    for (const p of w.prompts) {
      for (const verb of ACT_VERBS) expect(p, verb).toContain(verb);
      expect(p).toContain("novela, estilizado");
      expect(p).toContain("Você sobe um degrau de cada vez");
    }
    expect(promptIdentityHits(templateOnly(w.prompts))).toBe(0);
  });

  it("[NEG-2] with drama off the same world never mentions the drama verbs: the prompts are the ones every run has always had", async () => {
    const w = await world(false);
    expect(w.prompts.length).toBeGreaterThan(0);
    for (const p of w.prompts) {
      expect(p).not.toContain("tend_fallen");
      expect(p).not.toContain("novela, estilizado");
      expect(p).not.toContain('"act"');
    }
  });
});
