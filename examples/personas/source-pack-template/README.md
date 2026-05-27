# Persona Source Pack Template

Copy this folder to a local ignored path such as `docs/personas/<person>/`.

## Files

- `transcript.example.md` — raw interview transcript placeholder.
- `assessment.example.json` — structured assessment placeholder.
- `evidence-summary.example.md` — reviewed behavior summary.
- `prompt-profile-notes.example.md` — compact notes for runtime profile compilation.

## Rules

- Keep real source packs local-only.
- Paraphrase sensitive examples.
- Mark unsafe material as `exclude_from_prompt`.
- Compile only safe behavioral patterns into `config/personas/<agent-id>.persona.json`.
