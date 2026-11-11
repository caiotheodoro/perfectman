import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import type { CineGenre } from "./types.js";

export type ImdbRow = { id: string; type: string; year: number | null; runtimeMin: number | null; genres: string[] };

/** Rows of IMDb's non-commercial `title.basics.tsv.gz` for the wanted ids only ("tt0144117" or "144117"). */
export async function loadImdb(file: string, wanted: ReadonlySet<string>): Promise<Map<string, ImdbRow>> {
  const out = new Map<string, ImdbRow>();
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line.split("\t");
    const id = c[0]!;
    if (!wanted.has(id)) continue;
    out.set(id, { id, type: c[1]!, year: c[5] === "\\N" ? null : Number(c[5]), runtimeMin: c[7] === "\\N" ? null : Number(c[7]), genres: c[8] === "\\N" ? [] : c[8]!.split(",") });
  }
  return out;
}

export const imdbKey = (n: string | number): string => `tt${String(n).replace(/^tt/, "").padStart(7, "0")}`;

const THRILLER = new Set(["Thriller", "Crime", "Mystery", "Horror", "Action", "War", "Western"]);
const DRAMA = new Set(["Drama", "Romance", "Family", "Biography", "History", "Music", "Musical"]);

/** Bucket by IMDb genres: any thriller-type tag wins, then comedy, then drama/melodrama. */
export function genreBucket(genres: readonly string[]): CineGenre {
  if (genres.some((g) => THRILLER.has(g))) return "thriller";
  if (genres.includes("Comedy")) return "comedy";
  if (genres.some((g) => DRAMA.has(g))) return "drama";
  return "other";
}
