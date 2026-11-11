/**
 * The retry bill of run 63 replayed on the actor loop. The guard-log of the run (`hotel/fixtures/run63/guard-turns.json`) has the 38 turns that earned a second model call: the
 * candidate the model first gave, the rules it broke, and, rebuilt from the run's events, the last 6 lines of the room and the actor's last 3 before it. Each candidate is
 * run through `ActionIntentStep` as the first answer, with a clean different line as the answer to a retry if one is asked for; the calls it takes are the bill. In the run all 38
 * got a retry: 54 spoken lines for 92 model calls (1.70 per line, before the chain's own failovers). `PERFECTMAN_FREE_TRIM_RAMBLE=0` and `PERFECTMAN_REPAIR_FIRST=0` are the old bill.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { lengthOf } from "@perfectman/shared";
import { llmBudget } from "../../../llm/llm-budget.js";
import { HOTEL, input, line, profileOf, run } from "./script-step-harness.js";

type Turn = { t_s: number; actor: string; rules: string[]; candidate: string; room: Array<{ speaker: string; text: string }>; own: string[] };
const here = dirname(fileURLToPath(import.meta.url));
const TURNS = JSON.parse(readFileSync(join(here, "../../../../../hotel/fixtures/run63/guard-turns.json"), "utf8")) as Turn[];
const CLEAN = "Vi o cofre aberto ontem à noite, na frente de todo mundo.";

afterEach(() => {
  delete process.env["PERFECTMAN_FREE_TRIM_RAMBLE"];
  delete process.env["PERFECTMAN_REPAIR_FIRST"];
});

async function bill(): Promise<{ calls: number; retried: number; silenced: number; longest: number; said: string[]; byRule: Record<string, number> }> {
  let calls = 0;
  let retried = 0;
  let silenced = 0;
  let longest = 0;
  const said: string[] = [];
  const byRule: Record<string, number> = {};
  for (const t of TURNS) {
    llmBudget.reset();
    const room = t.room.map((l) => line(l.speaker.toLowerCase(), l.speaker, l.text));
    const r = await run([t.candidate, CLEAN], input(room, t.own), HOTEL, profileOf({ displayName: t.actor }));
    calls += r.calls;
    if (r.calls > 1) {
      retried++;
      for (const rule of t.rules) byRule[rule] = (byRule[rule] ?? 0) + 1;
    }
    if (r.value.intent.intentType === "no_op") silenced++;
    else {
      longest = Math.max(longest, lengthOf(r.said));
      said.push(r.said);
    }
  }
  return { calls, retried, silenced, longest, said, byRule };
}

describe("run 63's 38 retried turns on the actor loop", () => {
  it("has the 38 turns of the log, 23 of them over the cap", () => {
    expect(TURNS).toHaveLength(38);
    expect(TURNS.filter((t) => t.rules.includes("len_retry"))).toHaveLength(23);
  });

  /** The calls per spoken line the run would have had: its 54 lines, plus one call for every retried turn (the log's 38 retried turns are all of the retries the guards made). */
  const perLine = (retried: number): number => Math.round(((54 + retried) / 54) * 100) / 100;

  it("the old bill: 36 of the 38 turns are retried (the log says 38: the replay's room is rebuilt from the events), 1.67 model calls per spoken line", async () => {
    process.env["PERFECTMAN_FREE_TRIM_RAMBLE"] = "0";
    process.env["PERFECTMAN_REPAIR_FIRST"] = "0";
    const before = await bill();
    expect(before.retried).toBe(36);
    expect(before.calls).toBe(74);
    expect(before.byRule["len_retry"]).toBe(23);
    expect(perLine(before.retried)).toBeGreaterThan(1.6);
  });

  it("the new bill: the 23 ramblers are cut to their first sentences and the stale and echoed lines are repaired where a repair leaves a line; 15 turns are retried, 1.28 calls per line", async () => {
    const after = await bill();
    expect(after.retried).toBeLessThanOrEqual(15);
    expect(perLine(after.retried)).toBeLessThanOrEqual(1.3);
    // What is left is the rules that need the model: a stale line with nothing new in it, an echo with nothing to keep, a question owed, a signature phrase.
    expect(Object.keys(after.byRule).sort()).toEqual(["debt_retry", "echo_own", "garble", "len_retry", "novelty_retry", "phrase_loop"]);
    expect(after.longest).toBeLessThanOrEqual(22);
    expect(after.silenced).toBe(0);
  });

  it("no cut line is one of the model's loops: no sentence of two words or fewer is said 3 times in a line", async () => {
    const after = await bill();
    for (const said of after.said) {
      const sentences = said.split(/(?<=[.!?…])\s+/u);
      const counts = new Map<string, number>();
      for (const sentence of sentences) if (lengthOf(sentence) <= 2) counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
      expect(Math.max(0, ...counts.values()), said).toBeLessThan(3);
    }
  });
});
