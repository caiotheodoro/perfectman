/**
 * The fake grid hotel's act seam (`ActPort`): without a sequencer the grid is the one every body probe has always run on; with one, an `act` command
 * reaches it and its locks refuse the commands they hold (REA-9).
 */
import { describe, expect, it } from "vitest";
import type { BodyCommandBody } from "@perfectman/shared";
import { FakeGridHotel } from "../embodiment/fake-grid-hotel.js";
import type { ActPort, GridEvent } from "../embodiment/fake-grid-hotel.js";

function setup(port?: ActPort) {
  const events: GridEvent[] = [];
  const grid = new FakeGridHotel({ onEvent: (e) => events.push(e) });
  grid.spawnActor("rafa", "Rafa", "lounge", [1, 4]);
  grid.advance(250);
  grid.spawnActor("duda", "Duda", "lounge", [1, 6]);
  if (port) grid.setActPort(port);
  return { grid, events, tile: (id: string) => grid.view(id, grid.now())?.self?.tile };
}

const glare: BodyCommandBody = { cmd: "act", actId: "a1", verb: "glare", with: "duda" };

describe("the grid's act port", () => {
  it("with no port an act command changes nothing and refuses nothing: the grid is the one the body probes run on", async () => {
    const { grid, events, tile } = setup();
    await grid.dispatch([{ agentId: "rafa", cmd: "act", actId: "a1", verb: "glare", with: "duda" }]);
    expect(events).toEqual([]);
    expect(grid.stats.refused).toBe(0);
    expect(tile("rafa")).toEqual([1, 4]);
  });

  it("with a port every command of a known actor reaches it first, and an act is the port's alone to play", async () => {
    const seen: Array<[string, string]> = [];
    const { grid, tile } = setup({ command: (agentId, c) => (seen.push([agentId, c.cmd]), undefined) });
    await grid.dispatch([{ agentId: "rafa", cmd: "act", actId: "a1", verb: "glare", with: "duda" }, { agentId: "rafa", cmd: "walk", to: [3, 4] }]);
    grid.advance(1000);
    expect(seen).toEqual([["rafa", "act"], ["rafa", "walk"]]);
    expect(tile("rafa")).toEqual([3, 4]);
  });

  it("[REA-9] a refusal is the hotel's answer: act_busy, counted as a refusal, and the command does nothing", async () => {
    const { grid, events, tile } = setup({ command: (_a, c) => (c.cmd === "walk" ? "act_busy" : undefined) });
    await grid.dispatch([{ agentId: "rafa", cmd: "walk", to: [3, 4] }]);
    grid.advance(1000);
    expect(tile("rafa")).toEqual([1, 4]);
    expect(events).toContainEqual({ type: "actor_error", agentId: "rafa", code: "act_busy", cmd: "walk" });
    expect(grid.stats.refused).toBe(1);
    expect(grid.frameLog().frames.filter((f) => f.kind === "actor_error")).toHaveLength(1);
  });

  it("the port is not asked about an actor the grid does not know, and can be taken away", async () => {
    const seen: string[] = [];
    const { grid } = setup({ command: (agentId) => (seen.push(agentId), undefined) });
    await grid.dispatch([{ agentId: "ghost", cmd: glare.cmd, actId: "a2", verb: "glare" } as never]);
    expect(seen).toEqual([]);
    grid.setActPort(undefined);
    await grid.dispatch([{ agentId: "rafa", cmd: "stand" }]);
    expect(seen).toEqual([]);
  });
});
