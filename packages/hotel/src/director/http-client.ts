export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class HotelHttpError extends Error {
  constructor(readonly status: number, readonly path: string, message: string) {
    super(`${status} ${path}: ${message}`);
    this.name = "HotelHttpError";
  }
}

export type HotelHttpOptions = {
  baseUrl: string;
  secret: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Extra attempts for idempotent calls (GET, PUT). */
  retries?: number;
};

export type ArtifactRegistration = {
  events?: string;
  director?: string;
  replay?: string;
  [key: string]: string | undefined;
};

/**
 * The hotel's internal HTTP surface (director-protocol.md 11.1), Bearer
 * `PERFECTMAN_SECRET`. Run rows are hotel-owned; counters travel in
 * `run_status`, not here.
 */
export class HotelHttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(private readonly opts: HotelHttpOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retries = opts.retries ?? 2;
  }

  /** The compiled scenario body, immutable per version. */
  getScenarioVersion(id: number): Promise<unknown> {
    return this.request("GET", `/internal/v1/scenario-versions/${id}`);
  }

  getScenario(id: number): Promise<unknown> {
    return this.request("GET", `/internal/v1/scenarios/${id}`);
  }

  createScenario(body: { preset: string; title: string; language: string; source: string; body: unknown }): Promise<unknown> {
    return this.request("POST", "/internal/v1/scenarios", body);
  }

  getMemory(scenario: number, users: number[]): Promise<unknown> {
    return this.request("GET", `/internal/v1/memory?scenario=${scenario}&users=${users.join(",")}`);
  }

  putMemory(scenario: number, user: number, character: string, body: unknown): Promise<unknown> {
    return this.request("PUT", `/internal/v1/memory/${scenario}/${user}/${encodeURIComponent(character)}`, body);
  }

  registerArtifacts(run: number, artifacts: ArtifactRegistration): Promise<unknown> {
    return this.request("POST", `/internal/v1/runs/${run}/artifacts`, artifacts);
  }

  getFigures(): Promise<unknown> {
    return this.request("GET", "/internal/v1/figures");
  }

  private async request(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<unknown> {
    const attempts = method === "POST" ? 1 : this.retries + 1;
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/+$/, "")}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.opts.secret}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.status >= 500 && i < attempts - 1) {
          last = new HotelHttpError(res.status, path, "server error");
          continue;
        }
        if (!res.ok) throw new HotelHttpError(res.status, path, (await res.text()).slice(0, 200));
        const text = await res.text();
        return text ? (JSON.parse(text) as unknown) : null;
      } catch (err) {
        if (err instanceof HotelHttpError && err.status < 500) throw err;
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }
}
