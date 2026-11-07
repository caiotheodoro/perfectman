import { describe, expect, it } from "vitest";
import { benchPrompt, decide, runBench } from "../llm/bench-latency.js";

/** A scripted clock: each call to now() advances by the next scripted duration. */
function scripted(durations: number[]) {
  let t = 0;
  let i = 0;
  let started = false;
  return {
    now: () => {
      if (!started) {
        started = true;
        return t;
      }
      started = false;
      t += durations[i++ % durations.length] ?? 0;
      return t;
    },
  };
}

describe("D53 allowlist gate", () => {
  it("measures p50 and p95 over the successful calls", async () => {
    const times = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    const r = await runBench(async () => undefined, 20, 1, scripted(times).now);
    expect(r).toMatchObject({ n: 20, errors: 0, p50Ms: 1000, p95Ms: 1900 });
  });

  it("allows a model whose p95 is at or under 6 s", () => {
    expect(decide({ n: 30, errors: 0, p50Ms: 2500, p95Ms: 5900, maxMs: 6100 })).toMatchObject({ allow: true });
  });

  it.each([
    [{ n: 30, errors: 0, p50Ms: 3000, p95Ms: 6001, maxMs: 9000 }, /above the 6000 ms budget/],
    [{ n: 30, errors: 6, p50Ms: 1000, p95Ms: 2000, maxMs: 3000 }, /calls failed/],
    [{ n: 8, errors: 0, p50Ms: 1000, p95Ms: 2000, maxMs: 3000 }, /need at least 10/],
  ])("refuses %j", (result, why) => {
    const v = decide(result);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(why);
  });

  it("builds a prompt of the size a 12-agent pulse sends", () => {
    const { system, user } = benchPrompt(12, 40);
    const approxTokens = (system.length + user.length) / 4;
    expect(approxTokens).toBeGreaterThan(3000);
    expect(user.match(/\[e\d+\]/g)).toHaveLength(40);
  });
});
