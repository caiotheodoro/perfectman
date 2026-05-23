export type MotivationType = "boredom" | "curiosity" | "repair" | "gossip" | "status" | "attraction" | "comfort" | "alliance" | "avoidance" | "control" | "testing" | "conflict" | "exclusion" | "liking" | "vulnerability" | "secrecy" | "impulse";
export type MotivationStrength = "weak" | "moderate" | "strong";
export type Motivation = {
    type: MotivationType;
    strength: MotivationStrength;
    targetAgentIds: string[];
    targetChannelId?: string;
    description: string;
};
//# sourceMappingURL=motivation.types.d.ts.map