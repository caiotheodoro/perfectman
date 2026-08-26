# Project Instructions — perfectman

## Merge flow

- Every change lands on `main` through a pull request. No direct pushes to `main`, no auto-merges.
- Respect the flow: **open PR → team review → merge**. Merging happens only on explicit maintainer approval.
- After pipeline or implementation runs, stop at the open PR and wait for the human merge decision — an agent/pipeline review verdict does not authorize a merge.
- If a PR becomes conflict-ridden or out of date, sync and re-verify it, but still do not merge without approval.