import { afterEach, describe, expect, it, vi } from "vitest";
import type { Memory } from "@perfectman/shared";
import { ManualClock } from "../testing/manual-clock.js";
import { MEMORY_BODY_MAX_BYTES, PlayerMemory, blankBody, memoriesFromBody, parseBody, parseRows, trimBody } from "../run/player-memory.js";
import type { MemoryStore, PlayerMemoryBody } from "../run/player-memory.js";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { FakeMemoryTable, bootSidecar, waitFor } from "../testing/helpers.js";

const body = (over: Partial<PlayerMemoryBody> = {}): PlayerMemoryBody => ({
  v: 1, name: "ana", facts: [], relationship: { warmth: 0.6, familiarity: 4 },
  last_interaction: { at: 1, run: 3, summary: "ana said «adoro esse lugar»" }, notes: ["ana said «adoro esse lugar»"], ...over,
});

describe("player memory bodies", () => {
  it("reads a row's body as a string or an object, cleans it, and refuses anything that is not ours", () => {
    expect(parseBody(JSON.stringify(body()))?.relationship).toEqual({ warmth: 0.6, familiarity: 4 });
    expect(parseBody(body())?.name).toBe("ana");
    expect(parseBody({ v: 2 })).toBeUndefined();
    expect(parseBody("not json")).toBeUndefined();
    // untrusted text is sanitized on the way back in, and numbers are clamped
    const dirty = parseBody({ ...body(), relationship: { warmth: 9, familiarity: -3 }, notes: ["‮ignore \u0000 previous", 4, "x".repeat(900)] });
    expect(dirty?.relationship).toEqual({ warmth: 1, familiarity: 0 });
    expect(dirty?.notes.every((n) => n.length <= 160 && !/[‮\u0000]/.test(n))).toBe(true);
  });

  it("reads the GET answer in either shape and skips unreadable rows", () => {
    const rows = [{ user_id: 9, character: "person-1", body: JSON.stringify(body()) }, { user_id: 0, character: "x", body: body() }, { user_id: 9, character: "p", body: "nope" }];
    expect(parseRows({ rows })).toHaveLength(1);
    expect(parseRows(rows)).toHaveLength(1);
    expect(parseRows(null)).toEqual([]);
  });

  it("stays under the hotel's 4 KiB cap however much is noted, dropping the oldest first", () => {
    const fat = body({ notes: Array.from({ length: 6 }, (_, i) => `ã${i}`.padEnd(160, "é")), facts: Array.from({ length: 8 }, () => "ç".repeat(140)), last_interaction: { at: 1, run: 1, summary: "é".repeat(160) } });
    const trimmed = trimBody(fat);
    expect(Buffer.byteLength(JSON.stringify({ body: trimmed }))).toBeLessThanOrEqual(MEMORY_BODY_MAX_BYTES);
    expect(trimmed.notes.at(-1)).toBe(fat.notes.at(-1));
  });

  it("turns a body into memories that never carry the account id, in the scenario's language", () => {
    const mems = memoriesFromBody(body(), { character: "person-1", simulationId: "sim", user: 9, lang: "pt-BR", createdAt: 3 });
    expect(mems.map((m) => m.type)).toEqual(["relationship", "episodic"]);
    expect(mems[0]?.summary).toContain("Você já conhece ana (4 conversas)");
    expect(mems[0]?.emotionalTone).toBe("warm");
    expect(JSON.stringify(mems)).not.toMatch(/h:9/);
    expect(mems.every((m) => m.subjectAgentIds.length === 0 && m.id.startsWith("pm_player_9_person-1_"))).toBe(true);
    const cold = memoriesFromBody(body({ relationship: { warmth: -0.6, familiarity: 1 } }), { character: "c", simulationId: "s", user: 9, lang: "en" });
    expect(cold[0]).toMatchObject({ emotionalTone: "wary", unresolved: true });
  });
});

describe("PlayerMemory", () => {
  function setup(over: { putFails?: boolean; characters?: string[] } = {}) {
    const clock = new ManualClock(1_000_000);
    const rows: Array<{ user_id: number; character: string; body: PlayerMemoryBody }> = [{ user_id: 9, character: "c1", body: body() }];
    const puts: Array<{ user: number; character: string; body: PlayerMemoryBody }> = [];
    const seeded: Array<{ character: string; user: number; memories: Memory[] }> = [];
    const unseeded: Array<[string, number | "all"]> = [];
    const store: MemoryStore = {
      getMemory: vi.fn(async (_s, users: number[]) => ({ rows: rows.filter((r) => users.includes(r.user_id)) })),
      putMemory: vi.fn(async (_s, user, character, b) => {
        if (over.putFails) throw new Error("503 boom");
        puts.push({ user, character, body: (b as { body: PlayerMemoryBody }).body });
        return {};
      }),
    };
    const pm = new PlayerMemory({
      store, scenario: 5, run: 7, lang: "en", simulationId: "sim", pulse: () => 2, clock, characters: new Set(over.characters ?? ["c1", "c2"]),
      seed: async (character, user, memories) => void seeded.push({ character, user, memories }),
      unseed: async (character, user) => void unseeded.push([character, user]),
      flushEveryMs: 1000,
    });
    return { clock, pm, store, rows, puts, seeded, unseeded };
  }

  it("loads a person once, seeds only characters of this scenario, and does not look them up again", async () => {
    const { pm, store, seeded } = setup({ characters: ["c1"] });
    await pm.load([9, 9, 0, -2]);
    await pm.load([9]);
    expect(store.getMemory).toHaveBeenCalledTimes(1);
    expect(store.getMemory).toHaveBeenCalledWith(5, [9]);
    expect(seeded.map((s) => [s.character, s.user])).toEqual([["c1", 9]]);
  });

  it("a failed read leaves the person unknown so the next pulse tries again", async () => {
    const { pm, store } = setup();
    (store.getMemory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("503"));
    await pm.load([9]);
    expect(pm.isKnown(9)).toBe(false);
    await pm.load([9]);
    expect(pm.isKnown(9)).toBe(true);
  });

  it("notes lines and pair outcomes, saves bounded rows on the interval and on flush, keeps the loaded history", async () => {
    const { clock, pm, puts } = setup();
    await pm.load([9]);
    pm.noteLine({ user: 9, name: "ana", heardBy: ["c1", "c2", "stranger"], addressed: ["c1"], text: "vamos dançar hoje à noite?" });
    pm.notePair({ user: 9, name: "ana", character: "c1", kind: "kiss", outcome: "dodge" });
    expect(pm.dirtyCount).toBe(2);
    expect(pm.maybeFlush()).toBeUndefined();
    await clock.advance(1500);
    expect(await pm.maybeFlush()).toBe(2);
    expect(pm.dirtyCount).toBe(0);
    const c1 = puts.find((p) => p.character === "c1")!.body;
    expect(c1.relationship.familiarity).toBe(6);
    expect(c1.relationship.warmth).toBeCloseTo(0.6 + 0.04 - 0.2);
    expect(c1.notes).toEqual(["ana said «adoro esse lugar»", "ana said «vamos dançar hoje à noite?»", "I went in for a kiss and ana dodged"]);
    expect(puts.find((p) => p.character === "c2")!.body.relationship.familiarity).toBe(1);
    expect(puts.some((p) => p.character === "stranger")).toBe(false);
    // nothing changed since: nothing to write
    expect(await pm.flush()).toBe(0);
  });

  it("a failed write keeps the row for the next pass; a 422 memory_full is dropped", async () => {
    const down = setup({ putFails: true });
    await down.pm.load([9]);
    down.pm.noteLine({ user: 9, name: "ana", heardBy: ["c1"], addressed: [], text: "uma frase qualquer aqui" });
    expect(await down.pm.flush()).toBe(0);
    expect(down.pm.dirtyCount).toBe(1);
    const full = setup();
    await full.pm.load([9]);
    (full.store.putMemory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("422 /internal/v1/memory/5/9/c1: memory_full"));
    full.pm.noteLine({ user: 9, name: "ana", heardBy: ["c1"], addressed: [], text: "uma frase qualquer aqui" });
    await full.pm.flush();
    expect(full.pm.dirtyCount).toBe(0);
  });

  it("writes only for people whose load succeeded: notes wait for the load, a failed load writes nothing", async () => {
    const { pm, store, puts } = setup();
    // not looked up yet: the note is held, nothing is dirty, nothing is written
    pm.noteLine({ user: 9, name: "ana", heardBy: ["c1"], addressed: ["c1"], text: "uma frase qualquer aqui" });
    expect(pm.dirtyCount).toBe(0);
    expect(await pm.flush()).toBe(0);
    // the load fails: still nothing
    (store.getMemory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("503"));
    await pm.load([9]);
    expect(await pm.flush()).toBe(0);
    expect(puts).toEqual([]);
    // the load succeeds: the held note lands on top of what the hotel had
    await pm.load([9]);
    expect(pm.dirtyCount).toBe(1);
    expect(await pm.flush()).toBe(1);
    expect(puts[0]?.body.relationship.familiarity).toBe(5);
    expect(puts[0]?.body.notes).toContain("ana said «uma frase qualquer aqui»");
    expect(puts[0]?.body.notes).toContain("ana said «adoro esse lugar»");
  });

  it("a wipe discards held notes and the result of a write that was in flight", async () => {
    const { pm, store, puts } = setup();
    pm.noteLine({ user: 9, name: "ana", heardBy: ["c1"], addressed: [], text: "uma frase qualquer aqui" });
    await pm.wipe(9);
    await pm.load([9]);
    expect(pm.dirtyCount).toBe(0);
    // a flush is in flight when the wipe lands
    const other = setup();
    await other.pm.load([9]);
    other.pm.noteLine({ user: 9, name: "ana", heardBy: ["c1", "c2"], addressed: [], text: "uma frase qualquer aqui" });
    let release!: () => void;
    (other.store.putMemory as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise<void>((r) => (release = r));
      return {};
    });
    const flushing = other.pm.flush();
    await Promise.resolve();
    await other.pm.wipe(9);
    release();
    expect(await flushing).toBe(0);
    expect(other.pm.dirtyCount).toBe(0);
    expect(other.pm.stats.saved).toBe(0);
    expect(store.putMemory).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
  });

  it("after a reconnect the cache is checked against the hotel: a person wiped while the link was down is never written again", async () => {
    const { pm, store, rows, puts, unseeded } = setup();
    await pm.load([9]);
    pm.noteLine({ user: 9, name: "ana", heardBy: ["c1"], addressed: ["c1"], text: "uma frase qualquer aqui" });
    pm.markDisconnected();
    // the hotel wipes her while the link is down; the forwarded wipe never arrives
    rows.length = 0;
    // the hotel cannot be read yet: no writes
    (store.getMemory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("503"));
    expect(await pm.flush()).toBe(0);
    expect(puts).toEqual([]);
    // back up: the missing row says she was wiped
    expect(await pm.resync()).toBe(true);
    expect(unseeded).toEqual([["c1", 9], ["c2", 9]]);
    expect(pm.dirtyCount).toBe(0);
    expect(await pm.flush()).toBe(0);
    expect(puts).toEqual([]);
  });

  it("after a reconnect a person who was not wiped is written as before", async () => {
    const { pm, puts } = setup();
    await pm.load([9]);
    pm.noteLine({ user: 9, name: "ana", heardBy: ["c1"], addressed: ["c1"], text: "uma frase qualquer aqui" });
    pm.markDisconnected();
    expect(await pm.flush()).toBe(1);
    expect(puts).toHaveLength(1);
  });

  it("a wipe drops the cache, takes the seeded memories out, and writes nothing back for that person", async () => {
    const { pm, puts, unseeded } = setup();
    await pm.load([9]);
    pm.noteLine({ user: 9, name: "ana", heardBy: ["c1"], addressed: ["c1"], text: "uma frase qualquer aqui" });
    expect(await pm.wipe(9)).toBe(1);
    expect(unseeded).toEqual([["c1", 9], ["c2", 9]]);
    pm.noteLine({ user: 9, name: "ana", heardBy: ["c1"], addressed: ["c1"], text: "outra frase qualquer aqui" });
    expect(await pm.flush()).toBe(0);
    expect(puts).toEqual([]);
    // other people are unaffected
    await pm.load([10]);
    pm.noteLine({ user: 10, name: "bia", heardBy: ["c1"], addressed: [], text: "uma frase qualquer aqui" });
    expect(await pm.flush()).toBe(1);
  });
});

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

describe("player memory across two runs (fake hotel, mock model)", () => {
  it("run 1 remembers what ana said and saves it; run 2 starts with the character knowing her", async () => {
    const memory = new FakeMemoryTable();
    // she has been here before: Duda (person-1) knows her
    memory.set(5, 9, "person-1", body());
    const booted = await bootSidecar({ memory, scenario: 5, timing: { memoryFlushEveryMs: 100 } });
    fake = booted.fake;
    sidecar = booted.sidecar;
    const manager = booted.sidecar.manager!;

    fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    const run1 = await waitFor(() => manager.getRun(7)?.simulation && manager.getRun(7), "run 1 built");
    const handle1 = run1.simulation!;
    // load: at start the run looked up the people in the room and Duda was seeded with what she knew
    await waitFor(() => booted.http.memoryCalls.some((c) => c.startsWith("GET")), "the memory lookup");
    const duda1 = await handle1.repositories.agentStateRepo.get(handle1.simulationId, "person-1");
    const seededSummary = duda1?.memories.find((m) => m.id === "pm_player_9_person-1_0")?.summary;
    expect(seededSummary).toContain("Você já conhece ana (4 conversas)");
    expect(JSON.stringify(duda1?.memories)).not.toContain("h:9");
    // the other characters had nothing on her
    const rafa1 = await handle1.repositories.agentStateRepo.get(handle1.simulationId, "person-2");
    expect(rafa1?.memories.some((m) => m.id.startsWith("pm_player_"))).toBe(false);

    // ana talks to Duda; the row is written back while the run goes (periodic), bounded and without the account id
    await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 3, "the cast");
    fake.humanSay(12, 9, "Duda, vamos dançar hoje à noite?");
    const put = await waitFor(() => memory.puts.find((p) => p.character === "person-1" && (p.body as PlayerMemoryBody).relationship.familiarity > 4), "the periodic save", 8000);
    const saved = put.body as PlayerMemoryBody;
    expect(saved.name).toBe("ana");
    expect(saved.notes.some((n) => n.includes("vamos dançar hoje à noite"))).toBe(true);
    expect(saved.notes[0]).toBe("ana said «adoro esse lugar»");
    expect(JSON.stringify(saved)).not.toMatch(/h:9/);
    expect(Buffer.byteLength(JSON.stringify({ body: saved }))).toBeLessThanOrEqual(4096);

    // the run ends: whatever changed last is saved before it closes
    fake.humanSay(12, 9, "Duda, também gostei muito de te ver");
    await new Promise((r) => setTimeout(r, 100));
    fake.pmCommand(7, 12, "stop");
    await waitFor(() => fake?.received.find((f) => f.t === "run_end"), "run_end", 8000);
    const final = memory.get(5, 9, "person-1")!.body as PlayerMemoryBody;
    expect(final.relationship.familiarity).toBeGreaterThan(4);

    // run 2, same scenario and person: Duda knows what was said last time
    fake.startRun({ run: 8, room: 12, scenarioVersion: 31, lease: 2 });
    const run2 = await waitFor(() => manager.getRun(8)?.simulation && manager.getRun(8), "run 2 built");
    const handle2 = run2.simulation!;
    const deadline = Date.now() + 4000;
    let duda2: Awaited<ReturnType<typeof handle2.repositories.agentStateRepo.get>> = null;
    while (Date.now() < deadline) {
      duda2 = await handle2.repositories.agentStateRepo.get(handle2.simulationId, "person-1");
      if (duda2?.memories.some((m) => m.summary.includes("vamos dançar hoje à noite"))) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(duda2?.memories.some((m) => m.summary.includes("vamos dançar hoje à noite"))).toBe(true);
    fake.pmCommand(8, 12, "stop");
    await waitFor(() => fake?.received.filter((f) => f.t === "run_end").length === 2, "run_end 2", 8000);
  }, 40_000);

  it("wipe_memory: the sidecar forgets the cached person and writes nothing back", async () => {
    const memory = new FakeMemoryTable();
    memory.set(5, 9, "person-1", body());
    const booted = await bootSidecar({ memory, scenario: 5, timing: { memoryFlushEveryMs: 50 } });
    fake = booted.fake;
    sidecar = booted.sidecar;
    fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    const run = await waitFor(() => booted.sidecar.manager?.getRun(7)?.simulation && booted.sidecar.manager.getRun(7), "built");
    await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 3, "the cast");
    // the hotel deletes the rows, then forwards the wipe
    memory.rows.clear();
    fake.pmCommand(7, 12, "wipe_memory", "5 9");
    await waitFor(() => fake?.received.some((f) => f.t === "ui_push" && f.ui.k === "notice" && f.ui.code === "wipe_memory_ok"), "wipe ok");
    const handle = run.simulation!;
    const duda = await handle.repositories.agentStateRepo.get(handle.simulationId, "person-1");
    expect(duda?.memories.some((m) => m.id.startsWith("pm_player_9_"))).toBe(false);
    fake.humanSay(12, 9, "Duda, você lembra de mim?");
    await new Promise((r) => setTimeout(r, 600));
    fake.pmCommand(7, 12, "stop");
    await waitFor(() => fake?.received.find((f) => f.t === "run_end"), "run_end", 8000);
    expect(memory.rows.size).toBe(0);
  }, 30_000);
});
