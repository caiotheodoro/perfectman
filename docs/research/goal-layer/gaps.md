# Goal Layer Research Gaps

Open questions and staleness caveats — honest about what this pack could not verify, per the source-map convention. Every gap names its source or limitation.

## Removed / unreachable sources

- OpenAI "Autotelic Systems" post (Schmidhuber, 2025) is 404/removed: raw fetch 403, r.jina.ai 404, empty Wayback CDX, no entry in `openai.com/sitemap.xml`. The thread is fully covered by the cited primaries (arXiv:2012.09830, arXiv:1708.02190, Oudeyer & Kaplan 2007, Schmidhuber IEEE TAMD 2010), so no information is lost — but any future work citing the post must not re-route to it.
- sims.fandom.com is Cloudflare-blocked to raw fetches and to r.jina.ai; The Sims rows cite Wikipedia instead. Deeper Sims pages ("Wants and Fears", "Aspiration (The Sims 2)", "Lifetime wish" detail) may need a real browser.
- The philpapers OA repository PDF of Coltheart, Menzies & Sutton (2010) is Cloudflare-gated on both tiers; the PubMed abstract is cited instead.
- sims.fandom.com "Lifetime wish", nethackwiki, rimworldwiki, and ck2.paradoxwikis are game wikis that reorganize content; links may rot faster than journal DOIs.

## Paywalled primaries cited via abstracts

Kunda 1990, Leary et al. 1995, Ridgeway & Correll 2006, Sheldon & Elliot 1999, Emmons 1986, Festinger & Carlsmith 1959, Campbell 1949, Propp 1968, Frankl, and De Gruyter/Oxford items were verified via publisher/OpenAlex/Semantic Scholar abstracts or scholarly secondaries — no full text was read. Quotes in [notes.md](notes.md) are confined to what those verified records carry.

- Propp's completion-beat syntax rests on secondary corroboration (*Folklore* 1985, *JAF* 2016, Wikipedia function list) rather than the 1928 text.
- Campbell's monomyth is quoted through one accessible abstract and Wikipedia's stage table; the return-leg finding is from *Heroism Science* 2019.

## Design choices that outrun the sources

- The deference/ridicule signal mapping in `evaluate-world-verdict` (weights, ratification ratio bands) is a design encoding of Ridgeway's breakable consensus, not a measured finding. The specific thresholds are scaffold defaults, not literature values.
- The delusion-gap weights (`wSignal`, `wSocial`, `wIdentity`, `revisionThreshold`) operationalize Coltheart/Kunda machinery; their defaults (0.4/0.4/0.2/0.5) were **measured/confirmed 2026-08-26** against six mock scenario arcs (issue #96): the scaffold values separate all six arcs legibly and no weight change flipped any termination, so the defaults were kept per the calibration's negative result ([calibration record](calibration-2026-08-26.md), locked in [ADR-0011](../../adr/0011-goal-layer-threshold-calibration.md) D-27). `revisionThreshold` is inert — no runtime code consumes it (belief-revision machinery deferred, so there is no measurement instrument), and the calibration could only record it.
- The meaning-made gate (`divergenceFromLog < ending.meaningMadeMaxDivergence`, default 0.33 — `world-evaluator.ts`) was calibrated 2026-08-27 by its dedicated 30-cell grid (issue #106): **0.33 confirmed** — 0.25/0.30 false-reject the terminating arcs (a rejected flip deletes the ending, not just delays it), 0.36/0.40 are behavior-neutral with zero measured false-accept, tightest flip margin 6.1% (world-briefly-wrong, cadence 10); measured class separation flips ≤ 0.3099 vs hollow ≥ 0.6604. Negative result — [calibration §11](calibration-2026-08-26.md) + [ADR-0012](../../adr/0012-goal-layer-meaning-made-gate.md) D-29.
- The "story is over" ending as a plateau-with-no-next-goal condition is this design's reading of Dwarf Fortress's no-win stance; DF itself never offers an ending, it merely stops being playable.

## Measurement instruments still to steal (not fetched)

Aspiration Index (Kasser & Ryan) for intrinsic-vs-extrinsic goal content; Self-Concordance ratings (Sheldon & Elliot) for regulatory reason; Loyola Generativity Scale + generative-action checklists (McAdams & de St. Aubin); Northwestern Ego Integrity Scale (used in van der Kaap-Deeder 2021). These are named as future schema sources; no instrument copy is quoted here.

## Identified but not fetched this run

- Ovsiankina (1928) / Mahler (1935) substitution-work studies (when a substitute activity closes an open loop).
- Kermode, *The Sense of an Ending* (1967) — cultural/perceptual ending theory.
- Carroll (2007), "Narrative closure," *Philosophical Studies* 135 — the primary of the erotetic account, reached here through the JLS 2016 review.
- CK3's replacement of ambitions with lifestyle focuses (Paradox dev diaries) — a deliberate-design negative result.
- Narrative-identity scoring traditions (redemption/contamination sequences, self-event connections; McAdams & McLean 2013) for any future automatic closure scorer.

## Freshness horizon

All sources fetched 2026-08-25. Journal DOIs are stable; recheck game-wiki rows before relying on their exact wording, and recheck the paywalled abstracts before quoting them further.