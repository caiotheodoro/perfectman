import { createHash } from "node:crypto";

/**
 * Embedders. `hash` is a deterministic feature-hashing bag of words: no model, no download, used by the tests and as a keyword-ish
 * fallback. `transformers` runs a multilingual model locally through @huggingface/transformers (optional dependency): nothing leaves
 * the machine. Vectors are L2-normalised, so a dot product is the cosine.
 */
export interface Embedder {
  readonly id: string;
  readonly dim: number;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

function normalise(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) / n;
  return v;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

const STOP = new Set(["the", "a", "an", "and", "of", "to", "in", "is", "it", "you", "i", "my", "me", "o", "a", "e", "de", "que", "um", "uma", "do", "da"]);

export class HashEmbedder implements Embedder {
  readonly id = "hash-256-v1";
  readonly dim = 256;
  private vec(text: string): Float32Array {
    const v = new Float32Array(this.dim);
    for (const tok of text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/)) {
      if (tok.length < 2 || STOP.has(tok)) continue;
      const h = createHash("sha1").update(tok).digest();
      const idx = h.readUInt16BE(0) % this.dim;
      v[idx] = (v[idx] as number) + (h[2] as number & 1 ? 1 : -1);
    }
    return normalise(v);
  }
  async embedDocuments(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.vec(t));
  }
  async embedQuery(text: string): Promise<Float32Array> {
    return this.vec(text);
  }
}

type Extractor = (input: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

/** multilingual-e5-small: 384 dimensions, English and Portuguese. e5 wants "passage: " and "query: " prefixes. */
export class TransformersEmbedder implements Embedder {
  readonly dim = 384;
  private extractor: Promise<Extractor> | undefined;
  constructor(readonly model = "Xenova/multilingual-e5-small", private readonly batch = 16) {}
  get id(): string {
    return `transformers:${this.model}:q8`;
  }
  private load(): Promise<Extractor> {
    this.extractor ??= (async () => {
      const name = "@huggingface/transformers";
      const mod = (await import(name)) as { pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<Extractor> };
      return mod.pipeline("feature-extraction", this.model, { dtype: "q8" });
    })();
    return this.extractor;
  }
  private async run(texts: string[]): Promise<Float32Array[]> {
    const ex = await this.load();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batch) {
      const res = await ex(texts.slice(i, i + this.batch), { pooling: "mean", normalize: true });
      for (const row of res.tolist()) out.push(Float32Array.from(row));
    }
    return out;
  }
  embedDocuments(texts: string[]): Promise<Float32Array[]> {
    return this.run(texts.map((t) => `passage: ${t}`));
  }
  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.run([`query: ${text}`]))[0] as Float32Array;
  }
}

export function makeEmbedder(kind: "hash" | "transformers", model?: string): Embedder {
  return kind === "hash" ? new HashEmbedder() : new TransformersEmbedder(model);
}
