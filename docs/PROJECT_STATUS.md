# Project Status

> **Role:** Operational checkpoint, not product authority  
> **Authoritative direction:** See [`PRODUCT_ROADMAP.md`](./PRODUCT_ROADMAP.md)  
> **Last updated:** 2026-09-03

This document tracks the repository's current implementation state. Update it when a bid is committed, blocked, superseded, or moves to the next roadmap phase.

## Current checkpoint

- Expected development branch: `adaptive-research` (always verify before work).
- Current roadmap phase: Structure 4 complete locally; awaiting push approval.
- Structure 1–3.2 are committed and pushed.
- Structure 3.2 commit: `a1df65b` on `origin/adaptive-research`.
- Structure 4 final review passed.
- Structure 4 is locally committed; **not** pushed.
- Structure 4 is the current local HEAD on `adaptive-research`; not pushed.
- Structure 5 has not started.
- No commit blockers.

## Structure 3.2 status (committed and pushed)

Structure 3.2 implements scoped retrieval execution and sidecar storage (`research.scopedRetrieval`), fail-closed malformed scope, and `ADAPTIVE_VERSION = adaptive-v12` at commit time (superseded by Structure 4 bump).

## Structure 4 status (locally committed, not pushed)

Structure 4 adds deterministic subject binding on scoped retrieval records:

- `record.subjectBinding` with `subject-binding-v1`
- pairing / member / book / arc / series-global detection
- requested vs other-primary / secondary / ALT LI classification
- compaction without winning binding
- lifecycle: init bind, merge bind, rebuild preserve/rebind, fingerprint rebind
- stale `pairingId` refresh against unique semantic key
- `ADAPTIVE_VERSION = adaptive-v13`
- `SUBJECT_BINDING_VERSION = subject-binding-v1`

It does not implement Structure 5 coverage, gaps, scoring, UI, or query/budget changes.

### Verification results (2026-09-03)

- Structure 4 focused tests: `40/40` pass (`test/series-romance-subject-binding.test.js`)
- Structure 3.1 + 3.2 + Structure 4 combined: `111/111` pass
- Adaptive loop tests: `46/46` pass
- Full suite (`npm test`): `507/507` pass
- `git diff --check`: clean (CRLF normalization warnings only)
- Final review: passed
- Commit blockers: none
- Locally committed; not pushed

## Open blockers

None.

## Next action

Push approval for Structure 4. Do not begin Structure 5 until roadmap authorizes it.
