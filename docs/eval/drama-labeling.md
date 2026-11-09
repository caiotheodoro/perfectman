# Drama clip labeling tool

A local web page for hand-labeling clips against the drama axes
(`packages/eval/src/drama/axes.ts`). It is built for about two minutes per
clip. The labels it writes are the golden set that agreement statistics
(`kappa.ts`) compare a judge against, so the page never shows any judge or
model score ("blind mode"). The manifest's `scores` block is dropped on load.

## Run it

```bash
pnpm --filter @perfectman/eval label -- \
  --manifest /path/to/baseline/manifest.json \
  --labels   /path/to/labels \
  [--port 4777] [--labeler "your name"]
```

The command builds the package, starts a `node:http` server bound to
`127.0.0.1` only, and prints the URL. Open it in a browser. Stop with Ctrl+C.
Re-running against the same `--labels` directory resumes where you stopped; the
page opens on the first unlabelled clip.

- **Manifest**: JSON with an `entries` array. Each entry needs `clip` (file name,
  the clip id is the name without `.mp4`) and `symlink` or `path` (the mp4;
  relative paths resolve against the manifest's directory). Optional:
  `contact_sheet` (png), `duration_s`, `scene`, `scene_name` (shown as the title).
  Ids may only use letters, digits, `.`, `_`, `-`.
- **Labeler name**: the `--labeler` flag, otherwise the name saved in the
  browser's localStorage (type it in the header once).

## Keyboard

| Key | Action |
| --- | --- |
| `1`-`5` | score the focused axis |
| `n` | focused axis is N/A (does not apply; never a default 3) |
| `Up` / `Down`, `Tab` / `Shift+Tab` | move axis focus |
| `p` / `f` | overall pass / fail |
| `j` / `k` | next / previous clip |
| `space` | play / pause |
| `c` | show / hide the contact sheet |
| `Cmd`/`Ctrl` + `Enter` | save and go to the next clip |
| `Esc` | leave a text field so the shortcuts work again |

Speed buttons (0.5x / 1x / 2x) sit under the player. Failure codes `D1`-`D7`
are checkboxes (hover for the definition); other catalog codes (`E10`, `T3`,
`K2`, `H1` ...) go in the extra-code box and must match `^[A-Z]\d+$`.

## Saving

Edits autosave about 0.6 s after the last change, and the header shows
`saved` / `unsaved` / `NOT SAVED: <reason>`. A label is only written once all six
axes are answered (a score or N/A) and pass/fail is chosen, because the label
schema has no "unanswered". Until then the header shows `draft: n/6 axes`, and
the draft is kept in localStorage so a reload does not lose it.
`Cmd/Ctrl+Enter` on an incomplete clip does not advance and highlights what is
missing.

## Label file format

One file per clip: `<labels dir>/<clipId>.json`, one line of JSON written
atomically (temp file + rename), parsed by `parseClipLabel` in
`packages/eval/src/drama/label.ts`.

```json
{"clipId":"01-dente","labeler":"caio","labeledAt":"2026-11-08T22:35:29.850Z","scores":{"physical_expressiveness":{"score":4},"action_legibility":{"score":3},"emotion_action_fit":{"score":5},"reaction_integrity":{"score":2},"escalation_arc":{"score":4},"restraint":{"score":null}},"failureCodes":["D1","E10"],"pass":false,"notes":"optional"}
```

`score` is an integer 1-5, or `null` for N/A. `failureCodes` is deduplicated and
sorted by the server. `notes` is omitted when empty.

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /` | the page (`page.html`, `page.js`, `page.css`) |
| `GET /api/meta` | axes with questions, `D1`-`D7` definitions, default labeler |
| `GET /api/clips` | `id`, `title`, `durationSec`, `scene`, `hasContactSheet` |
| `GET /clips/:id` | the mp4, with `Range` support (206 / 416) so seeking works |
| `GET /contacts/:id` | the contact sheet png |
| `GET /api/labels` | per-clip status (`labeled`, `invalid`, `labeler`, `pass`) |
| `GET /api/labels/:id` | one label (404 if none, 422 if the stored file is invalid) |
| `PUT /api/labels/:id` | validate with `parseClipLabel` and write; 400 on invalid input, a body `clipId` that differs from `:id`, or an unsafe id |

Requests whose `Host` is not `127.0.0.1`/`localhost`, or whose `Origin` differs
from the host, get 403.
