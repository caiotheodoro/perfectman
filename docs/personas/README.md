# Persona Setup

This folder contains versioned, generic instructions for turning real friend-group interviews into Perfectman persona config. Do not commit real person data here.

## Local-only paths

Use these paths for private/person-specific material:

```text
config/persona-setup.local.json        # local questionnaire/setup plan
config/personas/<agent-id>.persona.json # runtime persona + prompt profile loaded by config/index.json
config/persona-notes/<agent-id>/        # raw or synthesized questionnaire notes
docs/personas/<agent-id>/               # optional local working docs if you prefer docs-style notes
```

These paths are gitignored. Versioned examples live in `examples/` and templates live in `docs/personas/templates/`.

## Current git tree notes

The repository is intentionally split into versioned setup material and local private material:

- Versioned: `docs/personas/README.md`, `docs/personas/templates/`, `docs/notes/persona-assessment-canonical.md`, and fake examples in `examples/`.
- Local-only: `docs/personas/<agent-id>/`, `config/persona-notes/`, `config/personas/`, `config/persona-setup.local.json`, local questionnaire agent files, and generated `docs/persona-*.html` questionnaire exports.
- If `git status --ignored --short docs/personas config` shows `!! docs/personas/` or `!! config/`, that is expected when private local persona material exists.
- If plain `git status --short` shows real-person files under `docs/personas/<agent-id>/` or `config/personas/`, stop and fix `.gitignore` before committing.
- Existing local friend/persona subfolders under `docs/personas/<agent-id>/` are ignored persona packs. Keep them local-only and do not name real people in versioned docs.

## Plug-and-play workflow

1. Copy `examples/personas/setup/persona-setup.config.example.json` to `config/persona-setup.local.json` and replace fake names with your friend group.
2. Optional but recommended: use the local-only helper prompt at `docs/personas/local-questionnaire-agent.md` to guide the interview and synthesis work. This file is intentionally local-only; if it is missing, recreate it from the section below.
3. Run interviews using `docs/notes/persona-assessment-canonical.md` as the source questionnaire.
4. Save raw notes locally under `config/persona-notes/<agent-id>/` or `docs/personas/<agent-id>/`.
5. Compile each person into a local runtime file by copying `examples/personas/compiled/example-friend.persona.example.json` to `config/personas/<agent-id>.persona.json`.
6. Copy `examples/simulations/mock.persona-file.example.json` to `config/index.json` and set each agent's `personaFile` to `personas/<agent-id>.persona.json`.
7. Make sure each channel in `config/index.json` includes the right `memberAgentIds`.
8. Run:

```bash
pnpm --filter @perfectman/server simulation
```

`personaFile` paths are resolved relative to the simulation config file, so `personas/example-friend.persona.json` inside `config/index.json` points to `config/personas/example-friend.persona.json`.

Before committing, verify local persona material is ignored:

```bash
git check-ignore -v \
  config/persona-setup.local.json \
  config/personas/example-friend.persona.json \
  config/persona-notes/example-friend/raw.md \
  docs/personas/example-friend/README.md \
  docs/personas/local-questionnaire-agent.md
```

## Local questionnaire agent file

`docs/personas/local-questionnaire-agent.md` is a local-only helper file for running persona questionnaire setup with an AI agent. It tells the agent what to read, where to write notes, how to sanitize sensitive answers, and how to compile `config/personas/<agent-id>.persona.json`.

Because it is local-only, recreate it from this section if needed:

1. Read this README, the canonical questionnaire, the notes template, and the persona examples.
2. Interview for behavioral patterns, not gossip.
3. Save real notes only under gitignored local paths.
4. Compile safe summaries into `config/personas/<agent-id>.persona.json`.
5. Wire that file into `config/index.json` through `agents[].personaFile`.

## Runtime architecture

Versioned code ships only a generic fallback prompt profile and fake examples. Real friend personas are not registered in `packages/server/src/agent/persona-prompt-profile.ts`.

At runtime, prefer this path:

```text
config/index.json
  agents[].personaFile -> config/personas/<agent-id>.persona.json
    persona            -> runtime identity fields
    promptProfile      -> LLM behavior/persona prompt fields
```

Inline `persona` + `promptProfile` in `config/index.json` still works for quick local experiments, but `personaFile` is the recommended plug-and-play path because it keeps each person in a separate local file.

## What never goes in git

- Real names, if your group expects aliases.
- Raw interview answers.
- Private stories, screenshots, DMs, secrets, or sensitive examples.
- Compiled prompt profiles for real people.
- Local `config/index.json`, `config/persona-setup.local.json`, and `config/personas/*.persona.json`.

Commit only generic questionnaires, fake examples, and reusable instructions.

## Interview agent instructions

Use this as the system/task brief for an AI agent helping collect persona material:

```text
You are helping set up a Perfectman persona for a private friend-group simulation.

Use the questionnaire in docs/notes/persona-assessment-canonical.md. Keep the interview casual and concrete. Ask for examples of how the person behaves in real life and in group chat, but do not ask for secrets, screenshots, passwords, medical/legal/financial data, or invasive private details.

For each answer, capture behavioral patterns, not gossip. Paraphrase sensitive examples. Mark anything risky as exclude_from_prompt. If the user gives real names, preserve them only in local notes if they explicitly allow it; otherwise use aliases.

Output a local-only synthesis with these sections:
- target agent id and display name
- source interviews used
- essence in 3-5 bullets
- values and motivations
- social presence and attention patterns
- emotional/conflict patterns
- public/private differences
- relationship-specific biases
- voice guidelines
- 5-12 paraphrased style examples
- hard avoids
- notes for PersonaPromptProfile
- notes for runtime persona config
- privacy exclusions

Then compile the safe material into config/personas/<agent-id>.persona.json using the template in examples/personas/compiled/example-friend.persona.example.json.
```

## Compiling questionnaire answers

Use `PersonaPromptProfile` for text/behavior:

- `identityFrame`: 4-8 lines on who they are, what they seek/avoid, how they react under pressure, and how that appears in chat.
- `voiceGuidelines`: strict writing rules: language, casing, punctuation, message length, emojis, slang, rhythm, humor.
- `styleExamples`: paraphrased messages that sound like them, never raw private screenshots.
- `relationshipBiases`: how they read, trust, provoke, protect, avoid, or seek each friend.
- `hardAvoids`: things the AI should not say/do because they are false, unsafe, too private, or out of character.

Use `persona` for the runtime surface fields:

- `id` and `name`: must match the simulation agent.
- `archetype`: short generic role label, not a diagnosis.
- `writingStyle`: compact summary of visible chat style.
- `styleExamples`: short safe examples reused by the runtime.

Keep simulation calibration fields out of `persona`; the config loader rejects those fields.
