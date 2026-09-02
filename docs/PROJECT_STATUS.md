# Project Status

> **Role:** Operational checkpoint, not product authority  
> **Authoritative direction:** See [`PRODUCT_ROADMAP.md`](./PRODUCT_ROADMAP.md)  
> **Last updated:** 2026-09-02

This document tracks the repository's current implementation state. Update it when a bid is committed, blocked, superseded, or moves to the next roadmap phase.

## Current checkpoint

- Expected development branch: `adaptive-research` (always verify before work).
- Current roadmap phase: Structure 3.2, scoped retrieval execution and storage.
- Structure 1, Structure 2, Structure 2.1, and Structure 3.1 are committed and pushed.
- Structure 3.1 commit: `95c6060` on `origin/adaptive-research`.
- Structure 3.2 design decisions are locked.
- Structure 3.2 final review passed.
- No commit blockers remain.
- Structure 3.2 is being committed locally.
- Push has not occurred.
- Structure 4 has not started.

## Structure 3.1 status (committed)

Structure 3.1 adds deterministic pairing-scope metadata to existing field jobs and additive within-run planner history (`romanceScope` on jobs + `jobTrace`).

It does not change queries, execution, source storage, subject binding, coverage, scoring, budgets, or single-couple legacy behavior by itself.

## Structure 3.2 status (local commit in progress)

Structure 3.2 implements scoped retrieval execution and sidecar storage:

- executable-scope validation with fail-closed malformed non-null scope,
- non-throwing invalid-scope job traces via `safeTraceRomanceScope`,
- neutral scoped primary/fallback query inputs (no MMC/FMC guessing),
- bounded query hints that retain at least one deterministic scope hint,
- code-controlled retrieval strategy derived from normalized attempt,
- deterministic stored `requestedRomanceScope` book/arc ordering,
- top-level `research.scopedRetrieval.records` canonical storage,
- scoped jobs bypass `research.sources`, legacy merge/relevance/coverage/synthesis,
- sidecar preservation through rebuild/synthesis,
- failed-round observability (`scopedRecordsStored: 0`, `scopedOnlyRound: false`),
- `ADAPTIVE_VERSION = adaptive-v12`.

It does not implement Structure 4 subject binding, pairing-aware coverage/gaps/scoring, UI changes, or additional search budgets.

### Verification results (2026-09-02)

- Structure 3.2 focused tests: `28/28` pass (`test/series-romance-retrieval.test.js`)
- Structure 3.1 regression: `43/43` pass (`test/series-romance-planning.test.js`)
- Full suite (`npm test`): `467/467` pass
- `git diff --check`: clean (CRLF normalization warnings only)
- Locally committed; not pushed

## Open blockers

None.

## Next action

Await push approval for Structure 3.2. Do not begin Structure 4 until roadmap authorizes it.
