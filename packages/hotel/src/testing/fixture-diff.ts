import type { HotelRow } from "./hotel-fixtures.js";

/**
 * What the two fixture sets say, compared without caring how each one stages its world. P1 wrote its rows from the spec with a
 * prose `given`; the hotel wrote its own with a structured one, so a row is identified by what it pins, not by where it is.
 * Test support only.
 */

/** The answer a row pins, e.g. `act_done blocked/no_scenario_gate/free_play`, `actor_error bad_message/act.intensity`. */
export function outcomeSignature(row: Pick<HotelRow, "expect">): string {
  const f = row.expect[0] ?? {};
  const kind = String(f["t"]);
  const code = kind === "act_done" ? `${String(f["outcome"])}/${String(f["reason"])}` : String(f["code"]);
  return [kind, [code, f["detail"]].filter((x) => x !== undefined).join("/")].join(" ");
}

export const signatures = (rows: readonly Pick<HotelRow, "expect">[]): string[] => [...new Set(rows.map(outcomeSignature))].sort();

export type SignatureDiff = { onlyP1: string[]; onlyHotel: string[]; both: string[] };

export function diffSignatures(p1: readonly string[], hotel: readonly string[]): SignatureDiff {
  return { onlyP1: p1.filter((s) => !hotel.includes(s)), onlyHotel: hotel.filter((s) => !p1.includes(s)), both: p1.filter((s) => hotel.includes(s)) };
}

/** The command of a row without its id, its `k` and its default origin: what the sidecar asked for, in a form two files can share. */
export function commandKey(row: Pick<HotelRow, "in">): string {
  const frame = row.in ?? {};
  const { act_id: _id, k: _k, ...cmd } = (frame["cmd"] ?? {}) as Record<string, unknown>;
  return JSON.stringify({ cmd: { origin: "director", ...cmd }, run: frame["run"], lease: frame["lease"], actor: frame["actor"] }, (_key, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

/** Every leaf that differs between two JSON values, as `path: left -> right` (a missing side reads `(absent)`). */
export function diffPaths(left: unknown, right: unknown, path = ""): string[] {
  const here = path === "" ? "/" : path;
  if (left === right) return [];
  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObj(left) && isObj(right)) {
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((k) => {
      if (!(k in left)) return [`${path}/${k}: (absent) -> ${JSON.stringify(right[k])}`];
      if (!(k in right)) return [`${path}/${k}: ${JSON.stringify(left[k])} -> (absent)`];
      return diffPaths(left[k], right[k], `${path}/${k}`);
    });
  }
  if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) return left.flatMap((v, i) => diffPaths(v, right[i], `${path}/${i}`));
  return JSON.stringify(left) === JSON.stringify(right) ? [] : [`${here}: ${JSON.stringify(left)} -> ${JSON.stringify(right)}`];
}
