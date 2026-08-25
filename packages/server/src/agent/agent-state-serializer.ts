import type { AgentState, RelationalState } from "@perfectman/shared";

/** Serializable agent state — `relationalStates` Map replaced with a plain object. */
export type SerializedAgentState = Omit<AgentState, "relationalStates"> & {
  relationalStates: Record<string, RelationalState>;
};

/** The single implementation shared by the scheduler's snapshot emission and the
 *  e2e recorder's frames — stream/recorder parity depends on both producers
 *  serializing through this. Change in place; never duplicate per producer. */
export function serializeAgentState(state: AgentState): SerializedAgentState {
  return {
    ...state,
    relationalStates: Object.fromEntries(state.relationalStates.entries()),
  };
}