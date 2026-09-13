# Project Status

> **Role:** Operational checkpoint, not product authority  
> **Authoritative direction:** See [`PRODUCT_ROADMAP.md`](./PRODUCT_ROADMAP.md)  
> **Last updated:** 2026-09-13

This document tracks the repository's current implementation state. Update it when a bid is committed, blocked, superseded, or moves to the next roadmap phase.

## Current checkpoint

- Expected development branch: `adaptive-research` (always verify before work).
- Current roadmap phase: Structure 6 architecture review complete; design decisions are not yet locked.
- Structure 1–4 are committed and pushed.
- Structure 5A is committed and pushed on `origin/adaptive-research` as `ddd8c1d` (`adaptive-v14` at commit time; superseded by Structure 5B `adaptive-v15`).
- Structure 5 design decisions remain locked.
- Structure 5B is independently reviewed, committed, and pushed on `origin/adaptive-research` as `65232f9`.
- Structure 6 implementation has not started; the next bid locks the scoring and aggregation policy.

## Structure 5A status (pushed)

Structure 5A pairing-aware coverage observability is on `origin/adaptive-research` as `ddd8c1d`.

## Structure 5B status (pushed)

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
- Committed and pushed as `65232f9` (`Use scoped romance coverage in adaptive planning`)

## Open blockers

### Structure 6 decisions required before implementation

- Choose deterministic series weighting: equal primary pairings, equal books, or another explicit product rule.
- Decide how a partial series recommendation handles books without a valid personalized score (exclude with reduced confidence versus withhold the aggregate).
- Decide whether only primary pairings/books influence the main recommendation; current scoped coverage treats secondary pairings, members, ALT LI, books, and arcs as observed rather than required.
- Decide whether Structure 6 initially keeps the public row fields (`Tine-score`, `Indholdsmatch`, and `Læseprioritet nu`) unchanged and stores the new result additively under `_analysisMeta`.

## Structure 6 architecture review (read-only)

- No `ROADMAP CONFLICT` found.
- Current subjective assessments are series-global under `_analysisMeta.assessments`; public score fields are copied onto the series row.
- Structure 4 bindings and Structure 5 coverage identify scoped evidence and its sufficiency, but do not contain scoped property scores. Coverage must affect confidence/coverage display only, never the score value or aggregation weight.
- A new scoped analysis step is required after adaptive retrieval. The current model analysis can finish before productive scoped-only rounds, so its global result cannot safely stand in for final scoped assessments.
- Recommended additive owners: `_analysisMeta.scopedAssessments` for normalized pair/book/arc/series assessments and `_analysisMeta.seriesAggregation` for deterministic derived output. Research remains the owner of evidence, bindings, and coverage.
- Activation should remain fail-closed and multi-pairing only. `single_couple`, unresolved identity, malformed/stale metadata, legacy rows, and reference-locked rows retain current behavior.
- Stable identity must use code-controlled semantic pairing/book/arc keys and identity fingerprints; model-provided IDs and input order must not control aggregation.
- Existing manual fields (`Tines score`, `Tines egen vurdering`) and Excel/reference locks remain authoritative.
- Likely version changes: a new scoped-assessment version, a new aggregation version, and `ANALYSIS_PROMPT_VERSION` if model output changes. `ADAPTIVE_VERSION` should not change unless planner/coverage/loop semantics change.
- Recommended implementation split: 6A scoped assessment contract/generation; 6B deterministic personalization/aggregation and additive integration.

## Next action

Lock the Structure 6 product/scoring decisions above, then prepare the implementation prompt. Do not change code before those decisions are explicit.
