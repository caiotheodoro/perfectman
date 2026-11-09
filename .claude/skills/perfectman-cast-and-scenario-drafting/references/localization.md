# Localization

The skills are written in English. The files they produce follow the language the user wrote the brief in.

## Pick the language

1. An explicit `language:` in the brief wins.
2. Otherwise detect it from the user's own words (the brief, not the file names).
3. Mixed casts are allowed: a character may speak another language than the scenario. Set it per character.

## What is localized

| Localized (human or persona reads it) | Stays English (machine reads it) |
|---|---|
| Persona prose: Identity, Voice, Style Examples, Relationships, Triggers' `trigger` and `behavior` text, Mask Tells, Private Motives, Hard Limits | Frontmatter keys and every enum value |
| Scenario body: Room Context, Starting Mood, Intro Behavior, First Move, Hidden Objective, Constraint, Cost of exposure, Breaking point | The 18 verbs, `drama` keys, `beats` keys |
| `priorEvents` message content | `tone` values (hostile, accusing, betrayal, tender, romantic) |
| Scenario `name`, preset `title` and `blurb`, cut reasons | JSON keys, `status_transaction`, `physical_action_tag`, `delivery` |
| `tactic_label`, `subtext_prompt`, `ideal_action`, staged notes | `active_tactic_verb` (canonical English infinitive) |
| Display names, as the user spells them | `agentId`, `character_id` (ASCII slug) |

`active_tactic_verb` stays English so scenes can be compared and retrieved across languages. `tactic_label` is the same tactic in the user's language ("to plead" and "suplicar").

## The frontmatter `language` field is limited

Perfectman's `PersonaPromptProfile.language` accepts exactly `en` and `pt-BR` (`packages/server/src/authoring/language-detect.ts`). Any other value is a warning and falls back to detection. So:

- User writes in English or Brazilian Portuguese: set `language` to `en` or `pt-BR` in persona and scenario frontmatter, and the same in `plan.json`.
- User writes in another language (Spanish, French...): write the prose in that language. Set frontmatter `language: en` (the nearest supported value; it only picks the English prompt hints) and set the true BCP-47 tag in `plan.json` `language`. Say this in the hand-off in one line.

The runtime digests ship in `en` and `pt-BR` only. Other languages get the English digest, and the localized persona and scenario text carries the voice.

## Fountain and Samuel French in other languages

Fountain sluglines are recognised by the English `INT.` / `EXT.` / `EST.` / `INT./EXT.`. In another language, force a slugline with a leading `.` (`.INTERIOR. SALA - NOITE`). Character cues stay uppercase, and `@` forces a name that is not uppercase. Samuel French headers (ACT, Scene) are written in the user's language. See `format-export.md`.
