import { describe, it, expect, vi } from "vitest";
import { BotRegistry } from "../bot-registry.js";

function createFakeClient(userId: string, guildId: string, guildAvailable = true) {
  const guild = { id: guildId, available: guildAvailable };
  const guilds = { cache: new Map([[guildId, guild]]) };
  const user = { id: userId };

  let readyHandler: ((client: unknown) => void) | null = null;
  let errorHandler: ((err: Error) => void) | null = null;

  const client = {
    user: null as typeof user | null,
    guilds: { cache: new Map() },
    once(event: string, handler: (...args: unknown[]) => void) {
      if (event === "ready") readyHandler = handler;
      if (event === "error") errorHandler = handler;
      return client;
    },
    async login(_token: string) {
      client.user = user;
      (client as Record<string, unknown>).guilds = guilds;
      if (readyHandler) readyHandler(client);
    },
    async destroy() {},
    _triggerError(err: Error) {
      if (errorHandler) errorHandler(err);
    },
  };

  return client;
}

function makeRegistry(guildId: string, fakeClients: Array<ReturnType<typeof createFakeClient>>) {
  let idx = 0;
  return new BotRegistry(guildId, {
    createClient: () => {
      const c = fakeClients[idx++];
      if (!c) throw new Error("no more fake clients");
      return c as never;
    },
  });
}

describe("BotRegistry", () => {
  const GUILD_ID = "guild-1";

  it("starts and retrieves persona bot", async () => {
    const reg = makeRegistry(GUILD_ID, [createFakeClient("user-alice", GUILD_ID)]);
    const handle = await reg.startPersonaBot("alice", "tok");
    expect(handle.agentId).toBe("alice");
    expect(handle.userId).toBe("user-alice");
    expect(reg.has("alice")).toBe(true);
    expect(reg.getUserId("alice")).toBe("user-alice");
  });

  it("starts and retrieves manager bot", async () => {
    const reg = makeRegistry(GUILD_ID, [createFakeClient("user-mgr", GUILD_ID)]);
    await reg.startManagerBot("tok");
    const mgr = reg.getManagerBot();
    expect(mgr.userId).toBe("user-mgr");
  });

  it("throws on unknown agentId", () => {
    const reg = makeRegistry(GUILD_ID, []);
    expect(() => reg.get("nonexistent")).toThrow('no bot registered for agent "nonexistent"');
  });

  it("throws on duplicate agentId", async () => {
    const reg = makeRegistry(GUILD_ID, [
      createFakeClient("u1", GUILD_ID),
      createFakeClient("u2", GUILD_ID),
    ]);
    await reg.startPersonaBot("alice", "tok1");
    await expect(reg.startPersonaBot("alice", "tok2")).rejects.toThrow(
      'bot already registered for agent "alice"',
    );
  });

  it("throws on duplicate manager", async () => {
    const reg = makeRegistry(GUILD_ID, [
      createFakeClient("m1", GUILD_ID),
      createFakeClient("m2", GUILD_ID),
    ]);
    await reg.startManagerBot("tok1");
    await expect(reg.startManagerBot("tok2")).rejects.toThrow("manager bot already registered");
  });

  it("throws when guild unavailable", async () => {
    const reg = makeRegistry(GUILD_ID, [
      createFakeClient("u1", GUILD_ID, false),
    ]);
    await expect(reg.startPersonaBot("alice", "tok")).rejects.toThrow("unavailable");
  });

  it("throws when guild not found", async () => {
    const reg = makeRegistry(GUILD_ID, [
      createFakeClient("u1", "other-guild"),
    ]);
    await expect(reg.startPersonaBot("alice", "tok")).rejects.toThrow("not found");
  });

  it("shutdown destroys all clients", async () => {
    const fakes = [createFakeClient("u1", GUILD_ID), createFakeClient("u2", GUILD_ID)];
    const spies = fakes.map((f) => vi.spyOn(f, "destroy"));
    const reg = makeRegistry(GUILD_ID, fakes);
    await reg.startPersonaBot("alice", "tok");
    await reg.startManagerBot("tok2");
    await reg.shutdown();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(reg.has("alice")).toBe(false);
    expect(() => reg.getManagerBot()).toThrow();
  });

  it("allAgentIds returns registered persona ids", async () => {
    const reg = makeRegistry(GUILD_ID, [
      createFakeClient("u1", GUILD_ID),
      createFakeClient("u2", GUILD_ID),
    ]);
    await reg.startPersonaBot("alice", "t1");
    await reg.startPersonaBot("bob", "t2");
    expect(reg.allAgentIds().sort()).toEqual(["alice", "bob"]);
  });
});
