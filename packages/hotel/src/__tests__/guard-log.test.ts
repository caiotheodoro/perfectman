import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GUARD_LOG_FILE, writeRunArtifacts } from "../run/artifacts.js";
import { GuardLog, guardLogEnabled, guardLogLine } from "../run/guard-log.js";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "guard-log-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env["PERFECTMAN_GUARD_LOG"];
});

describe("guardLogLine", () => {
  it("is one JSON line: t_ms, actor, rule, before, after", () => {
    const line = guardLogLine(12_345.6, "narration_stripped", { actor: "Renato", before: "Irmão não depõe, né? Olho pra ela, sorriso atravessado.", after: "Irmão não depõe, né?" });
    expect(line).toBeDefined();
    expect(line).not.toContain("\n");
    expect(JSON.parse(line!)).toEqual({ t_ms: 12346, actor: "Renato", rule: "narration_stripped", before: "Irmão não depõe, né? Olho pra ela, sorriso atravessado.", after: "Irmão não depõe, né?" });
    expect(Object.keys(JSON.parse(line!))).toEqual(["t_ms", "actor", "rule", "before", "after"]);
  });

  it("names each kind of guard action by its rule, and leaves out the ones that change no line", () => {
    const rule = (kind: Parameters<typeof guardLogLine>[1]): string | undefined => {
      const line = guardLogLine(0, kind, undefined);
      return line === undefined ? undefined : (JSON.parse(line) as { rule: string }).rule;
    };
    expect(rule("repeat_own")).toBe("echo_own");
    expect(rule("repeat_room")).toBe("echo_room");
    expect(rule("garble_dropped")).toBe("garble_drop");
    expect(rule("len_trimmed")).toBe("len_trim");
    expect(rule("guard_silenced")).toBe("silenced");
    expect(rule("repeat_blocked")).toBe("silenced");
    expect(rule("answer_note")).toBe("answer_note");
    expect(rule("quote_struck")).toBe("quote_struck");
    expect(rule("len_trim_free")).toBe("len_trim_free");
    expect(rule("tic")).toBe("tic");
    expect(rule("tic_stripped")).toBe("tic_strip");
    expect(rule("echo_repaired")).toBe("echo_repair");
    expect(rule("stall_nudge")).toBeUndefined();
    expect(rule("held_repeat")).toBeUndefined();
  });

  it("a silenced line has its text in `before` and nothing in `after`; a missing actor or text is an empty string", () => {
    expect(JSON.parse(guardLogLine(5, "guard_silenced", { actor: "Heloísa", before: "Pato de perto, pato de perto, eu sei.", after: "" })!)).toMatchObject({ rule: "silenced", before: "Pato de perto, pato de perto, eu sei.", after: "" });
    expect(JSON.parse(guardLogLine(-3, "garble", undefined)!)).toEqual({ t_ms: 0, actor: "", rule: "garble", before: "", after: "" });
  });
});

describe("GuardLog and the run's artifacts", () => {
  it("appends one line per action, counted from the run's start, and the artifact is registered as guard_log", async () => {
    const dataDir = tmp();
    const runDir = join(dataDir, "runs", "9");
    let now = 1000;
    const log = new GuardLog(join(runDir, GUARD_LOG_FILE), () => now);
    log.record("len_retry", { actor: "Otávio", before: "um dois três" });
    now = 4500;
    log.record("guard_silenced", { actor: "Otávio", before: "Tá.", after: "" });
    log.record("stall_nudge", { actor: "Otávio" });
    await log.flush();
    const lines = readFileSync(join(runDir, GUARD_LOG_FILE), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([
      { t_ms: 1000, actor: "Otávio", rule: "len_retry", before: "um dois três", after: "" },
      { t_ms: 4500, actor: "Otávio", rule: "silenced", before: "Tá.", after: "" },
    ]);

    const written = await writeRunArtifacts(dataDir, 9, [], { frames: [], snapshots: [] } as never, { run: 9, simulationId: "s", scenarioVersion: 1, scenarioSha256: "x", finalState: "ended", stopReason: "completed", startedAt: 0, endedAt: 1, pulse: 1, counters: {} });
    expect(written.files["guard_log"]).toBe(join(runDir, GUARD_LOG_FILE));
    const manifest = JSON.parse(readFileSync(join(runDir, "replay.json"), "utf8")) as { files: Record<string, string> };
    expect(manifest.files["guard_log"]).toBe("guard-log.jsonl");
  });

  it("a run whose guards did nothing leaves no guard log and no entry for it", async () => {
    const dataDir = tmp();
    const log = new GuardLog(join(dataDir, "runs", "10", GUARD_LOG_FILE), () => 0);
    log.record("stall_nudge", {});
    await log.flush();
    const written = await writeRunArtifacts(dataDir, 10, [], { frames: [], snapshots: [] } as never, { run: 10, simulationId: "s", scenarioVersion: 1, scenarioSha256: "x", finalState: "ended", stopReason: "completed", startedAt: 0, endedAt: 1, pulse: 1, counters: {} });
    expect(Object.keys(written.files)).toEqual(["events", "director", "replay", "body_frames"]);
  });

  it("PERFECTMAN_GUARD_LOG=0 turns it off", () => {
    expect(guardLogEnabled()).toBe(true);
    process.env["PERFECTMAN_GUARD_LOG"] = "0";
    expect(guardLogEnabled()).toBe(false);
  });
});
