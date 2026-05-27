# Persona Examples

This folder separates persona collection material from runtime persona files.

## Setup workflow

1. Copy the source pack template for private local evidence:

```bash
mkdir -p docs/personas/example-friend
cp examples/personas/source-pack-template/* docs/personas/example-friend/
```

2. Fill the local source pack:

```text
docs/personas/example-friend/transcript-YYYY-MM-DD.md
docs/personas/example-friend/assessment-YYYY-MM-DD.json
docs/personas/example-friend/evidence-summary.md
docs/personas/example-friend/prompt-profile-notes.md
```

3. Compile only safe behavior into a runtime file:

```bash
mkdir -p config/personas
cp examples/personas/compiled/example-friend.persona.example.json config/personas/example-friend.persona.json
```

4. Reference it from the simulation config:

```json
{
  "id": "example-friend",
  "personaFile": "personas/example-friend.persona.json"
}
```

## Privacy rule

- `docs/personas/<person>/` is local-only source evidence.
- `config/personas/<agent-id>.persona.json` is the compact runtime profile.
- Runtime profiles must not include raw transcripts, private stories, screenshots, or assessment answers.
