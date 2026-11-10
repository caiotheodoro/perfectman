/**
 * The scene spine's coupling to the ladder in the planner side and the run (errata P8): what `DramaBody.escalate` opens and counts, the note the aggressor reads, and what
 * `SpineEscalation` looks at and when (the turn, the decision, a hostile line said after them, never before the turn, not with the switch off). What the director makes of an
 * opened rung, the ledger's unlock and who it is for are `drama-spine-unlock.test.ts`.
 */
import { BEAT_CRAFT_MAX_CHARS, buildSpine } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { SceneRecorder, SceneSpine } from "../run/scene-recorder.js";
import { SPINE_ESCALATE_ENV, SpineEscalation, spineEscalateEnabled } from "../run/spine-escalation.js";
import { rig } from "../testing/drama-body-rig.js";

describe("DramaBody.escalate and unlockNote", () => {
  const own = (a: string, b: string): boolean => a !== b && ["duda", "rafa", "gabi", "leo"].includes(a) && ["duda", "rafa", "gabi", "leo"].includes(b);
  const said = (speaker: string, target: string, text: string) => ({ speaker, content: text, addressees: [target], mentioned: [target] });

  it("opens the shove for the person the lines were about once two lines have been said, counts it, and logs why", async () => {
    const r = rig({ allow: own });
    r.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    expect(r.body.escalate("shove", [], true)).toBe("none");
    expect(r.body.counters()["spine_unlock_skipped_no_evidence"]).toBe(1);
    await r.clock.advance(20_000);
    r.body.noteSpoken(said("rafa", "duda", "Duda, você mentiu."));
    expect(r.body.escalate("shove", [], true)).toBe("granted");
    expect(r.body.escalate("shove", [], false)).toBe("refreshed");
    expect(r.body.counters()).toMatchObject({ spine_unlock_shove: 1, spine_unlock_skipped_no_evidence: 1 });
    expect(r.body.unlockLog).toHaveLength(1);
    expect(r.body.unlockLog[0]).toMatchObject({ level: "shove", observer: "duda", offender: "rafa" });
    expect(r.body.unlockLog[0]!.why).toMatch(/2 hostile lines in 90 s/);
  });

  it("the director reads the opened rung on the next turn, even toward someone it has no relation with", async () => {
    const r = rig({ allow: own });
    r.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    await r.clock.advance(20_000);
    r.body.noteSpoken(said("rafa", "duda", "Duda, você mentiu."));
    r.body.escalate("shove", [], true);
    r.body.planFor("duda", r.input({}));
    expect(r.port?.turns.at(-1)?.emotion?.relations?.get(-702)?.unlocked).toBe(3);
    // Rafa has nothing opened toward Duda.
    r.body.planFor("rafa", r.input({}, "rafa"));
    expect(r.port?.turns.at(-1)?.emotion?.relations?.get(-701)?.unlocked).toBeUndefined();
  });

  it("the blow ends the unlock and a pair that has thrown it is spent: a shove frame ends the shove unlock, and the spine does not open it again", async () => {
    const r = rig({ allow: own });
    r.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    await r.clock.advance(20_000);
    r.body.noteSpoken(said("rafa", "duda", "Duda, você mentiu."));
    r.body.escalate("shove", [], true);
    r.body.onActStarted({ t: "act_started", run: 7, room: 12, actor: -701, with: -702, verb: "shove", rung: 3, origin: "director", act_id: "d.1", scene: "7.1", seq: 1, at: r.clock.now() } as never);
    expect(r.body.unlockNote("duda", "en")).toBeUndefined();
    expect(r.body.escalate("shove", [], true)).toBe("already");
    expect(r.body.counters()["spine_unlock_shove"]).toBe(1);
  });

  it("the aggressor reads one line naming who it is aimed at, in the scene's language, and nobody else does", async () => {
    const r = rig({ allow: own });
    r.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    await r.clock.advance(20_000);
    r.body.noteSpoken(said("rafa", "duda", "Duda, você mentiu."));
    r.body.escalate("shove", [], true);
    expect(r.body.unlockNote("duda", "pt-BR")).toBe('Você não aguenta mais: se "Rafa" provocar de novo, parta pra cima.');
    expect(r.body.unlockNote("duda", "en")).toBe('You have had enough: if "Rafa" provokes you again, go for them.');
    expect(r.body.unlockNote("rafa", "pt-BR")).toBeUndefined();
    expect(r.body.unlockNote("gabi", "en")).toBeUndefined();
  });

  it("inert when drama is not in charge, for a pair the run does not allow, and after a scene cut", async () => {
    const off = rig({ allow: own, drama: false });
    off.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    expect(off.body.escalate("shove", [], true)).toBe("none");
    expect(off.body.counters()).toEqual({});
    const closed = rig({ allow: () => false });
    closed.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    expect(closed.body.escalate("shove", [], true)).toBe("none");
    expect(closed.body.counters()["spine_unlock_shove"]).toBeUndefined();
  });
});

describe("SpineEscalation", () => {
  const own = (a: string, b: string): boolean => a !== b && ["duda", "rafa", "gabi", "leo"].includes(a) && ["duda", "rafa", "gabi", "leo"].includes(b);
  const said = (speaker: string, target: string, text: string) => ({ speaker, content: text, addressees: [target], mentioned: [target] });
  const cast = [
    { id: "duda", name: "Duda", objective: { description: "manter o cofre fechado", scarceResourceId: "cofre", constraint: "x" } },
    { id: "gabi", name: "Gabi" },
    { id: "rafa", name: "Rafa", objective: { description: "abrir o cofre", scarceResourceId: "cofre", costOfExposure: "y" } },
  ];

  function build(o: { enabled?: boolean } = {}) {
    const r = rig({ allow: own });
    const built = buildSpine({ language: "pt-BR", cast })!;
    const recorder = new SceneRecorder(cast.map((c) => c.name));
    const startedAt = r.clock.now();
    const esc = o.enabled === false ? undefined : new SpineEscalation(r.body, built, "pt-BR");
    const scene = new SceneSpine(built, recorder, startedAt, esc?.onAdvance);
    esc?.attach(scene);
    return { r, built, scene, esc, startedAt };
  }

  /** Time passing the way a run lives it: the arc is looked at every few seconds (each prompt builds the spine's note), never in one jump. */
  async function tick(c: ReturnType<typeof build>, ms: number): Promise<void> {
    for (let t = 0; t < ms; t += 5000) {
      await c.r.clock.advance(5000);
      c.scene.advance(c.r.clock.now());
    }
  }

  it("the holder is Duda: the first of the two who contend for the safe; the spine's roles are what the coupling reads", () => {
    expect(buildSpine({ language: "pt-BR", cast })!.roles).toEqual({ duda: "holder", gabi: "free", rafa: "challenger" });
  });

  it("the turn finds no evidence in a quiet scene and counts it once; the decision counts its own miss; nothing is opened", async () => {
    const c = build();
    expect(c.esc).toBeDefined();
    await tick(c, 200_000);
    expect(c.scene.step).toBe(3);
    expect(c.r.body.counters()["spine_unlock_skipped_no_evidence"]).toBe(2);
    expect(c.r.body.counters()["spine_unlock_shove"]).toBeUndefined();
    expect(c.esc!.manifest(c.r.clock.now())).toMatchObject({ shove: 0, slap: 0, skipped_no_evidence: 2, grants: [] });
  });

  it("a hostile line said after the turn is looked at: the heat that comes late still opens the shove, and a later look is not a second miss", async () => {
    const c = build();
    await tick(c, 140_000);
    expect(c.scene.step).toBe(2);
    expect(c.r.body.counters()["spine_unlock_skipped_no_evidence"]).toBe(1);
    c.r.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    c.esc!.onLine(c.r.clock.now());
    expect(c.r.body.counters()["spine_unlock_shove"]).toBeUndefined();
    await tick(c, 15_000);
    c.r.body.noteSpoken(said("rafa", "duda", "Duda, você mentiu."));
    c.esc!.onLine(c.r.clock.now());
    expect(c.r.body.counters()["spine_unlock_shove"]).toBe(1);
    expect(c.r.body.counters()["spine_unlock_skipped_no_evidence"]).toBe(1);
    expect(c.esc!.manifest(c.r.clock.now()).grants[0]).toMatchObject({ level: "shove", aggressor: "duda", target: "rafa" });
  });

  it("before its turn the spine opens nothing, whatever is said: step 0 and 1 are pressure and the first demand", async () => {
    const { r, scene, esc } = build();
    r.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    await r.clock.advance(10_000);
    r.body.noteSpoken(said("rafa", "duda", "Duda, você mentiu."));
    esc!.onLine(r.clock.now());
    expect(scene.step).toBeLessThan(2);
    expect(r.body.counters()["spine_unlock_shove"]).toBeUndefined();
  });

  it("without the coupling (PERFECTMAN_SPINE_ESCALATE=0) the same scene opens nothing", async () => {
    const c = build({ enabled: false });
    expect(c.esc).toBeUndefined();
    await tick(c, 140_000);
    c.r.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    await tick(c, 15_000);
    c.r.body.noteSpoken(said("rafa", "duda", "Duda, você mentiu."));
    c.scene.advance(c.r.clock.now());
    expect(c.scene.step).toBe(2);
    expect(c.r.body.counters()["spine_unlock_shove"]).toBeUndefined();
    expect(c.r.body.counters()["spine_unlock_skipped_no_evidence"]).toBeUndefined();
  });

  it("the switch: on unless PERFECTMAN_SPINE_ESCALATE is 0", () => {
    expect(SPINE_ESCALATE_ENV).toBe("PERFECTMAN_SPINE_ESCALATE");
    expect(spineEscalateEnabled({})).toBe(true);
    expect(spineEscalateEnabled({ [SPINE_ESCALATE_ENV]: "1" })).toBe(true);
    expect(spineEscalateEnabled({ [SPINE_ESCALATE_ENV]: "0" })).toBe(false);
    expect(spineEscalateEnabled({ [SPINE_ESCALATE_ENV]: " 0 " })).toBe(false);
  });

  it("the aggressor's craft is the unlock line, then the spine's note, inside the beat-craft budget; everyone else's is the spine's note as it was", async () => {
    const c = build();
    await tick(c, 140_000);
    c.r.body.noteSpoken(said("rafa", "duda", "Duda, cofre hoje, senão eu conto pra mesa."));
    await tick(c, 15_000);
    c.r.body.noteSpoken(said("rafa", "duda", "Duda, você mentiu."));
    c.esc!.onLine(c.r.clock.now());
    const esc = c.esc!;
    const base = c.scene.textFor("duda", c.r.clock.now());
    expect(base).toBeDefined();
    const mine = esc.craftFor("duda", base);
    expect(mine!.startsWith('Você não aguenta mais: se "Rafa" provocar de novo, parta pra cima. ')).toBe(true);
    expect(mine!.length).toBeLessThanOrEqual(BEAT_CRAFT_MAX_CHARS);
    expect(esc.craftFor("rafa", c.scene.textFor("rafa", c.r.clock.now()))).toBe(c.scene.textFor("rafa", c.r.clock.now()));
    expect(c.built.roles["duda"]).toBe("holder");
    // A note that fills the budget is cut at its tail, never the unlock line.
    const full = "x".repeat(BEAT_CRAFT_MAX_CHARS);
    const cut = esc.craftFor("duda", full)!;
    expect(cut.length).toBeLessThanOrEqual(BEAT_CRAFT_MAX_CHARS);
    expect(cut.startsWith("Você não aguenta mais")).toBe(true);
    expect(cut.endsWith("…")).toBe(true);
    // No spine note at all: the line alone.
    expect(esc.craftFor("duda", undefined)).toBe('Você não aguenta mais: se "Rafa" provocar de novo, parta pra cima.');
  });
});
