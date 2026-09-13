# Project Status

> **Role:** Operational checkpoint, not product authority  
> **Authoritative direction:** See [`PRODUCT_ROADMAP.md`](./PRODUCT_ROADMAP.md)  
> **Last updated:** 2026-09-13

This document tracks the repository's current implementation state. Update it when a bid is committed, blocked, superseded, or moves to the next roadmap phase.

## Current checkpoint

- Expected development branch: `adaptive-research` (always verify before work).
- Current roadmap phase: Structure 5 Bid 5B (scoped gaps / planner / loop) — final review passed, awaiting local commit.
- Structure 1–4 are committed and pushed.
- Structure 5A is committed and pushed on `origin/adaptive-research` as `ddd8c1d` (`adaptive-v14` at commit time; superseded by Structure 5B `adaptive-v15`).
- Structure 5 design decisions remain locked.
- Structure 5B is implemented and independently reviewed locally (incl. mixed-round scoped progress, contribution-identity, and post-merge continuation intelligence) and **not** committed/pushed.
- Structure 6 has not started.

## Structure 5A status (pushed)

Structure 5A pairing-aware coverage observability is on `origin/adaptive-research` as `ddd8c1d`.

## Structure 5B status (final review passed, local and uncommitted)

Structure 5B adds scoped required-cell gaps, deterministic gap-to-job planning, and scoped loop continuation:

- When `coverage.scoped.active`, eligible-field legacy gaps are replaced by one gap per uncovered required cell (observed cells never gap)
- Canonical scoped gaps carry `romanceScope` resolved fail-closed from the unique eligible primary pairing (no null fabrication / reselection)
- Planner bypasses weighted-coverage early return and `fieldStillNeedsFollowUp` for scoped gaps; groups by strategy + `semanticPairingKey` only
- Same-round one-job-per-semantic-pairing; cross-round history via existing strategy + overlapping field + semantic key; exhausted scoped gaps get no unscoped substitute
- `target_reached` blocked while required scoped cells remain uncovered; completion is `allRequiredCellsCovered` (average is diagnostics only)
- Productive required scoped progress continues without synthesize/analyze when there is no relevant legacy evidence (scoped-only or mixed with field-irrelevant legacy drafts)
- When that mixed path continues, `analyzeResearchNeeds` for continuation runs only after retained legacy drafts are merged into `research.sources` (scoped productivity still from required-cell before/after only)
- `scopedOnlyRound` is truthful execution mix (scoped ∧ ¬legacy), not a shortcut for progress calculation
- Required progress compares cellKey+sourceIdentity contributions (observability `scopedRequiredIdentities*` counts are contribution counts)
- Round observability: `scopedRequiredIdentities*`, `scopedRequiredCoverage*`, `scopedRequiredCellsCovered*`, `scopedOnlyRound`, `scopedProductive`
- `ADAPTIVE_VERSION = adaptive-v15`
- `SCOPED_COVERAGE_VERSION = scoped-coverage-v1` (unchanged)

### Verification results (2026-09-13, final-review correction 2)

- Independent Structure 5A + 5B focused suite: `49/49` pass
- Structure 5A + 5B focused (`field-coverage-observability` + `series-romance-structure-5b`): `38/38` pass
- Adaptive planner/loop suites: `46/46` pass
- Full suite (`npm test`): `556/556` pass
- `git diff --check`: clean (CRLF normalization warnings only)
- Not committed; not pushed

## Open blockers

None.

## Next action

Create the local Structure 5B commit, then push it as a normal fast-forward. Do not start Structure 6 in this bid.
