# Perfectman Examples

Examples are organized by use case so local setup is easier to copy without mixing runtime configs with persona source material.

## Folders

- [`simulations/`](simulations/) — runnable simulation config examples.
- [`presets/`](presets/) — casts and scenes the web runner offers as starting points.
- [`personas/setup/`](personas/setup/) — persona collection/setup workflow config.
- [`personas/compiled/`](personas/compiled/) — safe runtime persona file examples.
- [`personas/source-pack-template/`](personas/source-pack-template/) — sanitized template for local-only persona evidence packs.

## Recommended persona flow

```text
examples/personas/source-pack-template/
  copy as docs/personas/<person>/ locally

local-only docs/personas/<person>/
  transcript-YYYY-MM-DD.md
  assessment-YYYY-MM-DD.json
  evidence-summary.md
  prompt-profile-notes.md

safe compiled runtime file
  config/personas/<agent-id>.persona.json

simulation config
  config/index.json with agent.personaFile = "personas/<agent-id>.persona.json"
```

Never commit real transcripts, raw assessments, or person-specific source packs.
