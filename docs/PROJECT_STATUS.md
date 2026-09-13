# Project Status

> **Role:** Operational checkpoint, not product authority  
> **Authoritative direction:** See [`PRODUCT_ROADMAP.md`](./PRODUCT_ROADMAP.md)  
> **Last updated:** 2026-09-13

This document tracks the repository's current implementation state. Update it when a bid is committed, blocked, superseded, or moves to the next roadmap phase.

## Current checkpoint

- Expected development branch: `adaptive-research` (always verify before work).
- Current roadmap phase: Structure 6A scoped assessments independently final-reviewed and ready for commit; Structure 6B not started.
- Structure 1–4 are committed and pushed.
- Structure 5A is committed and pushed on `origin/adaptive-research` as `ddd8c1d` (`adaptive-v14` at commit time; superseded by Structure 5B `adaptive-v15`).
- Structure 5 design decisions remain locked.
- Structure 5B is independently reviewed, committed, and pushed on `origin/adaptive-research` as `65232f9`.
- Structure 6 product/scoring decisions are locked (see below).
- Structure 6A is implemented and independently verified in the working tree on top of checkpoint `1c12294` (final-review correction 2 applied; awaiting commit).
- Structure 6B aggregation has not started.

## Structure 6 decisions (locked)

- Equal canonical books in 6B; missing book scores are excluded, never converted to zero.
- Only canonical books + their primary pairings affect the later main aggregate.
- Coverage/evidence affect confidence/completeness only, never score value or aggregation weight.
- Public row fields remain unchanged in 6A/6B: `Tine-score`, `Indholdsmatch`, `Læseprioritet nu`, `Tines score`, `Tines egen vurdering`.
- `single_couple` and inactive legacy paths are deep-compatible no-ops.
- No extra web search; no research budget/planner/gap/retrieval changes; no Structure 7+.

## Structure 6A status (local, not committed)

Structure 6A adds pipeline-owned scoped pair/book/arc assessments under `_analysisMeta.scopedAssessments`:

- New module: `server/services/seriesRomanceScopedAssessment.js`
- Pipeline finalizer after final research + analysis in `analyzeNewSeries`, `refreshSeriesResearch`, and `reanalyzeSeries` (including reused global analysis backfill via `finalizeScopedOnReusedAnalysis`)
- Does **not** edit `adaptiveResearchLoop.js`
- Recomputes final scoped coverage via `buildScopedCoverage` (narrow equivalent of `calculateResearchCoverage(...).scoped`)
- `PAIRING_SCOPED_V1` = exact `ROMANCE_SCOPE_ELIGIBLE_FIELDS` (five fields); `SERIES_GLOBAL_V1` = remaining `SUBJECTIVE_KEYS`
- Fail-closed activation; one batched model call (or zero when no eligible evidence)
- Soft API/parse failure preserves legacy analysis/public row
- Versions added: `SCOPED_ASSESSMENT_VERSION = scoped-assessment-v1`, `SCOPED_ASSESSMENT_PROMPT_VERSION = scoped-assessment-prompt-v1`
- Unchanged: `ADAPTIVE_VERSION = adaptive-v15`, `ANALYSIS_PROMPT_VERSION = analysis-v16`, `SUBJECT_BINDING_VERSION = subject-binding-v1`, `SCOPED_COVERAGE_VERSION = scoped-coverage-v1`
- No `seriesAggregation` in 6A; stale speculative `seriesAggregation` is stripped if present to prevent mismatch
- Shared exports: `scopedBookScopeKey`, `scopedArcScopeKey`, `isEligibleScopedCoverageRecord`

### Final-review corrections (2026-09-13)

- Reuse policy: `error` never reusable; `ready` reusable; `insufficient_scope` reusable only when structurally final (`no_eligible_evidence`); `no_scored_assessments` / `no_scored_primary_pairing_assessments` prefer retry
- `missing_api_key` / model/API/parse failures stored as `status: error` (not `insufficient_scope`) with stable reason and zero/actual usage
- Empty no-call usage reports `model: null` (not `ANALYSIS_MODEL`)
- `modelCalls` = actual external/injected invocation; adapter `invoked: false` for pre-network `missing_api_key` → `modelCalls: 0` (+ `modelAttempted`)
- Inactive/stale removal uses `clearScopedAssessmentArtifacts` to subtract scoped usage once, delete dedicated counters + blob, preserve unrelated meta
- Pipeline `_usage` strips stale `scopedAssessmentTokens` / `scopedAssessmentEstimatedCostUsd` when meta has no `scopedAssessments`
- Pipeline seam `finalizeScopedOnReusedAnalysis` covers reused-analysis backfill write vs fresh early reuse no-write
- Top-level `ready` requires at least one scored required primary-pairing assessment; diagnostic-only scores (books/arcs/observed) keep `insufficient_scope` + `no_scored_primary_pairing_assessments` and are not structurally reusable
- Shared fail-closed `buildScopedAssessmentRecordIndex`: duplicate non-empty `record.id` values are excluded entirely (order-independent); requests cannot allow excluded ids

### Verification results (2026-09-13, Structure 6A final-review correction 2)

- Structure 6A focused (`series-romance-structure-6a`): `27/27` pass
- Structure 3.1–5B + 6A focused regressions (series-romance* + field-coverage-observability): `275/275` pass
- Full suite (`npm test`): `583/583` pass
- `git diff --check`: clean (CRLF normalization warnings only)
- Independent final review: no commit blockers found
- Not committed / not pushed (awaiting commit)

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

None for Structure 6A final-review correction 2. Structure 6B remains the next implementation bid after 6A commit.

## Next action

Commit Structure 6A checkpoint. Do not start Structure 6B until 6A is accepted.
