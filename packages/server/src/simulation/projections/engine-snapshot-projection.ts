import type {
  EngineSnapshot,
  CommittedEvent,
  AgentState,
  Channel,
  ChannelMembership,
  WorldSignals,
  RateLimitStatus,
  Simulation,
  SeededRng,
  PersonaConfig,
  RelationalState,
} from "@perfectman/shared";

export type EngineSnapshotInput = {
  pulseIndex: number;
  simulation: Simulation;
  recentEventsWindow: CommittedEvent[];
  now: number;
  agentState: AgentState;
  persona: PersonaConfig;
  channels: Channel[];
  membership: ChannelMembership[];
  relationalStates: Map<string, RelationalState>;
  worldSignals: WorldSignals;
  rateLimitStatus: RateLimitStatus;
  dt: number;
  rng: SeededRng;
};

export class EngineSnapshotProjection {
  build(input: EngineSnapshotInput): EngineSnapshot {
    return {
      pulseIndex: input.pulseIndex,
      simulation: input.simulation,
      recentEventsWindow: input.recentEventsWindow,
      now: input.now,
      agentState: input.agentState,
      persona: input.persona,
      channels: input.channels,
      channelMembership: input.membership,
      relationalStates: input.relationalStates,
      worldSignals: input.worldSignals,
      rateLimitStatus: input.rateLimitStatus,
      dt: input.dt,
      rng: input.rng,
    };
  }
}
