---
name: perfectman-cast-and-scenario-drafting
description: "Draft a cast of 2 to 12 characters and a scenario for perfectman and Habbo from a user's idea: Stanislavski goals, obstacles and tactics, Johnstone status, a beat plan, then the persona files, preset, scenario.md with its drama block and scripted beats, plus a plan.json sidecar. Output follows the user's language. Use whenever someone asks to create, write, design or extend characters, a cast, a scene, a scenario or a story for perfectman, a Habbo drama, a kiss, a fight or a killing scene. Not for running a live scene (use perfectman-scene-runtime)."
---

# Perfectman cast and scenario drafting

Turn an idea into files perfectman loads today, plus a `plan.json` that keeps the dramaturgy the files have no field for.

Before writing, read, in this order:

1. `references/safety-and-gates.md` (drama block, ladder, the checks you run on your own plan).
2. `references/tag-to-verb.md` (what Habbo can render, and what to do when it cannot).
3. `references/persona-template.md` and `references/scenario-template.md` (file shapes).
4. `references/localization.md` (what follows the user's language).
5. The runtime skill's `references/status-and-space.md` (status and the stage frame).

Examples to copy the shape from: `examples/kiss-scene/` (English) and `examples/kill-scene/` (pt-BR). Each has `casts/<cast>/` and `scenes/<scene>/` laid out like the presets, so a copy pairs scene to cast. Existing scenes: `examples/presets/scenes/*` and `examples/presets/casts/*`.

## Output

Written to the folder the user names. Without one, `examples/presets/` is the home for presets, and anything else goes under `tmp/` and is not committed.

```
casts/<cast>/preset.json
casts/<cast>/<agentId>.persona.md        one per character
scenes/<scene>/preset.json               { title, blurb, cast }
scenes/<scene>/<scene>.scenario.md
scenes/<scene>/plan.json                 validates against references/plan.schema.json
```

Optional, only when asked: a `.fountain` or Samuel French script (`references/format-export.md`).

`render_mode` is `staged` unless the user asks for `ideal`.

## Process

### 1. Interview, then stop asking

Get what you cannot invent, at most five questions in one message, each with your recommended answer:

- Who are they, how many (2 to 12), what language do they write in?
- What just happened before the scene starts?
- What does each person want from another person here?
- What is the physical peak the story needs, if any (a kiss, a hug, a slap, a death, a collapse)?
- How far may it go? Violence level and whether anyone may die.

If the user already answered, do not ask again. Proceed with the recommended answers and list them.

### 2. Stage 1: story plan

Fill `scene_metadata`: `logline` (one sentence), `given_circumstances` (history, place, what just happened), `macro_conflict` (the one thing in the way), `setting` (one of rooftop, stairwell, elevator, kitchen, living, lobby, street, office), `props` (kebab-case, at most 12), `time_of_day`.

### 3. Characters (Stanislavski GOTE and Johnstone)

For each person:

- `super_objective`: what they want from life, in one line. Goes to `Private Motives`.
- `scene_goal`: what they want from **another person** in this scene. Not a feeling and not a result.
- `obstacle`: who or what resists. Another person's goal is the best obstacle.
- `expectation`: what they think will happen if the tactic works.
- `baseline_status` (0 to 1) and `start_zone`.
- `dramatic_function`: `driver`, `target`, `observer` or `chorus`.

Build a small status matrix: for each pair that matters, who is high. A scene needs at least one pair where that flips.

Cast size:

- 2: a duet. One driver and one target. An unscripted slap, punch or kill needs a third avatar within 6 tiles (LAD-11), so script the peak of a duet.
- 3 or 4: add an observer whose status or fear changes at the peak.
- 5 to 12: dense rules apply (see the runtime skill). Give every person a function. A chorus person gets a reaction, not a plot.

### 4. Stage 2: beat breakdown

Write `target_beat_count` beats (1 to 20; a first scene is 4 to 8). For each beat:

- `active_character_id`, `target_character_id`, optional `observer_character_id`.
- `active_tactic_verb`: English infinitive, active, aimed at a person ("to intimidate", "to plead", "to dismiss", "to disarm", "to confess"). Not a feeling, not a result. Add `tactic_label` in the user's language.
- `emotion_vector` (CHAE): `primary_emotion`, optional `secondary_emotion`, `intensity` 0 to 1.
- `status_transaction`: RAISE, LOWER, MAINTAIN or COLLAPSE, and `status_delta` when it flips.
- `physical_action_tag` and `act` (see `tag-to-verb.md`). Physical action is the overflow of words: the beat where talking stops being enough. It is never decoration.
- `delivery`: `SCRIPTED` for the beats that must happen at a known second (these become `beats:`); `STEERED` for everything else.
- `subtext_prompt`: what the person means and does not say.
- `at_s`: seconds into the run. Leave the first beat at 15 s or later, space physical beats by at least 20 s.

A beat ends when the tactic succeeds, fails or new information arrives. Two beats in a row with the same tactic and the same status are one beat.

Rules for the arc:

- Open low on the ladder (rung 2 at most), climb one rung per beat, and make the peak earned. An authored skip (`skip: true`) is for the climax and needs a line in `subtext_prompt` saying why.
- The status shift sits at or just before the physical peak.
- After the peak, one beat of aftermath: a reaction, a cut, a tableau. The aftermath is where the cost shows.
- No beat tells the reader a feeling. It shows a tactic.

### 5. Gaps

Anything no verb renders is rewritten with a recipe from `tag-to-verb.md` and tagged `staged_as`; the wish goes in `ideal_action`. Never invent a verb. Never write a weapon or blood.

### 6. Emit the files

- **Persona** per `persona-template.md`. Status goes into `Voice`, `social` and `mood`. Never write a verb id, "act", "character", "actor" or "role" in a persona.
- **Scenario** per `scenario-template.md`. `SCRIPTED` beats with an act become `beats:` entries, in seconds. `drama:` has the smallest block that covers the plan: `max_rung` equal to the highest rung used (0 for an affection scene), only the needed `may_target` pairs, only the victim in `may_die`, `permadeath` as the story says, and at least one cut after a death. `STEERED` beats go into `Hidden Objective`, `Constraint`, `Breaking point`, `First Move` and persona `Triggers`.
- **plan.json** per `plan.schema.json`. `reference_beats` is `[]`.
- Prose in the user's language. Machine keys in English. `language` in the frontmatter is `en` or `pt-BR` only; the true tag goes in `plan.json` (`localization.md`).

### 7. Check, then hand off

Run the checks at the end of `safety-and-gates.md` on your own plan. Validate `plan.json` against the schema when a validator is available. If you can run perfectman, compile the scenario with `compileScenarioMarkdown` and each persona with `compilePersonaMarkdown` and read the diagnostics.

Hand-off message, short: what was written and where, the cast in one line each with their tactic, the physical peak and which verb plays it, anything staged, the language note if the frontmatter differs, and the assumptions you made. Do not paste the files.

## Never

- Write `@human`, or aim a physical beat at a visitor.
- Add or rename a verb, or edit `verb-vocab.json`.
- Plan a second kill, or two physical beats less than 20 s apart.
- Script a beat whose actor, target or verb is not valid. A targeted verb always names a target; an untargeted verb never does.
- Make a kill scene without a cut.
- Put the framework's jargon (GOTE, CHAE, status, tactic) into the persona or scenario prose a character reads.
