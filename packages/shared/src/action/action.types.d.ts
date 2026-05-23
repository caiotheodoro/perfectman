import type { IntentType } from "../intent/intent.types.js";
export type AvailableAction = {
    intentType: IntentType;
    channelTargets: string[];
    personTargets: string[];
    blocked: boolean;
    blockReason?: string;
};
//# sourceMappingURL=action.types.d.ts.map