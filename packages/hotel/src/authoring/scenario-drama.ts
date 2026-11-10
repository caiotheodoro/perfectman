import { LADDER_VERBS } from "@perfectman/shared";

/**
 * The scenario `drama` block (docs/drama/act-contract.md section 7). `max_rung` is the highest ladder rung any act in the
 * scenario may reach; `may_target` the ordered pairs that may be the target of a rung 4 or higher act; `may_die` who a
 * `kill` or a standalone `die` may take; `permadeath` whether a killed actor stays gone at the scene cut. Refs are cast
 * names in the authoring form and agent ids (`person-N`) in the compiled body. `@human` is a reserved pseudo-ref: the
 * second element of a pair, or an entry of `may_die`, meaning any human in the room who opted in and answered the chip.
 */
export type ScenarioDrama = {
  max_rung: number;
  may_target: Array<[string, string]>;
  may_die: string[];
  permadeath: boolean;
};

/** What the author writes: every key optional, `max_rung` also as a ladder verb id (`"slap"` means 4), refs by cast name. */
export type ScenarioFormDrama = {
  max_rung?: number | string;
  may_target?: Array<[string, string]>;
  may_die?: string[];
  permadeath?: boolean;
};

export const HUMAN_REF = "@human";

/** No block (free play) and `drama:{}` read the same keys the same way (SCN-1, SCN-2): rungs 1 to 3 between actors, no kills. */
export const FREE_PLAY_DRAMA: ScenarioDrama = { max_rung: 3, may_target: [], may_die: [], permadeath: false };

/**
 * `drama: off` (the scenario's opt-out): no act of any kind is started, proposed or scripted. It is written as the
 * strictest block the hotel already reads (`max_rung` 0: not even a glare) plus the body's `drama_mode: "off"`, which only the sidecar reads
 * and which also shuts the off-ladder acts (cry, hug, storm off). The hotel, which ignores unknown body keys, sees an ordinary restrictive block.
 */
export const DRAMA_OFF: ScenarioDrama = { max_rung: 0, may_target: [], may_die: [], permadeath: false };

/**
 * How far a scene with no `drama` block may go: `glare`, `insult`, `shove` and `slap` (rungs 1 to 4). Never a `punch` or a `kill`, nobody may
 * die, there is no permadeath. Rungs 1 to 3 need no pair, so the ceiling is what makes the pairs below matter: rung 4 is the first that needs
 * `may_target` (SCN-3). This is a conservative product default, not the contract's free play (SCN-1, `max_rung` 3, which cannot slap).
 */
export const DEFAULT_SCENE_MAX_RUNG = 4;

/**
 * The block of a scene that declares none (the conservative default): every ordered pair of its bot actors may be the target of a rung 4 act,
 * `max_rung` is `DEFAULT_SCENE_MAX_RUNG`, nobody may die, there is no permadeath. A human is never in a pair (`@human` is not a ref here: a
 * slap at a person needs a block that says so). With fewer than two actors there is nobody to aim at and no block. It is the same strict shape
 * an author writes, so the sidecar's read (`cleanDrama`) and the hotel's (`parse_block`) take it as it is. An explicit block, even `{}`, or
 * `drama: off`, is never replaced by it: the callers use this only for a scene that wrote no `drama` key.
 */
export function defaultSceneDrama(actorIds: readonly string[]): ScenarioDrama | undefined {
  const ids = [...new Set(actorIds)];
  if (ids.length < 2) return undefined;
  const may_target: Array<[string, string]> = [];
  for (const a of ids) for (const b of ids) if (a !== b) may_target.push([a, b]);
  return { max_rung: DEFAULT_SCENE_MAX_RUNG, may_target, may_die: [], permadeath: false };
}

/** `drama: off` as an author or a body may write it: the word, any case, or `false`. */
export function isDramaOff(raw: unknown): boolean {
  return raw === false || (typeof raw === "string" && raw.trim().toLowerCase() === "off");
}

/** How a body's block came to be, for the run summary: written by the author, derived by `defaultSceneDrama`, or `off`. Absent is free play. */
export type DramaMode = "default" | "off";

export type DramaRow = { path: string; message: string };
export type DramaCompile = { drama?: ScenarioDrama; mode?: "off"; errors: DramaRow[]; warnings: DramaRow[] };

const KEYS = ["max_rung", "may_target", "may_die", "permadeath"] as const;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The ladder verb ids are rungs 1 to 6 in order, so a verb id is its index plus one. */
function rungOf(value: unknown, allowVerb: boolean): number | undefined {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 6 ? value : undefined;
  if (allowVerb && typeof value === "string") {
    const i = (LADDER_VERBS as readonly string[]).indexOf(value);
    return i < 0 ? undefined : i + 1;
  }
  return undefined;
}

/**
 * SCN-5, the form half. `cast` lists the cast names and, index for index, the agent ids they compile to. Errors and
 * warnings are `{path, message}` rows; a warning's message starts with its id (`drama.no_scene_cut`). `sceneCuts` is how
 * many scene cuts the scenario authors: the builder has no way to author one yet, so authoring passes 0 and every
 * scenario that can kill warns (SCN-6).
 */
export function compileDramaForm(raw: unknown, cast: { names: readonly string[]; ids: readonly string[] }, opts: { sceneCuts?: number } = {}): DramaCompile {
  const errors: DramaRow[] = [];
  const warnings: DramaRow[] = [];
  if (isDramaOff(raw)) return { drama: DRAMA_OFF, mode: "off", errors, warnings };
  if (!isRecord(raw)) return { errors: [{ path: "drama", message: 'drama must be an object, or "off"' }], warnings };
  for (const key of Object.keys(raw)) if (!(KEYS as readonly string[]).includes(key)) errors.push({ path: `drama.${key}`, message: `unknown key "${key}"` });

  const idOf = (name: unknown, path: string, allowHuman: boolean, humanHint: string): string | undefined => {
    if (typeof name !== "string") {
      errors.push({ path, message: "a cast name was expected" });
      return undefined;
    }
    if (name === HUMAN_REF) {
      if (allowHuman) return HUMAN_REF;
      errors.push({ path, message: `${HUMAN_REF} ${humanHint}` });
      return undefined;
    }
    const at = cast.names.findIndex((n) => norm(n) === norm(name));
    const id = at < 0 ? undefined : cast.ids[at];
    if (id === undefined) errors.push({ path, message: `"${name}" is not in the cast` });
    return id;
  };

  let max_rung = FREE_PLAY_DRAMA.max_rung;
  if (raw["max_rung"] !== undefined) {
    const rung = rungOf(raw["max_rung"], true);
    if (rung === undefined) errors.push({ path: "drama.max_rung", message: "max_rung must be an integer from 0 to 6 or a ladder verb (glare, insult, shove, slap, punch, kill)" });
    else max_rung = rung;
  }

  const may_target: Array<[string, string]> = [];
  const pairs = raw["may_target"];
  if (pairs !== undefined && !Array.isArray(pairs)) errors.push({ path: "drama.may_target", message: "may_target must be a list of [aggressor, victim] pairs" });
  else if (Array.isArray(pairs)) {
    pairs.forEach((pair: unknown, i) => {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some((p) => typeof p !== "string")) {
        errors.push({ path: `drama.may_target[${i}]`, message: "a may_target entry must be a pair [aggressor, victim] of cast names" });
        return;
      }
      const aggressor = idOf(pair[0], `drama.may_target[${i}][0]`, false, "cannot be an aggressor: only an actor can be");
      const victim = idOf(pair[1], `drama.may_target[${i}][1]`, true, "");
      if (aggressor && victim && !may_target.some(([a, v]) => a === aggressor && v === victim)) may_target.push([aggressor, victim]);
    });
  }

  const may_die: string[] = [];
  const dying = raw["may_die"];
  if (dying !== undefined && !Array.isArray(dying)) errors.push({ path: "drama.may_die", message: "may_die must be a list of cast names" });
  else if (Array.isArray(dying)) {
    dying.forEach((name: unknown, i) => {
      const id = idOf(name, `drama.may_die[${i}]`, true, "");
      if (id && !may_die.includes(id)) may_die.push(id);
    });
  }

  let permadeath = FREE_PLAY_DRAMA.permadeath;
  if (raw["permadeath"] !== undefined) {
    if (typeof raw["permadeath"] === "boolean") permadeath = raw["permadeath"];
    else errors.push({ path: "drama.permadeath", message: "permadeath must be true or false" });
  }

  if (errors.length > 0) return { errors, warnings };
  if (may_die.length > 0 && (opts.sceneCuts ?? 0) === 0) {
    warnings.push({ path: "drama.may_die", message: "drama.no_scene_cut: may_die is not empty but the scenario authors no scene cut, so a body stays until the run ends (SCN-6)" });
  }
  return { drama: { max_rung, may_target, may_die, permadeath }, errors, warnings };
}

/**
 * SCN-5, the body half: the compiled block with agent ids, read strictly. Omitted keys take the defaults (SCN-2). A block that
 * fails (unknown key, `max_rung` that is not an integer 0 to 6, a pair that is not a pair, an id the cast does not have,
 * `@human` as an aggressor, a `permadeath` that is not a boolean) is dropped whole, which is free play: never a looser
 * reading than the author wrote. The hotel does the same with a block it cannot parse.
 */
export function cleanDrama(raw: unknown, agentIds: readonly string[]): { drama?: ScenarioDrama } {
  if (isDramaOff(raw)) return { drama: DRAMA_OFF };
  if (!isRecord(raw) || Object.keys(raw).some((k) => !(KEYS as readonly string[]).includes(k))) return {};
  const known = new Set(agentIds);
  const actor = (v: unknown): v is string => typeof v === "string" && known.has(v);
  const victim = (v: unknown): v is string => v === HUMAN_REF || actor(v);

  const max_rung = raw["max_rung"] === undefined ? FREE_PLAY_DRAMA.max_rung : rungOf(raw["max_rung"], false);
  if (max_rung === undefined) return {};
  const permadeath = raw["permadeath"] === undefined ? FREE_PLAY_DRAMA.permadeath : raw["permadeath"];
  if (typeof permadeath !== "boolean") return {};

  const pairs = raw["may_target"] ?? [];
  const dying = raw["may_die"] ?? [];
  if (!Array.isArray(pairs) || !Array.isArray(dying)) return {};
  const may_target: Array<[string, string]> = [];
  for (const pair of pairs as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2 || !actor(pair[0]) || !victim(pair[1])) return {};
    if (!may_target.some(([a, v]) => a === pair[0] && v === pair[1])) may_target.push([pair[0], pair[1]]);
  }
  const may_die: string[] = [];
  for (const id of dying as unknown[]) {
    if (!victim(id)) return {};
    if (!may_die.includes(id)) may_die.push(id);
  }
  return { drama: { max_rung, may_target, may_die, permadeath } };
}

/**
 * What a run enforces: the block as the body carries it, or free play when there is none (SCN-1). Authored skips need a block, even an empty one (SCN-4).
 * `mode` says where the block came from (`authored` by the scenario, `default` derived at compile, `off`, or `free_play` for a body that has none: one
 * saved before the default existed). `off` shuts the director: nothing is originated, approved or played.
 */
export type RunDrama = { block: ScenarioDrama | undefined; effective: ScenarioDrama; freePlay: boolean; canSkip: boolean; mode: "authored" | "default" | "off" | "free_play"; off: boolean };

export function resolveRunDrama(body: { drama?: ScenarioDrama; drama_mode?: DramaMode }): RunDrama {
  const off = body.drama_mode === "off";
  const block = off ? DRAMA_OFF : body.drama;
  const mode = off ? "off" : block === undefined ? "free_play" : body.drama_mode === "default" ? "default" : "authored";
  return { block, effective: block ?? FREE_PLAY_DRAMA, freePlay: block === undefined, canSkip: block !== undefined && !off, mode, off };
}

/** The run summary's line for the scenario's drama: where the block came from and what it allows. Numbers only, no names (`replay.json` `drama`). */
export type DramaSummary = { source: RunDrama["mode"]; max_rung: number; may_target_pairs: number; may_die: number; permadeath: boolean };

export function summarizeRunDrama(run: RunDrama): DramaSummary {
  return { source: run.mode, max_rung: run.effective.max_rung, may_target_pairs: run.effective.may_target.length, may_die: run.effective.may_die.length, permadeath: run.effective.permadeath };
}

/** A cast member as the compiled scenario names it: the agent id the run's refs use and the name a form would write. */
export type SceneCastMember = { id: string; displayName: string };

/**
 * The `drama` block of a markdown scenario's frontmatter (the presets under `examples/presets/scenes`). A markdown author writes the agent
 * ids the scene's `cast` already uses (`beatriz`), a form's author writes cast names (`Beatriz`); both read the same: an entry that
 * is an agent id is turned into that person's name, then the form's own compile (SCN-5) runs. `sceneCuts` is how many `beats` of the scene
 * cut the scene (SCN-6).
 */
export function compileSceneDrama(raw: unknown, cast: readonly SceneCastMember[], opts: { sceneCuts?: number } = {}): DramaCompile {
  const nameOfId = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    const hit = cast.find((c) => c.id.toLowerCase() === v.trim().toLowerCase());
    return hit ? hit.displayName : v;
  };
  const read = (o: unknown): unknown => {
    if (!isRecord(o)) return o;
    const out: Record<string, unknown> = { ...o };
    if (Array.isArray(o["may_target"])) out["may_target"] = o["may_target"].map((pair) => (Array.isArray(pair) ? pair.map(nameOfId) : pair));
    if (Array.isArray(o["may_die"])) out["may_die"] = o["may_die"].map(nameOfId);
    return out;
  };
  return compileDramaForm(read(raw), { names: cast.map((c) => c.displayName), ids: cast.map((c) => c.id) }, opts);
}
