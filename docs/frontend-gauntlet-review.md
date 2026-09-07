# Frontend gauntlet review — 2026-09-07

Perfectman's intro, casting, scene selection and run viewer now share an original graphic cast of nonhuman AI agents. Speech, concealed motive and silence have separate visual treatments. This review records the comparison, implementation and acceptance evidence against baseline `dcd5f4e`.

## Before and after

These are actual React screenshots. Both mobile frames show the first authored intro beat. The earlier desktop capture caught a later beat during autoplay; compare its layout and character treatment, not its dialogue timing.

| Desktop before | Desktop after |
| --- | --- |
| ![Earlier desktop intro](evidence/frontend-gauntlet/before-desktop.png) | ![Graphic agent intro](evidence/frontend-gauntlet/after-desktop.png) |

| 390px before: the balloon covers Marcela | 390px after: words and cast have separate space |
| --- | --- |
| ![Earlier mobile intro](evidence/frontend-gauntlet/before-mobile.png) | ![Graphic mobile intro](evidence/frontend-gauntlet/after-mobile.png) |

## Comparison and selection

Six independent nonhuman studies used the same Iris/Bruno/Marcela public, thought and private sequence. Two fresh-context critics inspected running output at 1280px and 390px without builder rationale. Both chose **E / Graphic**, with D / Companions second. Their complete rankings were E–D–C–A–B–F and E–D–A–B–C–F. These are design judgments, not a user study.

| Study | Public scene | Largest gap at comparison |
| --- | --- | --- |
| A — illustrated signal creatures | ![Study A](evidence/frontend-gauntlet/study-a.png) | Distinct silhouettes, but frontal attention and small mobile faces. |
| B — folded diorama | ![Study B](evidence/frontend-gauntlet/study-b.png) | Strong atmosphere; the set competes with small labels and weak character attention. |
| C — sculpted instrument agents | ![Study C](evidence/frontend-gauntlet/study-c.png) | Useful private grouping, but similar screen faces and limited individual acting. |
| D — seed, moss and moth companions | ![Study D](evidence/frontend-gauntlet/study-d.png) | Coherent creature identities; fixed poses and a misleading listening label during a private thought. |
| E — graphic creatures and objects | ![Study E](evidence/frontend-gauntlet/study-e.png) | Clearest dialogue and privacy. Needed directed gaze, quieter neutral delivery, real selection choices and silence. |
| F — soft 3D companions | ![Study F](evidence/frontend-gauntlet/study-f.png) | Final expression and mobile text fixes improved it; mostly frontal acting still did not justify the rendering cost. |

A–C explored the stage; D–F also provided authored selection-to-watch samples. The final F image above includes its late corrections. Earlier human studies were rejected after the user's explicit correction to **AI agents, not persons**. No reference artwork or experimental renderer is shipped.

The selected implementation keeps one SVG renderer. A style picker was evaluated and deferred: multiple renderers add expression and identity validation without a demonstrated user need. Both 3D studies required about 167 KB gzipped of Three.js before other assets. The soft 3D study measured about 20 fps median and a 133 ms desktop frame-interval p95 in headless Chrome/SwiftShader. Those software-rendered measurements do not establish physical-phone performance. No new application dependency was added.

The integrated production build emits 363.61 KB JavaScript (108.29 KB gzip) and 28.91 KB CSS (7.18 KB gzip), plus the existing fonts and audio assets. These are build sizes, not measured page-load latency.

## Integrated behavior

The same artwork appears in the authored intro, actual preset previews, provider setup, run stage and timeline. Shapes remain stable by sorted cast identity; facial states use the existing recorded/authored emotion mapping. Missing emotion stays neutral. Gaze is theatrical orientation toward an audible speaker or audience, not a claim of physical action or location.

Cast changes are stated before selection and after a scene changes the cast. Edits immediately invalidate stale compilation. Preparation displays the compiled cast and can be cancelled even before the start request returns its run ID. Playback begins at the first intended beat after buffering. Navigation preserves the paused position; starting a changed scene cannot silently replace an active run. Completed and failed runs have recovery controls. Resetting a completed or failed accepted run clears the key; a rejected start request leaves the form available for correction.

The branch was synchronized with `main` at `3f1d6a6` before delivery, preserving its [server-busy notice](evidence/frontend-gauntlet/server-busy.png), disabled Start button and conflict explanation. The existing busy check runs only while the provider form is visible and usable. A busy server is described separately from invalid cast/scene files.

| Cast | Scene | Provider |
| --- | --- | --- |
| ![Actual cast selection](evidence/frontend-gauntlet/cast.png) | ![Actual scene selection](evidence/frontend-gauntlet/scene.png) | ![Actual provider form](evidence/frontend-gauntlet/provider.png) |

These run screenshots are **authored HTTP/SSE fixtures through the real React application**, not a model-generated simulation. They deliberately include seven agents and a long name. Offscreen audience members are listed separately from agents who cannot see the conversation.

| Public | Viewer-only thought | Private |
| --- | --- | --- |
| ![Public mobile viewport](evidence/frontend-gauntlet/public-mobile.png) | ![Thought mobile viewport](evidence/frontend-gauntlet/thought-mobile.png) | ![Private mobile viewport](evidence/frontend-gauntlet/private-mobile.png) |

| Silence | Long dialogue | Recoverable failure |
| --- | --- | --- |
| ![Silent beat](evidence/frontend-gauntlet/silence-mobile.png) | ![Long line](evidence/frontend-gauntlet/long-dialogue-mobile.png) | ![Provider failure](evidence/frontend-gauntlet/failure-mobile.png) |

The final visual critic initially rejected mobile stepping because the next line could appear above the viewport. Compact controls now remain reachable; manual stepping, seeking and playing reveal the selected line. Autoplay follows the stage while it is being read. Paused incoming beats and reading Details preserve the reader's position. The independent re-review passed at 320×568 and 390×844 with keyboard, touch and normal-motion playback.

## Validation

Use Node 22, matching CI. The browser check also requires Chrome (`CHROME_PATH` overrides the macOS default); it reuses the existing renderer's Puppeteer dependency and launches its own local fixture server and Vite instance.

Verified locally after synchronization: **2,058 tests across 209 files**, full workspace build/typecheck, test-hygiene and documentation gates. The real-app browser check passed separately.

```sh
pnpm install --frozen-lockfile
pnpm -r build
pnpm lint
pnpm test:all
node scripts/check-web-viewer.mjs
```

The browser check writes disposable screenshots and its report under `out/gauntlet/app-browser-checks/`. It covers the real intro/cast/scene/provider wiring, server-busy recovery, cancellation, first beat, public/private/thought/silence, 320/390/1280px layouts, viewport reading position, long text/names, missing emotion, incoming beats, keyboard seek, play/pause, actual audio/mute, completion and early failure. Deterministic timing invariants remain in the focused clock and lifecycle tests.

The complete PR workflow's mock/rule benchmark and `scripts/ci/check-bench-gate.mjs` were also run with its eleven golden scenario IDs. The current CLI ran 35 scenarios: zero failures, 100% signal pass and 95.4% probe pass. The structural gate passed. Rule-judge calibration remained below its threshold, so its scores are advisory and do not establish model quality.

Independent review results: **Standards pass** after resolving test-fixture, assertion and hygiene findings; **Spec pass** with no concrete correctness blocker or scope creep; **Visual pass** after the mobile reading-position revision. These reviews do not authorize merging.

## Limits

- Six original artwork identities repeat in larger rosters; names still disambiguate them. The three- and five-agent shipped presets have distinct silhouettes. Public/private placement still draws at most six/five agents, with overflow audience text.
- No paid or live provider was exercised. The fixture compiler response tests UI wiring; existing server tests cover actual compilation. No claim is made about current model performance or deployment.
- The existing replay adaptation uses the latest channel membership when rebuilding historical beats. Historical attendance accuracy and reopening saved runs remain outside this frontend change.
- Physical actions, simulation-engine changes, appearance fields, renderer unification, a framework migration and deployment remain outside scope. Team review and explicit maintainer approval are required before merge.

## Sources / Related decisions

| Source | Type | Checked | Use and boundary |
| --- | --- | --- | --- |
| [Gauntlet Loop](https://somethingbig.ai/gauntlet-loop) | Author's method | 2026-09-07 | Goal, independent critics of running output, rejection and iteration. No promotional model-comparison claims adopted. |
| [Town](https://www.town.com/) | User-supplied visual reference | 2026-09-07 | Original nonhuman companion variety; inspected page and character assets. No assets copied into the app. |
| [Night in the Woods official gallery](https://www.nintendo.com/us/store/products/night-in-the-woods-switch/) | Publisher reference | 2026-09-07 | Diner ensemble frame used for composition and directed attention. Secondary to the user's agent correction. |
| [The Sims 4 character reference](https://thesims-api.ea.com/game-info/smarter-sims) | Official reference | 2026-09-07 | Initial 3D expression lead; superseded as a character-identity target by the nonhuman correction. |
| [Grok.bot](https://grok.bot/) / [OpenHuman](https://openhuman.com/) | User-supplied references | 2026-09-07 | Retirement notice / unavailable during inspection. No unseen visual claims adopted. |
| [Application architecture](architecture/application.md), [testing guidelines](testing-strategy.md), [merge rules](../AGENTS.md) | Repository contracts | 2026-09-07 | Runtime meaning, verification and open-PR stopping point. |
