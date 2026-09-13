# Project Status

> **Role:** Operational checkpoint, not product authority  
> **Authoritative direction:** See [`PRODUCT_ROADMAP.md`](./PRODUCT_ROADMAP.md)  
> **Last updated:** 2026-09-13

This document tracks the repository's current implementation state. Update it when a bid is committed, blocked, superseded, or moves to the next roadmap phase.

## Current checkpoint

- Expected development branch: `adaptive-research` (always verify before work).
- Current roadmap phase: Structure 6B independently final-reviewed and ready for commit; Structure 6 hard boundary follows.
- Structure 1–4 are committed and pushed.
- Structure 5A is committed and pushed on `origin/adaptive-research` as `ddd8c1d` (`adaptive-v14` at commit time; superseded by Structure 5B `adaptive-v15`).
- Structure 5 design decisions remain locked.
- Structure 5B is independently reviewed, committed, and pushed on `origin/adaptive-research` as `65232f9`.
- Structure 6 product/scoring decisions are locked (see below).
- Structure 6A is independently verified, committed, and pushed on `origin/adaptive-research` as `4c839f9` (status checkpoint commit `8354338`).
- Structure 6B deterministic equal-book aggregation is implemented and independently verified locally on top of `8354338` — final correction 2 applied; not committed/pushed yet.
- No Structure 7+ work started.

## Structure 6 decisions (locked)

- Equal canonical books in 6B; missing book scores are excluded, never converted to zero.
- Only canonical books + their primary pairings affect the later main aggregate.
- Coverage/evidence affect confidence/completeness only, never score value or aggregation weight.
- Public row fields remain unchanged in 6A/6B: `Tine-score`, `Indholdsmatch`, `Læseprioritet nu`, `Tines score`, `Tines egen vurdering`.
- `single_couple` and inactive legacy paths are deep-compatible no-ops.
- No extra web search; no research budget/planner/gap/retrieval changes; no Structure 7+.

## Structure 6B status (local, uncommitted)

Structure 6B adds deterministic equal-book series aggregation under `_analysisMeta.seriesAggregation`:

- New module: `server/services/seriesRomanceAggregation.js`
- Narrow learned-taste refactor: shared core + `applyLearnedTasteAdjustmentWithProfile` (semantic default) + public `applyLearnedTasteAdjustment` (legacy insertion-order) + `buildTasteFingerprint`
- Runs immediately after scoped finalization inside `finalizeScopedAssessments` (analyze/refresh/reanalyze paths)
- `finalizeScopedOnReusedAnalysis` persists when 6A and/or 6B changed; both fresh → no-write reuse
- Policy: equal book units; equal primary pairings within a book; missing excluded (never zero)
- Projection: book > pairing for five `PAIRING_SCOPED_V1` fields (no global fallback); globals only for `SERIES_GLOBAL_V1`
- Personalized score = existing vibe estimate + existing learned-taste adjustment once per pairing-book contribution
- Version added: `SERIES_AGGREGATION_VERSION = series-aggregation-v1`
- Unchanged: `ADAPTIVE_VERSION = adaptive-v15`, `ANALYSIS_PROMPT_VERSION = analysis-v16`, `SCOPED_ASSESSMENT_*`, `SUBJECT_BINDING_VERSION`, `SCOPED_COVERAGE_VERSION`
- Public row fields unchanged; no model/API/search usage from aggregation

### Final-review corrections (2026-09-13)

- Duplicate scoped assessment subjects fail closed: ambiguous pairing `subjectKey` / `semanticPairingKey` or duplicate book subject identity are excluded (order-independent); unrelated unique subjects remain
- Aggregation exceptions strip any existing `seriesAggregation` from returned meta (`aggregationError: true`); never leave a stale blob after failure
- Reused pipeline observability: separate `scopedAssessmentsChanged` / `aggregationChanged` → truthful `scopedAssessmentsUpdated` / `seriesAggregationUpdated` (absent when false) + conditional user message
- Pure `buildSeriesAggregation` uses explicit taste or deterministic neutral profile (no disk I/O); disk load only in `attachSeriesAggregation`

### Final correction 2 (2026-09-13)

- Canonical scoped subject identity validated in `indexScopedSubjects` (not uniqueness alone): pairing eligible only when non-empty `semanticPairingKey` and `subjectKey === pairing:${semanticPairingKey}`; book eligible only when non-empty `bookKey` + `semanticPairingKey` and `subjectKey === book:${bookKey}|pair:${semanticPairingKey}` (matches 6A `buildSubjectKey`); mismatched/missing fail closed; fingerprinting + projection share the same index
- Learned-taste: shared core with `fieldPrefOrder`; Structure 6B explicit-profile API defaults to semantic `SUBJECTIVE_KEYS` (+ remaining ASCII); public `applyLearnedTasteAdjustment` explicitly selects `legacy_insertion` so reason order matches pre-6B stored insertion order; score math unchanged

### Verification results (2026-09-13, Structure 6B final correction 2)

- Structure 6B focused (`series-romance-structure-6b`): `21/21` pass
- Learned-taste + decision-score (`learned-taste`, `tine-score`, `score-reference-unlock`) + Structure 6A: `39/39` pass
- Structure 3.1–6B focused regressions (series-romance* + field-coverage-observability): `296/296` pass
- Full suite (`npm test`): `604/604` pass
- `git diff --check`: clean (CRLF normalization warnings only)
- Independent final review: no commit blockers found
- Base: `8354338`; not committed / not pushed

## Structure 6A status (pushed)

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
- Shared exports: `scopedBookScopeKey`, `scopedArcScopeKey`, `isEligibleScopedCoverageRecord`
- Committed and pushed as `4c839f9` (`Add scoped series romance assessments`)

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
- Committed and pushed as `65232f9` (`Use scoped romance coverage in adaptive planning`)

## Open blockers

None for Structure 6B local final correction 2. Awaiting commit after review.

## Next action

Commit Structure 6B checkpoint when ready. After Structure 6 is complete, stop at the hard research-architecture boundary — do not start Structure 7+ unless product evidence requires it.
