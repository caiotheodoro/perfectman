import { afterEach, describe, expect, it } from "vitest";
import type { CineConfig } from "../director/cine/types.js";
import type { Sidecar } from "../sidecar.js";
import { FakeDirector } from "../testing/fake-director.js";
import { TEST_SECRET, bootSidecar, waitFor } from "../testing/helpers.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  sidecar = fake = undefined;
});

const FAST_CINE: Partial<CineConfig> = {
  readingScale: 0.02, introMs: 300, sceneCardMs: 200, fillerAfterMs: 250, fillerMs: 150, minShotMs: 40,
  easeMs: { establishing: 20, two_shot: 20, close_up: 10, tracking: 20, reaction: 10 },
  minRoomHoldMs: 300, beatGapMs: 20, cueLeadMs: 10, typingLeadMs: 20, narratorWaitMs: 50, drainMs: 500, pulseMs: 150,
};

async function cinematic() {
  fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 });
  fake.addRoom(12);
  fake.addRoom(13, 10, 8, { name: "Jardim" });
  fake.addHuman(12, 9, "ana", 8, 5);
  fake.addHuman(13, 10, "beto", 5, 4);
  const booted = await bootSidecar({ fake, timing: { cine: FAST_CINE } });
  sidecar = booted.sidecar;
  fake.startRun({ run: 7, room: 12, scenarioVersion: 31, mode: "cinematic" });
  await waitFor(() => fake?.received.find((f) => f.t === "run_ack" && f.ok), "run_ack");
  await waitFor(() => fake?.received.filter((f) => f.t === "actor_spawn").length === 3, "three spawns");
  await waitFor(() => ["person-1", "person-2", "person-3"].every((r) => sidecar?.manager?.mirror.scoped(7).roomOfRef(r) === "12"), "the cast registered");
  return fake;
}

const ui = (hotel: FakeDirector) => hotel.received.flatMap((f, i) => (f.t === "ui_push" ? [{ i, ui: f.ui }] : []));

describe("a cinematic run that never leaves its room (scenario b)", () => {
  it("still gets a narrator caption, right after the opening card", async () => {
    const hotel = await cinematic();
    const caption = await waitFor(() => ui(hotel).find((u) => u.ui.k === "caption"), "a caption", 4000);
    const card = ui(hotel).find((u) => u.ui.k === "card" && u.ui.kind === "title");
    expect(card).toBeDefined();
    expect(caption.i).toBeGreaterThan(card?.i ?? Infinity);
    if (caption.ui.k === "caption") expect(caption.ui.text).toMatch(/Duda|Rafa|Gabi/);
  }, 20_000);
});

describe("a director's whisper that sends a character out of the room", () => {
  it("walks the actor to the door and through it without the model writing a body block: subscribe first, then the move, then the cut and the scene's card and caption", async () => {
    const hotel = await cinematic();
    const duda = hotel.avatarByRef("person-1", 7);
    expect(duda).toBeDefined();
    await waitFor(() => ui(hotel).find((u) => u.ui.k === "card" && u.ui.kind === "title"), "the opening", 4000);

    hotel.pmCommand(7, 12, "whisper", '"Duda" sai do Quarto e vai para outra sala buscar agua');
    await waitFor(() => hotel.received.find((f) => f.t === "actor_cmd" && f.actor === duda?.id && f.cmd.k === "move_room"), "the move through the door", 8000);

    const frames = hotel.received;
    const subscribe = frames.findIndex((f) => f.t === "subscribe_room" && f.room === 13);
    const move = frames.findIndex((f) => f.t === "actor_cmd" && f.actor === duda?.id && f.cmd.k === "move_room");
    expect(subscribe).toBeGreaterThan(-1);
    expect(subscribe).toBeLessThan(move);
    const walk = frames.findIndex((f) => f.t === "actor_cmd" && f.actor === duda?.id && f.cmd.k === "walk" && f.cmd.x === 0);
    expect(walk).toBeGreaterThan(-1);
    expect(walk).toBeLessThan(move);
    expect(frames[move]).toMatchObject({ cmd: { k: "move_room", room: 13 } });

    await waitFor(() => hotel.rooms.get(13)?.avatars.has(duda?.id ?? 0), "Duda in the garden", 6000);
    await waitFor(() => sidecar?.manager?.mirror.scoped(7).roomOfRef("person-1") === "13", "Duda mirrored in the garden");
    // The camera follows the first thing that happens there: Duda says something.
    const cut = await waitFor(() => ui(hotel).find((u) => u.ui.k === "cut" && u.ui.room === 13), "the cut to the garden", 8000);
    const sceneCard = await waitFor(() => ui(hotel).find((u) => u.ui.k === "card" && u.ui.kind === "scene"), "the garden's scene card", 4000);
    const aside = await waitFor(() => ui(hotel).find((u) => u.i > cut.i && u.ui.k === "caption"), "the garden's narrator aside", 4000);
    expect(aside.ui).toMatchObject({ k: "caption", text: expect.stringContaining("Duda") });
    expect(sceneCard.i).toBeGreaterThan(cut.i - 5);
    expect(sidecar?.manager?.mirror.scoped(7).roomOfRef("person-1")).toBe("13");
  }, 30_000);

  it("leaves a whisper that is not about leaving to the model alone", async () => {
    const hotel = await cinematic();
    const before = hotel.received.filter((f) => f.t === "actor_cmd" && f.cmd.k === "move_room").length;
    hotel.pmCommand(7, 12, "whisper", '"Duda" fala mais baixo, a Rafa esta cansada');
    await waitFor(() => hotel.received.some((f) => f.t === "ui_push" && f.ui.k === "notice" && f.ui.code === "whisper_ok"), "whisper_ok", 4000);
    await new Promise((r) => setTimeout(r, 600));
    expect(hotel.received.filter((f) => f.t === "actor_cmd" && f.cmd.k === "move_room").length).toBe(before);
  }, 20_000);
});
