# Persona Examples

This folder separates persona collection material from runtime persona files.

## Setup workflow

1. Copy the source pack template for private local evidence:

```bash
mkdir -p docs/personas/ana
cp examples/personas/source-pack-template/* docs/personas/ana/
```

2. Fill the local source pack:

```text
docs/personas/ana/transcript-YYYY-MM-DD.md
docs/personas/ana/assessment-YYYY-MM-DD.json
docs/personas/ana/evidence-summary.md
docs/personas/ana/prompt-profile-notes.md
```

3. Compile only safe behavior into a runtime file:

```bash
mkdir -p config/personas
cp examples/personas/compiled/ana.persona.example.json config/personas/ana.persona.json
```

4. Reference it from the simulation config:

```json
{
  "id": "ana",
  "personaFile": "personas/ana.persona.json"
}
```

## Privacy rule

- `docs/personas/<person>/` is local-only source evidence.
- `config/personas/<agent-id>.persona.json` is the compact runtime profile.
- Runtime profiles must not include raw transcripts, private stories, screenshots, or assessment answers.
