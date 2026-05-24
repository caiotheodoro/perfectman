import type { PersonaConfig } from "@perfectman/shared";
import type { LlmConfig } from "../llm/llm-config.js";
import type { PersonaPromptProfile } from "./persona-prompt-profile.js";

export type ConfiguredAgent = {
  id: string;
  persona: PersonaConfig;
  promptProfile: PersonaPromptProfile;
  llm: LlmConfig;
};

export class AgentConfigRegistry {
  private readonly agents = new Map<string, ConfiguredAgent>();

  constructor(agents: ConfiguredAgent[]) {
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
    }
  }

  getAgent(agentId: string): ConfiguredAgent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent config not found: ${agentId}`);
    return agent;
  }

  getPersona(agentId: string): PersonaConfig {
    return this.getAgent(agentId).persona;
  }

  getPromptProfile(agentId: string): PersonaPromptProfile {
    return this.getAgent(agentId).promptProfile;
  }

  getLlmConfig(agentId: string): LlmConfig {
    return this.getAgent(agentId).llm;
  }

  list(): ConfiguredAgent[] {
    return [...this.agents.values()];
  }
}
