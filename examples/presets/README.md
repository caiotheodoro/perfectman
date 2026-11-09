# Web Runner Presets

What the run flow offers when you'd rather not write markdown from scratch.
All bundled casts and scenes are in English. Stable folder and character IDs
stay unchanged so saved references keep working. Uploaded files keep their own language.

Everything here is ordinary authoring input — the server reads these files and
hands them to the same compiler an upload goes through, so a preset and a file
you wrote behave identically.

```
casts/<id>/    preset.json + one *.persona.md per character
scenes/<id>/   preset.json + one *.scenario.md
```

`preset.json` carries `title` and `blurb`. A scene adds `cast`, naming the cast
it was written for: a scene names its people in `cast:` and assigns hidden
objectives by agent id, so it cannot be run against a cast that does not contain
them. The picker pairs the two rather than letting the compiler reject the
combination afterwards.

To add one, drop a folder in and reload — nothing is bundled into the web build.

## Default library

**`the-group`** is the headline cast: Goulart, Caio, Jota, Ian Bruno, and Rex.
English group chat, with distinct, abrasive voices. Six scenes were written for them,
each with two scarce resources so at least two people are in structural
conflict:

- `ultimo-thread` — midnight turns the board into evidence
- `ultima-proteina` — day 11, they are dying, the sixth is under the tarp
- `velorio-no-grupo` — the body is at the wake now; they were there that night
- `live-que-nao-cai` — chat donates because it thinks someone is dying
- `o-print` — a private audio already reached someone of flesh
- `cinco-gorilas` — wedding tomorrow, the kilo is still in the gallery

**`studio-partners` / `the-slice`** stays as the polite control: three partners,
a dinner, a sale. Same compiler, lower temperature.

**`building-aurora` / `cat-on-the-roof`** and **`elevator-four` / `elevator-at-midnight`**
are short-chat scenes: every persona sets `presence.messageLength` and each scene
sets a `storyClock`, so the cast writes chat-sized messages and refers to the hour.
They also name where they happen with `setting:` (rooftop, stairwell, elevator, kitchen, living, lobby, street, office), optional `props:` and side `rooms:`; the viewer draws from these and the simulation never reads them.
**`residencial-aurora` / `gato-no-telhado`** is the same cat scene written natively in pt-BR (not a translation of the lines: new voices for the same four people, same secrets and resources).
Scored with the rubric in `docs/eval/roleplay-rubric/`.

## Telenovela (pt-BR, drama)

**`casa-vilela`** is a cast of five for the drama verbs: Dona Helena (the matriarch who controls the inheritance), Ricardo (the son who betrayed his wife), Beatriz (the daughter-in-law who has stopped swallowing), Otávio (the lawyer who knows too much) and Sofia (the goddaughter who depends on everyone's affection). Five scenes use it, each with a `drama` block in its frontmatter (act contract section 7):

- `tapa-na-cara` — a birthday dinner, a betrayal said out loud; the ladder climbs to the slap (`max_rung: 4`).
- `confronto-da-traicao` — the safe is open; the confrontation climbs to the punch (`max_rung: 5`), and a second pair, Ricardo and Otávio, may be at each other.
- `assassinato-na-festa` — one murder at the party (`may_die: [otavio]`), authored as a beat, ending in a held picture, someone kneeling by the body and a scene cut that brings him back.
- `reencontro-abraco` — Sofia comes home after five years; affection only (`max_rung: 0`): hugs and a kiss.
- `anuncio-do-desmaio` — the will is read in front of everyone and Sofia faints (`max_rung: 2`: looks and words, no blows).

Three frontmatter keys beyond the ones above are read by the drama layer and ignored by the compiler:

```yaml
drama: { max_rung: 4, may_target: [[beatriz, ricardo]], may_die: [] }   # agent ids or cast names; the authoring service compiles it into the body
beats:                                                                  # the scene's script, seconds in; read by the drama sim
  - { at: 90, actor: ricardo, verb: kill, with: otavio, skip: true }
  - { at: 170, cut: "fim da festa" }
priorEvents:                                                            # payload.tone and payload.personTargets are how a message becomes a grievance
  - { ..., payload: { content: "...", tone: betrayal, personTargets: [beatriz] } }
```

`tone` is `hostile`, `accusing`, `betrayal`, `humiliating`, `tender` or `romantic`: the sim turns a message into a grievance (or warmth) of its target toward its speaker, with the time it was said, so the director's motive gate (`rel.resentment` or a recent negative event) has something to read. `beats` are not played by the hotel sidecar yet: the sidecar has no player for authored acts or scene cuts (errata P4-01).

To watch one: `pnpm --filter @perfectman/eval drama:sim -- --scenario tapa-na-cara --out out/tapa` writes `frames.jsonl`, `events.jsonl`, `probes.json` and `timeline.txt`; `--all` runs the five.
