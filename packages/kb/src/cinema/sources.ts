import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ProvenanceRow } from "./pipeline.js";

/**
 * `cinema-sources.json`: where every source came from. Provenance only (url, licence or terms note, fetch date, ids, counts); no text of any
 * work, no title text beyond a manifest's catalogue title. Raw text and cue files sit in the gitignored `corpus/` and are never committed.
 */

const OWNER_NOTE = "Local analysis only. Raw text of copyrighted works stays in gitignored packages/kb/corpus; only numbers derived from it are committed. The owner authorised local analysis and local embeddings of copyrighted material.";

type GroupMeta = { name: string; kind: string; url: string; licence: string; robots: string; fetched: string; method: string; lang: string; medium: string; form: string };

export const GROUP_META: Record<string, GroupMeta> = {
  moviesum: {
    name: "MovieSum (2,200 film screenplays, XML-structured, from IMSDb)", kind: "screenplay dataset", url: "https://huggingface.co/datasets/rohitsaxena/MovieSum",
    licence: "Dataset card: CC BY-NC 4.0 (Saxena and Keller, ACL Findings 2024). The screenplays are third-party copyrighted works; non-commercial local analysis only.",
    robots: "huggingface.co/robots.txt allows crawling (User-agent: * Allow: /).", fetched: "2026-11-11", method: "3 jsonl files (train, val, test) downloaded once; IMDb ids in the dataset", lang: "en", medium: "film", form: "screenplay",
  },
  summscreen: {
    name: "SummScreen, ForeverDreaming split (4,348 TV episode transcripts)", kind: "TV transcript dataset", url: "https://huggingface.co/datasets/YuanPJ/summ_screen",
    licence: "The HF mirror carries no licence field. Source transcripts are fan-written on transcripts.foreverdreaming.org (robots.txt: Allow /). The shows are third-party copyrighted works; local analysis only.",
    robots: "huggingface.co allows crawling; foreverdreaming.org robots.txt: User-agent * Allow /.", fetched: "2026-11-11", method: "fd_train, fd_dev, fd_test json files downloaded once", lang: "en", medium: "series", form: "transcript",
  },
  tms: {
    name: "SummScreen, TVMegaSite split (soap-opera transcripts with scene breaks; dev, test and every 6th train episode)", kind: "TV transcript dataset", url: "https://huggingface.co/datasets/YuanPJ/summ_screen",
    licence: "As summscreen. Soap operas (All My Children, As the World Turns, Bold and Beautiful, Days of Our Lives, General Hospital, Guiding Light, One Life to Live, Passions, Port Charles, Young and Restless) are third-party copyrighted works; local analysis only.",
    robots: "huggingface.co allows crawling.", fetched: "2026-11-11", method: "tms_train, tms_dev, tms_test json files downloaded once and converted to jsonl locally", lang: "en", medium: "series", form: "transcript",
  },
  "opus-ptbr": {
    name: "OPUS OpenSubtitles v2018 raw XML, pt_br, random sample of files", kind: "subtitle files (cue times)", url: "https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/raw/pt_br.zip",
    licence: "OPUS OpenSubtitles (Lison and Tiedemann, LREC 2016), a research redistribution of opensubtitles.org subtitles; subtitle text is third-party copyrighted. Local analysis only; cue times and text never committed.",
    robots: "opus.nlpl.eu/robots.txt disallows only its own /opus/*.zip|gz|tar paths on that host; the files were read from object.pouta.csc.fi (CSC object storage) by HTTP range requests (0.15 s apart), not from the disallowed paths.",
    fetched: "2026-11-11", method: "zip central directory read by range request, files drawn at random (seeds 11, 21, 31), one file kept per IMDb title, IMDb type movie/tvMovie/video/tvEpisode/tvSeries/tvMiniSeries, span within 40-115% of IMDb runtime", lang: "pt", medium: "film+series", form: "subtitle",
  },
  "opus-ptbr-native": {
    name: "OPUS OpenSubtitles v2018 raw XML, pt_br, only titles whose original title is Brazilian (IMDb akas region BR, original title; episodes of such series)", kind: "subtitle files (cue times)", url: "https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/raw/pt_br.zip",
    licence: "As opus-ptbr.", robots: "As opus-ptbr; selection by the IMDb allow-list in scripts/cinema/build_native_ids.py (IMDb non-commercial title.akas and title.episode).",
    fetched: "2026-11-11", method: "as opus-ptbr, seed 41, restricted to the allow-list; native Portuguese dialogue, not translations", lang: "pt", medium: "film+series", form: "subtitle",
  },
  "opus-en": {
    name: "OPUS OpenSubtitles v2018 raw XML, en, random sample of files", kind: "subtitle files (cue times)", url: "https://object.pouta.csc.fi/OPUS-OpenSubtitles/v2018/raw/en.zip",
    licence: "As opus-ptbr.", robots: "As opus-ptbr.", fetched: "2026-11-11", method: "as opus-ptbr, seed 12", lang: "en", medium: "film+series", form: "subtitle",
  },
  extra: {
    name: "Brazilian pilot screenplays published as annexes of undergraduate theses (pdftotext -layout)", kind: "screenplay (PDF)", url: "see entries",
    licence: "Institutional repository open-access items; the scripts belong to their authors. Local analysis only.", robots: "Each repository's robots.txt was not violated; single file fetches 3 s apart.", fetched: "2026-11-11", method: "PDF downloaded once, text extracted locally", lang: "pt", medium: "series", form: "screenplay",
  },
};

export const ATTEMPTED_NOT_USED = [
  { what: "Plinio Marcos, Obras teatrais vols 1-6 (Funarte PDFs)", url: "https://portaltainacan.funarte.gov.br/", outcome: "host did not resolve in DNS from the build machine on 2026-11-11 and has no Wayback copy; nothing fetched. Still a good modern pt-BR stage source if it comes back (author died 1999, in copyright, local analysis only)." },
  { what: "Nelson Rodrigues, Teatro completo", url: "n/a", outcome: "no free full-text copy found on a publicly reachable, non-piracy site; not fetched." },
  { what: "IMSDb, SimplyScripts, Daily Script and other script sites", url: "https://imsdb.com", outcome: "not crawled: MovieSum already contains 2,200 IMSDb-derived, XML-structured screenplays, so no site was hit. robots.txt of simplyscripts.com and dailyscript.com permit crawling; imsdb.com serves no robots.txt." },
  { what: "Cornell Movie-Dialogs, ScriptBase", url: "https://huggingface.co/datasets", outcome: "not used: dialogue only (no directions, no cue times), nothing that MovieSum, SummScreen and subtitles do not already give." },
  { what: "DraCor", url: "https://dracor.org", outcome: "searched: no Brazilian or Portuguese corpus. Not used." },
  { what: "Brazilian university repository PDFs of other pilot scripts (UnB, Aracati culture map)", url: "n/a", outcome: "TLS certificate verification failed on those hosts; verification was not bypassed, so they were not fetched. One thesis (UFPE) held no scene headings and was skipped." },
  { what: "Portuguese-language open datasets of telenovela or Brazilian film scripts on Hugging Face", url: "https://huggingface.co/datasets", outcome: "searched with several queries (roteiro, novela, telenovela, pt-br dialogue): no script dataset found." },
];

type Manifest = Array<{ file: string; title?: string; author?: string; source_url?: string; license_line?: string; license_class?: string; retrieved?: string; language?: string; author_death_year?: number | null }>;

export function buildSources(opts: { corpus: string; provenance: ProvenanceRow[]; built?: string; stats: { byGroup: Record<string, { sources: number; scenes: number }>; skipped: Record<string, number> } }): Record<string, unknown> {
  const groups: Record<string, unknown>[] = [];
  const by = new Map<string, ProvenanceRow[]>();
  for (const p of opts.provenance) { let a = by.get(p.group); if (!a) by.set(p.group, (a = [])); a.push(p); }
  // stage texts: one entry per file, from the manifests
  const plays: Record<string, unknown>[] = [];
  const parsed = new Set((by.get("plays") ?? []).map((p) => p.id));
  for (const d of ["gutenberg-shakespeare", "gutenberg-plays", "gutenberg-plays-2", "pt-plays", "pt-plays-extra", "pt-plays-wikisource"]) {
    const mf = path.join(opts.corpus, d, "manifest.json");
    if (!existsSync(mf)) continue;
    for (const e of JSON.parse(readFileSync(mf, "utf8")) as Manifest) {
      const id = `${d}/${e.file.replace(/\.[^.]+$/, "")}`;
      const n = (by.get("plays") ?? []).find((p) => p.id === id)?.scenes ?? 0;
      plays.push({ id, title: e.title, author: e.author, lang: e.language, url: e.source_url, licence_class: e.license_class, licence_line: e.license_line, retrieved: e.retrieved, scenes: n, parsed: parsed.has(id) });
    }
  }
  groups.push({
    id: "plays", name: "Public-domain and CC BY-SA stage plays (Project Gutenberg, pt.wikisource)", kind: "stage text", lang: "en+pt", medium: "stage", form: "play",
    licence: "Per entry: public-domain-us (Project Gutenberg Licence, header kept) or cc-by-sa (pt.wikisource CC BY-SA 4.0). Raw text kept local like the rest.", robots: "gutenberg.org /cache/epub files fetched singly, 3 s apart; pt.wikisource through the MediaWiki API at 5 s spacing with back-off on HTTP 429.",
    fetched: "2026-11-09 and 2026-11-11", counts: opts.stats.byGroup["plays"] ?? { sources: 0, scenes: 0 }, entries: plays,
  });
  for (const [id, meta] of Object.entries(GROUP_META)) {
    const rows = by.get(id) ?? [];
    groups.push({ id, ...meta, counts: opts.stats.byGroup[id] ?? { sources: 0, scenes: 0 }, ...(id === "extra" ? { entries: rows.map((r) => ({ id: r.id, title: r.title, lang: r.lang, scenes: r.scenes })) } : { ids: rows.map((r) => (r.imdb ? `${r.id.replace(/^[^/]+\//, "")}` : r.id.replace(/^[^/]+\//, ""))) }) });
  }
  return {
    format: "perfectman-cinema-sources", version: 1, ...(opts.built ? { built: opts.built } : {}), policy: OWNER_NOTE,
    imdb: { name: "IMDb non-commercial datasets: title.basics.tsv.gz", url: "https://datasets.imdbws.com/title.basics.tsv.gz", terms: "IMDb Non-Commercial Datasets: personal and non-commercial use; used for title type, running time and genres only.", fetched: "2026-11-11" },
    groups, skippedAtSource: opts.stats.skipped, attemptedNotUsed: ATTEMPTED_NOT_USED,
  };
}
