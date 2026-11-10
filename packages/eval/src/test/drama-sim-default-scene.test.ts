/**
 * A scene that writes no `drama` block (a builder scene, an import, an older preset) gets the conservative default at compile (`defaultSceneDrama`): the
 * director's climb then runs glare, insult, shove, slap in the sim and never a punch or a kill; and `drama: off` starts no act of any kind. Production runs
 * 56 and 57 (2026-11-10) held insults and a bet and no act, because a scene without a block could not slap and never climbed. The scenes here are the
 * `tapa-na-cara` cast (heated by its seeded prior messages) with the scene's own block taken out of the frontmatter, so the sim compiles them the way the
 * authoring service does.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAMA_OFF, defaultSceneDrama } from "@perfectman/hotel/drama";
import { afterAll, describe, expect, it } from "vitest";
import type { ActStartedEvent, DramaEvent } from "../drama/index.js";
import { runDramaSim } from "../embodiment/drama-sim.js";
import type { SimConfig } from "../embodiment/drama-sim.js";
import { PRESETS_ROOT, presetSimConfig } from "../embodiment/drama-sim-preset.js";
import { probeReport } from "../embodiment/sim-report.js";

const startedOf = (events: readonly DramaEvent[]): ActStartedEvent[] => events.filter((e): e is ActStartedEvent => e.kind === "act_started");
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A copy of the presets whose `tapa-na-cara` frontmatter says `drama` as given (`undefined` takes the line out), and no beats. */
async function scene(drama: string | undefined): Promise<SimConfig> {
  const root = mkdtempSync(join(tmpdir(), "drama-default-"));
  roots.push(root);
  cpSync(PRESETS_ROOT, root, { recursive: true });
  const dir = join(root, "scenes", "tapa-na-cara");
  const file = join(dir, readdirSync(dir).find((f) => f.endsWith(".scenario.md"))!);
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => !/^(drama|beats):/.test(l));
  const close = lines.indexOf("---", 1);
  lines.splice(close, 0, ...(drama === undefined ? [] : [`drama: ${drama}`]));
  writeFileSync(file, lines.join("\n"));
  return presetSimConfig("tapa-na-cara", { root, durationMs: 180_000 });
}

/** The same scene with three of its four people, the case of a three-actor builder scene. */
function threeActors(config: SimConfig): SimConfig {
  const actors = config.actors.slice(0, 3);
  const refs = actors.map((a) => a.ref);
  const drama = defaultSceneDrama(refs)!;
  return { ...config, actors, states: new Map([...config.states].filter(([ref]) => refs.includes(ref))), drama, dramaMode: "default" };
}

describe("a scene with no drama block, in the sim", () => {
  it("compiles to the default: every ordered pair of the cast, up to a slap, nobody dies", async () => {
    const config = await scene(undefined);
    const refs = config.actors.map((a) => a.ref);
    expect(config.dramaMode).toBe("default");
    expect(config.drama).toEqual(defaultSceneDrama(refs));
    expect(config.drama).toMatchObject({ max_rung: 4, may_die: [], permadeath: false });
    expect(config.drama!.may_target).toHaveLength(refs.length * (refs.length - 1));
    expect(JSON.stringify(config.drama)).not.toContain("@human");
  });

  it.each([
    ["four actors", async () => scene(undefined)],
    ["three actors", async () => threeActors(await scene(undefined))],
  ])("%s: heated by the seeded dialogue, the director's own climb reaches the shove by the second climb gap and the slap inside two minutes, one rung per beat", async (_name, build) => {
    const result = runDramaSim({ ...(await build()), speechOnly: true });
    expect(result.proposals.every((p) => p.decision === "initiate"), "the model proposed nothing: every act is the director's").toBe(true);
    const climb = startedOf(result.events).filter((e) => e.origin === "director" && ["glare", "insult", "shove", "slap"].includes(e.verb));
    expect(climb.slice(0, 4).map((e) => e.verb)).toEqual(["glare", "insult", "shove", "slap"]);
    expect(new Set(climb.slice(0, 4).map((e) => e.actor)).size).toBe(1);
    expect(climb[2]!.atMs).toBeLessThanOrEqual(2 * 25_000 + 5000);
    expect(climb[3]!.atMs).toBeLessThanOrEqual(120_000);
  });

  it("stops at the slap: no punch, no kill, nobody falls, no act is aimed at a human, and every probe passes", async () => {
    const result = runDramaSim({ ...(await scene(undefined)), speechOnly: true, durationMs: 240_000 });
    const verbs = new Set(startedOf(result.events).map((e) => e.verb));
    expect(verbs.has("slap")).toBe(true);
    for (const banned of ["punch", "kill", "die"]) expect(verbs.has(banned), banned).toBe(false);
    expect({ failed: probeReport(result).failed }).toEqual({ failed: [] });
    expect(result.stats.blocked).toBe(0);
  });

  it("with a talking model too (it proposes acts of its own), the scene reaches at least the shove and never a punch or a kill", async () => {
    const result = runDramaSim(await scene(undefined));
    const verbs = new Set(startedOf(result.events).map((e) => e.verb));
    expect(verbs.has("shove")).toBe(true);
    for (const banned of ["punch", "kill", "die"]) expect(verbs.has(banned), banned).toBe(false);
  });

  it("a body saved before the default (no block at all) is the contract's free play: it can shove and never slap, which is what the default changes", async () => {
    const config = await scene(undefined);
    const { drama: _d, dramaMode: _m, ...legacy } = config;
    const verbs = new Set(startedOf(runDramaSim({ ...legacy, speechOnly: true, durationMs: 240_000 }).events).map((e) => e.verb));
    expect(verbs.has("shove")).toBe(true);
    expect(verbs.has("slap")).toBe(false);
  });

  it("an explicit block is never replaced: {} compiles to the contract's free play plus skips, max_rung 0 stays hug-only (no ladder act)", async () => {
    const empty = await scene("{}");
    expect(empty.dramaMode).toBeUndefined();
    expect(empty.drama).toEqual({ max_rung: 3, may_target: [], may_die: [], permadeath: false });
    const huggy = await scene("{ max_rung: 0 }");
    const verbs = new Set(startedOf(runDramaSim({ ...huggy, speechOnly: true, durationMs: 240_000 }).events).map((e) => e.verb));
    for (const rung of ["glare", "insult", "shove", "slap", "punch", "kill"]) expect(verbs.has(rung), rung).toBe(false);
  });
});

describe("drama: off, in the sim", () => {
  it("is read from the frontmatter as the off block with the off mode", async () => {
    const config = await scene("off");
    expect(config.dramaMode).toBe("off");
    expect(config.drama).toEqual(DRAMA_OFF);
  });

  it.each([true, false])("starts no act of any kind, whatever the cast feels and whether the model talks or proposes (speechOnly %s)", async (speechOnly) => {
    const result = runDramaSim({ ...(await scene("off")), speechOnly, durationMs: 240_000 });
    expect(startedOf(result.events)).toEqual([]);
    expect(result.stats).toEqual({ started: 0, blocked: 0, aborted: 0, done: 0 });
    expect(result.lines.filter((l) => l.dir === "in" && l.frame["t"] === "act")).toEqual([]);
    expect({ failed: probeReport(result).failed }).toEqual({ failed: [] });
  });

  it("is not what an empty block does: the same scene with drama {} still acts", async () => {
    expect(startedOf(runDramaSim({ ...(await scene("{}")), speechOnly: true, durationMs: 120_000 }).events).length).toBeGreaterThan(0);
  });
});
