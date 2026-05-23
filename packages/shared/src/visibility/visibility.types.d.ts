import type { EventVisibility } from "../event/event.types.js";
import type { SimulationSettings } from "../simulation/simulation.types.js";
import type { ChannelMembership } from "../channel/channel.types.js";
export type { EventVisibility };
export type VisibilityContext = {
    agentId: string;
    membership: ChannelMembership[];
    settings: SimulationSettings;
};
//# sourceMappingURL=visibility.types.d.ts.map