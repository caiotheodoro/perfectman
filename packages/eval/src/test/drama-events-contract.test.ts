import { describe, it, expect } from "vitest";
import { extractDramaEvents } from "../drama/index.js";
import { contractEvents, contractFrames, contractLines, innerOf, loadLines, mapFrames, of, wire } from "./drama-contract-kit.js";

describe("extractDramaEvents on the act contract: act_started and act_beat", () => {
  const events = contractEvents("contract-slap-human-take");
  const a17 = of(events, "act_started").find((e) => e.actId === "a17")!;

  it("reads every act_started field of the contract, with the human target as h:<id>", () => {
    expect(a17).toEqual({
      kind: "act_started",
      atMs: 103_459,
      hotelAt: 1730000123456,
      room: "12",
      actId: "a17",
      verb: "slap",
      actor: "person-1",
      with: "h:9",
      intensity: 0.6,
      impact: "M",
      origin: "director",
      scene: "7.2",
      rung: 4,
      skippedRungs: [],
      authoredSkip: false,
      targetOptIn: true,
      chip: true,
      run: 7,
      seq: 201,
    });
  });

  it("keeps contact_in_ms for an unchipped act and leaves it out when the chip decides", () => {
    const a15 = of(events, "act_started").find((e) => e.actId === "a15")!;
    expect(a15).toMatchObject({ chip: false, contactInMs: 300 });
    expect(a17).not.toHaveProperty("contactInMs");
  });

  it("reads act_beat with its witnesses and its owed debts as refs, in the hotel's order", () => {
    const beat = of(events, "act_beat").find((e) => e.actId === "a17")!;
    expect(beat).toEqual({
      kind: "act_beat",
      atMs: 104_013,
      hotelAt: 1730000124010,
      room: "12",
      actId: "a17",
      beat: "contact",
      witnesses: ["person-3", "person-2", "h:11"],
      owed: [
        { who: "person-2", role: "witness", dueAt: 1730000127010 },
        { who: "person-3", role: "witness", dueAt: 1730000127010 },
      ],
      scene: "7.2",
    });
  });

  it("reads a target debt next to witness debts, and no target debt when the target is a human", () => {
    const owed = (id: string) => of(events, "act_beat").find((e) => e.actId === id)!.owed.map((o) => `${o.who}:${o.role}`);
    expect(owed("a15")).toEqual(["person-3:witness", "person-2:target"]);
    expect(owed("a17")).toEqual(["person-2:witness", "person-3:witness"]);
  });

  it("keeps the planner's reaction, labelled cmd:<k>, next to the table's", () => {
    const reactions = of(events, "act_reaction").filter((e) => e.actId === "a17");
    expect(reactions.map((e) => [e.who, e.reaction, e.source, e.hotelAt])).toEqual([
      ["person-2", "freeze_gasp", "table", 1730000124790],
      ["person-3", "cmd:face", "planner", 1730000125100],
    ]);
  });

  it("stamps the act's scene on the frames that carry only an act_id", () => {
    expect(of(events, "act_reaction").every((e) => e.scene === "7.2")).toBe(true);
    expect(of(events, "act_done").every((e) => e.scene === "7.2")).toBe(true);
  });
});

describe("extractDramaEvents on the act contract: drama_consent and act_done", () => {
  const events = contractEvents("contract-slap-human-take");

  it("reads the chip's shown and answered frames keyed by act_id, keeping the raw answer", () => {
    const chips = of(events, "consent_chip").filter((e) => e.actId === "a17");
    expect(chips).toEqual([
      { kind: "consent_chip", phase: "shown", atMs: 103_472, hotelAt: 1730000123470, room: "12", actId: "a17", pairId: "a17", from: "person-1", pairKind: "slap", family: "violent", ttlMs: 4000 },
      { kind: "consent_chip", phase: "answered", atMs: 103_862, hotelAt: 1730000123860, room: "12", actId: "a17", pairId: "a17", actor: "person-1", with: "h:9", answer: "take", rawAnswer: "take", family: "violent" },
    ]);
  });

  it.each([
    ["take", "take"],
    ["dodge", "decline"],
    ["push_back", "decline"],
    ["timeout", "timeout"],
  ] as const)("maps the chip answer %s to %s and keeps the raw value", (raw, mapped) => {
    const lines = mapFrames(contractLines("contract-slap-human-take"), (f) => f["t"] === "drama_consent" && f["phase"] === "answered", (f) => ({ ...f, answer: raw }));
    const answered = of(extractDramaEvents(loadLines(lines)), "consent_chip").find((e) => e.phase === "answered")!;
    expect(answered).toMatchObject({ answer: mapped, rawAnswer: raw });
  });

  it("drops a chip answer outside the four the contract names", () => {
    const lines = mapFrames(contractLines("contract-slap-human-take"), (f) => f["t"] === "drama_consent" && f["phase"] === "answered", (f) => ({ ...f, answer: "accept" }));
    expect(of(extractDramaEvents(loadLines(lines)), "consent_chip").filter((e) => e.phase === "answered")).toEqual([]);
  });

  it("reads act_done with its answer, owed_missed and downgraded", () => {
    const done = of(events, "act_done").find((e) => e.actId === "a17")!;
    expect(done).toEqual({
      kind: "act_done",
      atMs: 108_513,
      hotelAt: 1730000128510,
      room: "12",
      actId: "a17",
      outcome: "landed",
      verb: "slap",
      actor: "person-1",
      with: "h:9",
      answer: "take",
      owedMissed: [],
      downgraded: [],
      scene: "7.2",
    });
  });

  it("keeps the owed_missed entries as refs", () => {
    const lines = mapFrames(contractLines("contract-slap-human-take"), (f) => f["t"] === "act_done" && f["act_id"] === "a17", (f) => ({ ...f, owed_missed: [{ who: -703, role: "witness" }], downgraded: ["forced_step"] }));
    expect(of(extractDramaEvents(loadLines(lines)), "act_done").find((e) => e.actId === "a17")).toMatchObject({ owedMissed: [{ who: "person-3", role: "witness" }], downgraded: ["forced_step"] });
  });
});

describe("extractDramaEvents on the act contract: blocked and aborted acts", () => {
  const events = contractEvents("contract-blocked-aborted");

  it("keeps a blocked act_done that has no act_started, with its reason and detail", () => {
    expect(of(events, "act_started").map((e) => e.actId)).toEqual(["a23"]);
    const blocked = of(events, "act_done").filter((e) => e.outcome === "blocked");
    expect(blocked.map((e) => [e.actId, e.verb, e.actor, e.with, e.reason, e.detail])).toEqual([
      ["a18", "punch", "person-1", "h:9", "consent_off", undefined],
      ["a19", "slap", "person-1", "person-2", "no_scenario_gate", "free_play"],
    ]);
  });

  it("reads the aborted outcome with its abort reason, and no act_beat for it", () => {
    const aborted = of(events, "act_done").find((e) => e.actId === "a23")!;
    expect(aborted).toMatchObject({ outcome: "aborted", reason: "paused", verb: "insult", with: "h:9" });
    expect(of(events, "act_beat")).toEqual([]);
  });

  it("reads both drama_state frames: the room's scene, calm, pause and opt-in set as refs", () => {
    expect(of(events, "drama_state").map((e) => [e.scene, e.calm, e.paused, e.optIn, e.pausedUntil])).toEqual([
      ["7.2", false, false, ["h:9"], undefined],
      ["7.2", false, true, ["h:9"], 1730000900000],
    ]);
  });
});

describe("extractDramaEvents on the act contract: death, revive, scene cut and the down state", () => {
  const killed = contractEvents("contract-kill-actor-revive");
  const down = contractEvents("contract-kill-human-down");

  it("reads actor_death with its cause, act, killer and scene", () => {
    expect(of(killed, "actor_death")).toEqual([
      { kind: "actor_death", atMs: 120_183, hotelAt: 1730000200180, room: "12", actor: "person-2", cause: "kill", actId: "a20", killer: "person-1", scene: "7.2" },
    ]);
  });

  it("reads scene_cut with its revived and removed actors, then the revive it causes", () => {
    expect(of(killed, "scene_cut")).toEqual([{ kind: "scene_cut", atMs: 180_002, hotelAt: 1730000260000, scene: "7.3", prev: "7.2", revived: ["person-2"], removed: [] }]);
    expect(of(killed, "actor_revive")).toEqual([{ kind: "actor_revive", atMs: 180_003, hotelAt: 1730000260000, room: "12", actor: "person-2", scene: "7.3", prev: "7.2", x: 5, y: 6 }]);
    const order = killed.filter((e) => e.kind === "scene_cut" || e.kind === "actor_revive").map((e) => e.kind);
    expect(order).toEqual(["scene_cut", "actor_revive"]);
  });

  it("orders scene_cut before actor_revive when both carry the same stamp, whatever order the log has them in", () => {
    const tie = contractLines("contract-kill-actor-revive").map((l) => (["scene_cut", "actor_revive"].includes(String(innerOf(l)["t"])) ? { ...l, ts_ms: 1730000260000 } : l));
    const order = (lines: typeof tie) => extractDramaEvents(loadLines(lines)).filter((e) => e.kind === "scene_cut" || e.kind === "actor_revive").map((e) => e.kind);
    expect(order(tie)).toEqual(["scene_cut", "actor_revive"]);
    expect(order([...tie].reverse())).toEqual(["scene_cut", "actor_revive"]);
  });

  it("reads human_down and human_up, naming the human h:<id>, and a killed human is no actor_death", () => {
    expect(of(down, "human_down")).toEqual([{ kind: "human_down", atMs: 128_178, hotelAt: 1730000208175, room: "12", human: "h:9", actId: "a21", ms: 5000, scene: "7.2" }]);
    expect(of(down, "human_up")).toEqual([{ kind: "human_up", atMs: 133_178, hotelAt: 1730000213175, room: "12", human: "h:9", actId: "a21", reason: "timer" }]);
    expect(of(down, "actor_death")).toEqual([]);
  });
});

describe("extractDramaEvents on the act contract: refs, noise and malformed frames", () => {
  it("names a human h:<id> from the first frame on, whether or not they ever spoke", () => {
    const events = contractEvents("contract-kill-human-down");
    const beat = of(events, "act_started")[0]!;
    expect(beat.with).toBe("h:9");
    expect(of(events, "speech").find((e) => e.text === "Ai.")!.actor).toBe("h:9");
    const witness = contractEvents("contract-slap-human-take").find((e) => e.kind === "act_beat" && e.actId === "a17")!;
    expect(witness.kind === "act_beat" && witness.witnesses.at(-1)).toBe("h:11");
  });

  it("does not let a human chat line rename a human away from h:<id>", () => {
    const lines = mapFrames(contractLines("contract-kill-human-down"), (f) => f["t"] === "human_chat", (f) => ({ ...f, from: { id: 9, name: "person-2" } }));
    expect(of(extractDramaEvents(loadLines(lines)), "act_started")[0]!.with).toBe("h:9");
  });

  it("ignores scene_advance (the sidecar's own command) and reads nothing from it", () => {
    const frames = contractFrames("contract-kill-actor-revive");
    expect(frames.some((f) => f.kind === "scene_advance" && f.dir === "in")).toBe(true);
    expect(extractDramaEvents(frames).some((e) => e.kind.includes("advance"))).toBe(false);
  });

  it("leaves with off a solo verb's act_started", () => {
    const e = extractDramaEvents([wire({ t: "act_started", act_id: "c1", verb: "cry", actor: -701, intensity: 0.4, scene: "7.2", authored_skip: false, chip: false, contact_in_ms: 0 }, 1000)]);
    expect(of(e, "act_started")[0]).not.toHaveProperty("with");
  });

  it("drops the contract frames that lack their required fields", () => {
    const frames = [
      wire({ t: "act_beat", beat: "contact", witnesses: [], owed: [] }, 1000),
      wire({ t: "act_beat", act_id: "x", beat: "contact", witnesses: "none", owed: [] }, 1000),
      wire({ t: "drama_consent", act_id: "x", phase: "opened", actor: -701, with: 9 }, 1000),
      wire({ t: "scene_cut", prev: "7.1", revived: [], removed: [] }, 1000),
      wire({ t: "human_down", human: 9, act_id: "x" }, 1000),
      wire({ t: "human_up", act_id: "x" }, 1000),
      wire({ t: "actor_revive", scene: "7.3" }, 1000),
      wire({ t: "act_done", act_id: "x", outcome: "blocked", owed_missed: [{ role: "witness" }] }, 1000),
    ];
    expect(extractDramaEvents(frames).map((e) => e.kind)).toEqual(["act_done"]);
    expect(of(extractDramaEvents(frames), "act_done")[0]!.owedMissed).toEqual([]);
  });

  it("gives the same events in any input order", () => {
    const frames = contractFrames("contract-kill-actor-revive");
    expect(extractDramaEvents([...frames].reverse())).toEqual(extractDramaEvents(frames));
  });
});
