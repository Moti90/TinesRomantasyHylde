# Project Status

> **Role:** Operational checkpoint, not product authority  
> **Authoritative direction:** See [`PRODUCT_ROADMAP.md`](./PRODUCT_ROADMAP.md)  
> **Last updated:** 2026-09-12

This document tracks the repository's current implementation state. Update it when a bid is committed, blocked, superseded, or moves to the next roadmap phase.

## Current checkpoint

- Expected development branch: `adaptive-research` (always verify before work).
- Current roadmap phase: Structure 5 Bid 5A (scoped coverage observability).
- Structure 1–4 are committed and pushed.
- Structure 4 commit: `24502c4` on `origin/adaptive-research`.
- Structure 5 design decisions are locked.
- Structure 5A final review passed.
- Structure 5A is being locally committed in this checkpoint.
- Structure 5A is **not** pushed.
- Structure 5B (gaps/planner/loop) is the next bid and has not started.
- Structure 6 has not started.

## Structure 4 status (committed and pushed)

Structure 4 pairing-aware subject binding is on `origin/adaptive-research` as `24502c4` (`adaptive-v13` at commit time; superseded by Structure 5A `adaptive-v14`).

## Structure 5A status (local commit checkpoint)

Structure 5A adds additive pairing-aware coverage observability:

- `coverage.scoped` with `scoped-coverage-v1` when `isRomanceScopePlanningReady`
- required cells = eligible primary pairings × `ROMANCE_SCOPE_ELIGIBLE_FIELDS`
- evidence-only formula (no global assessment leakage)
- zero records still materialize required cells at score 0
- deterministic source-identity dedup (`direct` > `supporting`, stable semantic tie-break; input order never wins)
- fail-closed malformed records (no `identityKey` URL/id fallback in coverage)
- observed ALT LI / secondary pairing / secondary member cells never lift primary required
- no planner/gap/loop-stop / query / retrieval / storage / budget changes
- `ADAPTIVE_VERSION = adaptive-v14`
- `SCOPED_COVERAGE_VERSION = scoped-coverage-v1`
- `adaptiveResearchLoop.js` is untouched

### Verification results (2026-09-12 — final review corrections)

- Structure 5A focused tests: `27/27` pass (`test/series-romance-scoped-coverage.test.js`)
- Structure 3.1–4 + 5A combined: `178/178` pass
- Adaptive coverage/planner/loop suites: `82/82` pass
- Full suite (`npm test`): `534/534` pass
- `git diff --check`: clean (CRLF normalization warnings only)
- Final review passed; locally committed in this checkpoint; **not** pushed

## Open blockers

None.

## Next action

Push Structure 5A when ready. Do not start Bid 5B until 5A is on the remote branch.
