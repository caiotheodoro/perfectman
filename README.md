<h1 align="center"><img src="docs/assets/readme-logo.png" alt="" width="72" height="72" align="absmiddle">&nbsp;Perfectman</h1>

<p align="center"><strong>AI personas use attention, emotion, and memory to select when they send messages.</strong></p>

<div align="center">

[![PR Gate](https://img.shields.io/github/actions/workflow/status/caiotheodoro/perfectman/pr-gate.yml?branch=main&style=flat-square&label=PR%20gate&labelColor=0D1117&color=7C6BF0)](https://github.com/caiotheodoro/perfectman/actions/workflows/pr-gate.yml)
[![Benchmark](https://img.shields.io/github/actions/workflow/status/caiotheodoro/perfectman/benchmark.yml?branch=main&style=flat-square&label=benchmark&labelColor=0D1117&color=E8A33D)](https://github.com/caiotheodoro/perfectman/actions/workflows/benchmark.yml)
[![Node](https://img.shields.io/badge/Node-22%2B-7C6BF0?style=flat-square&labelColor=0D1117)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-7C6BF0?style=flat-square&labelColor=0D1117)](LICENSE)
[![Stars](https://img.shields.io/github/stars/caiotheodoro/perfectman?style=flat-square&labelColor=0D1117&color=E8A33D)](https://github.com/caiotheodoro/perfectman/stargazers)

[What this is](#what-this-is) · [Quickstart](#quickstart) · [Run it free](#running-with-a-real-model-for-free) · [Benchmarks](#benchmarks) · [Architecture](#architecture) · [Open questions](#status--open-questions)

**[Install and run →](#quickstart)**

</div>

Perfectman is a social simulation with AI personas in shared chat channels.
Agents do not take fixed turns. Each agent uses an internal model to select an
action or remain silent.

The model uses event visibility, attention, interpretation, motivation, emotion,
pressure, and inhibition. An agent sends a message only when its pressure is
sufficient to overcome its inhibition.

This model can produce delayed messages, private channels, and inferred
exclusion. These behaviors result from the model. The system does not use a
script for each social interaction.

### Highlights

- **Action selection:** A ten-stage pipeline selects an action. The agent can remain silent.
- **Inferred exclusion:** An agent can infer exclusion from the absence of public messages, without an explicit notification.
- **Private channels:** Agents can create private channels through curiosity, gossip, jealousy, secrecy, or relationship repair.
- **Biased memory:** Emotion can change the episodic memory and relationship memory. These memories are not exact event records.
- **Behavior tests:** The reported results cover 123 deterministic scenarios [without a model connection](#benchmarks). CI requires all behavioral signals to pass.

> [!NOTE]
> **Status:** This is an early experiment before version 1.0. The event-oriented
> runtime and social presence engine operate together. Work continues on
> exclusion, masking, grudges, and biased memory. Errors and limitations remain.

## Table of contents

- [What this is](#what-this-is)
- [Quickstart](#quickstart)
- [Turn a saved run into video](#turn-a-saved-run-into-video)
- [Running with a real model, for free](#running-with-a-real-model-for-free)
- [Bring your own personas](#bring-your-own-personas)
- [Benchmarks](#benchmarks)
- [Architecture](#architecture)
- [Status / open questions](#status--open-questions)
- [Releases](#releases)
- [Contributing](#contributing)
- [License](#license)

## What this is

Each agent action goes through this pipeline:

```text
event → visibility → attention → interpretation → motivation
      → emotion → pressure → inhibition → intent → resolver → committed event
```

Any stage can stop an action. Silence is a valid result.

The pipeline supports these behaviors:

| Behavior | What it looks like |
|---|---|
| **Selective attention** | An agent can select a message for attention and then send a message or remain silent. |
| **Private alliance** | An agent can create or enter a private channel through curiosity, gossip, jealousy, secrecy, or relationship repair. |
| **Inferred exclusion** | An agent can infer exclusion from the absence of public messages. |
| **Meaningful lateness** | A delay can change the meaning of a message. |
| **Biased memory** | Emotion can change the memory of an event. |

A rule-based spectator layer uses the committed event log to give a narrative
summary of social changes. This summary does not contain backend metrics.

## Quickstart

The application requires Node.js and [pnpm](https://pnpm.io/).

Install the dependencies. Then build the application:

```bash
pnpm install
pnpm build
```

Create the local configuration directories. Then copy the example configuration:

Git ignores these local configuration paths to protect persona data.

```bash
mkdir -p config/personas config/persona-notes
cp examples/simulations/mock.inline-personas.example.json config/index.json
```

Start the simulation:

```bash
pnpm --filter @perfectman/server simulation
```

The default configuration uses `providerType: "mock"`. This simulation does not
require an API key or a model.

## Turn a saved run into video

Use an existing transcript, replay, or script to create a local MP4 and an
interactive story viewer with channels, private conversations, and music:

```sh
pnpm video --input docs/eval/evidence/deepseek/scenarios/v1_exclusion_inferred.json --out out/exclusion.mp4
```

The command keeps source order and recorded emotion data. It requires FFmpeg
and a completed build. See [video inputs and usage](docs/video/README.md).

## Running with a real model, for free

These options do not require a paid API key.

<details>
<summary><strong>Native Ollama</strong> — recommended on macOS / Apple Silicon</summary>

Docker Desktop does not support GPU passthrough on macOS. The reported speed is
approximately 1.2–1.5 tokens per second with Docker on the CPU. The reported
speed with native Metal is approximately 40 tokens per second.

Install Ollama directly on macOS. Then download the model. Start the server:

```bash
brew install ollama        # or download from https://ollama.com
ollama pull qwen3:1.7b
ollama serve               # API on :11434
```

Copy `examples/simulations/qwen3-local.example.json` to `config/index.json`.
</details>

<details>
<summary><strong>Local Qwen3 via Docker</strong> — Linux with an NVIDIA GPU</summary>

```bash
pnpm qwen:dev              # pulls qwen3:1.7b, portable CPU-safe default
# or: pnpm qwen:dev:8b for the 8B model
```

If your machine has an NVIDIA driver, enable GPU passthrough with this command:

```bash
docker compose -f docker/qwen3/qwen3.compose.yml \
               -f docker/qwen3/qwen3.gpu.compose.yml up -d
```
</details>

<details>
<summary><strong>FreeLLMAPI</strong> — one proxy for free-tier provider keys</summary>

```bash
cp .env.example .env   # set FREELLMAPI_ENCRYPTION_KEY
pnpm freellm:dev       # API on :3001, dashboard on :5173
```

Add the provider keys in the dashboard. Create a unified key in the dashboard.
Set `FREELLMAPI_KEY` in `.env`.
</details>

<details>
<summary><strong>Simulation in Docker</strong> — local Node.js and pnpm are not necessary</summary>

```bash
mkdir -p config
cp examples/simulations/mock.inline-personas.example.json config/index.json
docker compose -f docker/app/app.compose.yml up --build
```

The first Compose file determines the base directory for relative paths. Keep
`docker/app/app.compose.yml` first so that these paths use `docker/app/`.

If Ollama runs in the same Compose project, set the provider `baseURL` to
`http://qwen3:11434/v1`. This address uses container DNS. A localhost address
refers to the simulation container itself.

Start the services. Then display the simulation log:

```bash
docker compose -f docker/app/app.compose.yml \
               -f docker/qwen3/qwen3.compose.yml up -d
docker compose -f docker/app/app.compose.yml \
               -f docker/qwen3/qwen3.compose.yml logs -f simulation
```

For a real provider, give the container read-only access to the `.env` file that
the CLI uses:

```bash
docker compose -f docker/app/app.compose.yml run --rm \
  -v "$PWD/.env:/app/.env:ro" simulation
```
</details>

## Bring your own personas

See [`docs/personas/README.md`](docs/personas/README.md) for the persona interview
and compilation procedure. The local persona paths under `config/` and
`docs/personas/` contain person-specific files. Git ignores these paths. Generic
instructions and templates remain in the repository.

## Benchmarks

The benchmark suite tests the behaviors above. It uses a mock provider and a
rule judge. It does not require an API key or a model server.

Run the benchmark suite. Then check the CI acceptance criteria:

```bash
pnpm --filter @perfectman/eval bench --mode mock --judge rule --out out/bench.json
node scripts/ci/check-bench-gate.mjs out/bench.json
```

**Reported scenario results:** 123 deterministic scenario runs cover five
behavioral categories. These figures describe the existing benchmark report.
They are not results from a new test run.

| Category | Runs | Signal pass rate |
|---|---:|---:|
| `motive_archetype` | 51 | 100% |
| `v1_behavior` | 27 | 100% |
| `stagnation_attractor` | 18 | 100% |
| `calibration` | 15 | 100% |
| `edge_chaos` | 12 | 100% |
| **Total** | **123** | **100%** |

**Reported behavioral signals:** 276 assertions check the actions of the social
engine. These assertions do not assess the quality of generated text.

| Signal | Passed | Rate |
|---|---:|---:|
| `no_llm_failures` | 123 / 123 | 100% |
| `event_committed` | 75 / 75 | 100% |
| `private_channel_created` | 48 / 48 | 100% |
| `emotion_rises` | 15 / 15 | 100% |
| `emotion_stays` | 15 / 15 | 100% |

No scenario runs failed in the report. The mean result for **runtime probes**
is **91.0%**. The lowest results are `content-repetition` (21.1%) and
`memory-write` (70.7%). CI records these results for comparison but does not use
them as acceptance criteria.

<a id="what-is-and-isnt-gated"></a>

### CI acceptance criteria

| Layer | Result | Gated in CI? |
|---|---|---|
| **Behavioral signals** | 100% | Yes. All signals must pass. |
| **Runtime probes** | 91.0% | No. CI records these results for comparison. |
| **Judge axis scores** | 6 of 8 targets met | No. These scores are advisory. |

> [!IMPORTANT]
> CI does not use judge axis scores as acceptance criteria. The rule judge has
> not met its calibration target. Cohen's κ against the golden-labeled set is
> **0.219 against a target of 0.7** (n=39). These scores permit comparisons, but
> they are not evidence of qualitative accuracy.
>
> The reported scores for `in_character` (2.99 / 4.0) and `voice_match`
> (1.16 / 3.8) are below target. The largest disagreement with the golden labels
> occurs on `voice_match`.

All reported deterministic behavioral signals passed. The qualitative scores
are not sufficiently reliable. Judge calibration remains
[open work](#status--open-questions).

The reported unit and hygiene suite contains **1,426 tests across 126 files**.
The recorded run passed on Node 22.

Check the types. Then run the unit tests and hygiene checks:

```bash
pnpm lint       # typecheck, all four packages
pnpm test:all   # unit tests + hygiene gates
```

## Architecture

The full design is in [`docs/README.md`](docs/README.md). It contains the
authoritative architecture, the emotion model, the social presence engine, and
open design questions.

The main layers have these responsibilities:

| Layer | Responsibility |
|---|---|
| **Event-oriented runtime** (`packages/server`) | It contains the append-only event log, command handlers, and intent resolver. It creates delivery, spectator, operator, and engine snapshot projections. It supports Socket.IO, Discord, stdout, and mock transports. |
| **Social presence engine** (`packages/engine`) | It calculates attention, motivation, emotion, pressure, and inhibition without I/O. |
| **Agent mind** (`packages/server/src/agent`) | It contains persona identity, writing style, and relationship beliefs. Its LLM runtime converts perception into intent. |
| **Evaluation harness** (`packages/eval`) | It contains the scenario registry, rule and LLM judges, probes, calibration, and narration. |
| **Continuity system** | It contains episodic memory, relationship memory, emotional drift, and rumination. Emotion can change the memory. |

## Status / open questions

This is an active experiment. It is not a completed product.

The [open design questions](docs/README.md#current-open-questions) include:

- What can spectators see from private channels?
- How much scoring logic does the system need?
- Which symbolic actions must the system keep?
- How can judge calibration meet its target?

Contributors can start with these questions.

## Releases

For each tagged release (`v*`), `docker-release.yml` publishes a runtime container
image to GHCR at `ghcr.io/caiotheodoro/perfectman`. The image tag omits the initial
`v`. For example, release `v0.1.0` produces image tag `0.1.0`. Releases that are
not prereleases also update `latest`.

Download the latest release image:

```bash
docker pull ghcr.io/caiotheodoro/perfectman:latest
```

For reproducible runs, use a release-specific image tag instead of `latest`.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Issues with the `good first issue` label
have a limited scope. You do not need to read the full architecture document to
start these issues.

## Star history

<a href="https://star-history.com/#caiotheodoro/perfectman&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=caiotheodoro/perfectman&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=caiotheodoro/perfectman&type=Date" />
    <img alt="Star history chart for caiotheodoro/perfectman" src="https://api.star-history.com/svg?repos=caiotheodoro/perfectman&type=Date" width="600" />
  </picture>
</a>

## License

[MIT](LICENSE)
