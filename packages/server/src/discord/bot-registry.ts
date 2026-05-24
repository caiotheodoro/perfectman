import { Client, GatewayIntentBits } from "discord.js";
import type { Guild } from "discord.js";

export type PersonaBotHandle = {
  agentId: string;
  userId: string;
  client: Client<true>;
  guild: Guild;
};

export type BotRegistryDeps = {
  createClient?: () => Client;
};

const READY_TIMEOUT_MS = 30_000;

export class BotRegistry {
  private readonly guildId: string;
  private readonly personas = new Map<string, PersonaBotHandle>();
  private managerHandle: PersonaBotHandle | null = null;
  private readonly createClient: () => Client;

  constructor(guildId: string, deps?: BotRegistryDeps) {
    this.guildId = guildId;
    this.createClient =
      deps?.createClient ??
      (() => new Client({ intents: [GatewayIntentBits.Guilds] }));
  }

  async startPersonaBot(agentId: string, token: string): Promise<PersonaBotHandle> {
    if (this.personas.has(agentId)) {
      throw new Error(`bot already registered for agent "${agentId}"`);
    }

    const handle = await this.loginBot(agentId, token);
    this.personas.set(agentId, handle);
    return handle;
  }

  async startManagerBot(token: string): Promise<PersonaBotHandle> {
    if (this.managerHandle) {
      throw new Error("manager bot already registered");
    }
    const handle = await this.loginBot("__manager__", token);
    this.managerHandle = handle;
    return handle;
  }

  get(agentId: string): PersonaBotHandle {
    const handle = this.personas.get(agentId);
    if (!handle) throw new Error(`no bot registered for agent "${agentId}"`);
    return handle;
  }

  getManagerBot(): PersonaBotHandle {
    if (!this.managerHandle) throw new Error("no manager bot registered");
    return this.managerHandle;
  }

  has(agentId: string): boolean {
    return this.personas.has(agentId);
  }

  getUserId(agentId: string): string {
    return this.get(agentId).userId;
  }

  allAgentIds(): string[] {
    return [...this.personas.keys()];
  }

  async shutdown(): Promise<void> {
    const clients: Client[] = [...this.personas.values()].map((h) => h.client);
    if (this.managerHandle) clients.push(this.managerHandle.client);
    this.personas.clear();
    this.managerHandle = null;
    await Promise.all(clients.map((c) => c.destroy()));
  }

  private async loginBot(agentId: string, token: string): Promise<PersonaBotHandle> {
    const client = this.createClient();

    const readyPromise = new Promise<Client<true>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`bot "${agentId}": ready timeout after ${READY_TIMEOUT_MS}ms`)),
        READY_TIMEOUT_MS,
      );
      client.once("ready", (readyClient) => {
        clearTimeout(timer);
        resolve(readyClient);
      });
      client.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    await client.login(token);
    const readyClient = await readyPromise;

    const guild = readyClient.guilds.cache.get(this.guildId);
    if (!guild) {
      await client.destroy();
      throw new Error(`bot "${agentId}": guild ${this.guildId} not found`);
    }
    if (!guild.available) {
      await client.destroy();
      throw new Error(`bot "${agentId}": guild ${this.guildId} unavailable`);
    }

    return {
      agentId,
      userId: readyClient.user.id,
      client: readyClient,
      guild,
    };
  }
}
