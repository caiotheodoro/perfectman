# Perfectman

AI personas that hang out in a socket chat server like people do: noticing unevenly, replying late, lurking, masking, forming private alliances, misreading silence — and creating real, emergent social drama nobody scripted.

> <!-- TODO before sharing publicly: replace this with a spectator-view transcript or short GIF of an actual emergent moment (exclusion, grudge, private alliance) captured from a real run. See docs/README.md "V1 Target Behaviors" for what to look for. -->
> **Status:** early, pre-1.0 experiment. The core event-oriented runtime and social presence engine work end-to-end; the interesting behaviors (exclusion, masking, grudges, biased memory) are what we're actively tuning for. Expect rough edges.

## What this is

Most "AI agent chat" demos are agents replying because it's their turn. Perfectman agents act because something caught their attention, produced motivation and emotion, and built up enough pressure to overcome inhibition:

```text
event -> visibility -> attention -> interpretation -> motivation -> emotion -> pressure -> inhibition -> intent -> resolver -> committed event
```

Concretely, that pipeline is what lets an agent:

- Notice a mention and reply, or notice a message and deliberately not reply.
- Create or enter a private channel out of curiosity, gossip, jealousy, secrecy, or repair.
- Infer exclusion from public silence — nobody told it, it just wasn't invited.
- Reply late in a way that changes what the reply means.
- Store a biased, emotionally-colored memory instead of a perfect log.

A rule-based spectator layer turns the committed event log into a narrative recap of the hidden social shifts, without leaking backend metrics into the story.

## Quickstart

Requires Node.js and [pnpm](https://pnpm.io/).

```bash
pnpm install
pnpm build
```

Set up a local simulation config (kept out of git so personas stay private):

```bash
mkdir -p config/personas config/persona-notes
cp examples/simulations/mock.inline-personas.example.json config/index.json
```

Run it:

```bash
pnpm --filter @perfectman/server simulation
```

This uses `providerType: "mock"` by default — no API key or model needed to see the runtime work.

### Running with a real model, for free

You don't need a paid API key. Two free local options:

**Local Qwen3 via Ollama** (recommended if you have a GPU, works on CPU too):

```bash
pnpm qwen:dev          # pulls qwen3:1.7b, exposes an OpenAI-compatible API on :11434
# or: pnpm qwen:dev:8b for the 8B model
```

Then point `config/index.json` at `examples/simulations/qwen3-local.example.json`.

**FreeLLMAPI** (unified proxy for aggregating free-tier provider keys):

```bash
cp .env.example .env   # set FREELLMAPI_ENCRYPTION_KEY
pnpm freellm:dev        # API on :3001, dashboard on :5173
```

Add provider keys and create a unified key via the dashboard, then set `FREELLMAPI_KEY` in `.env`.

### Bring your own personas

See [`docs/personas/README.md`](docs/personas/README.md) for the plug-and-play persona interview/compile workflow. Real, person-specific persona files live under `config/` and `docs/personas/`, both gitignored — nothing personal gets committed.

## Architecture

The full design lives in [`docs/README.md`](docs/README.md) — start there for the canonical architecture, the emotion model, social presence engine, and open design questions. Short version:

- **Event-oriented runtime** (`packages/server`): canonical append-only event log, command handlers, intent resolver, per-audience projections (delivery, spectator, operator, engine snapshot), pluggable transports (Socket.IO, Discord, stdout, mock).
- **Social presence engine** (`packages/engine`): pure, I/O-free attention/motivation/emotion/pressure/inhibition model — the behavioral core.
- **Agent mind** (`packages/server/src/agent`): persona identity, writing style, relationship beliefs, and the LLM-backed runtime that turns perception into an action intent.
- **Continuity system**: episodic + relationship memory, emotional drift, rumination — memory is biased and emotional on purpose, not a perfect log.

## Status / open questions

This is an active experiment, not a finished product. See [`docs/README.md`](docs/README.md#current-open-questions) for what's genuinely undecided — private-channel spectator visibility, how much scoring machinery should exist, which symbolic actions are worth keeping. If one of those interests you, that's a good place to start.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Issues tagged `good first issue` are scoped entry points that don't require reading the full architecture doc first.

## License

[MIT](LICENSE)
