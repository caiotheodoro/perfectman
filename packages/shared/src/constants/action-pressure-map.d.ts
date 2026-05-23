/**
 * 15 ActionEmotion → Pressure/Inhibition mappings.
 * Each entry maps an L4 action emotion to the pressure type it generates
 * and optionally an inhibition type it can also activate.
 *
 * Engine reads this table in compute-pressures.ts and compute-inhibitions.ts.
 */
export type ActionPressureEntry = {
    actionEmotion: string;
    pressureType: string;
    visibilityBias: "public" | "private" | "either";
    inhibitionType?: string;
    pressureWeight: number;
    inhibitionWeight?: number;
};
export declare const ACTION_PRESSURE_MAP: readonly ActionPressureEntry[];
/** Get the pressure entry for a given action emotion */
export declare function getActionPressureEntry(actionEmotion: string): ActionPressureEntry | undefined;
//# sourceMappingURL=action-pressure-map.d.ts.map