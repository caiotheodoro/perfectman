import { readFileSync } from "node:fs";
import type { ActVerb } from "@perfectman/shared";

/**
 * The hotel's published verb table (`schema/verb-vocab.json`, vendored and hash-pinned: `VERB_VOCAB_SHA256`), read for the parts a fake
 * hotel needs to play an act: when contact comes, what the target and the witnesses show, who owes a reaction, how a scene is held.
 * Offline tooling only (the eval harness's fake hotel); the sidecar's own code reads the generated constants, never this file.
 */
export type TableStep = { t: { a: "T0" | "Tc"; ms: number; hs?: boolean; stagger?: boolean }; p: string; reaction?: string; verb?: string; name?: string; to?: string; ms?: number };

export type VerbEntry = {
  id: ActVerb;
  rung?: number;
  violent: boolean;
  contact: boolean;
  target: "required" | "none";
  target_kinds: Array<"actor" | "human">;
  gates: { calm_blocks: boolean; consent: string | null; budget: string | null; cooldown: boolean; scenario: string; max_dist: number | null; still: boolean; actor_posture: string[] };
  intensity: { default: number; class: { min: string; max: string } | null };
  timeline: { contact_at_ms: number };
  roles: Partial<Record<"actor" | "target" | "witnesses" | "room", TableStep[]>>;
  owed: { target_ms: number | null; witness_ms: number | null; witness_when: "always" | "never" | "scene_rung_ge_2" | "standalone_only" };
};

export type VerbTable = { constants: Record<string, unknown>; verbs: Record<ActVerb, VerbEntry> };

let cached: VerbTable | undefined;

/** The table as the vendored file has it. Read once. */
export function verbTable(): VerbTable {
  cached ??= JSON.parse(readFileSync(new URL("../../schema/verb-vocab.json", import.meta.url), "utf8")) as VerbTable;
  return cached;
}
