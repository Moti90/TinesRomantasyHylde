# Repository Instructions

Before any architecture review or implementation bid:

1. Read `docs/PRODUCT_ROADMAP.md`.
2. Treat it as the authoritative product direction.
3. Read `docs/PROJECT_STATUS.md` for the current operational checkpoint.
4. Verify the current branch, working tree, recent commits, and relevant code.
5. If repository reality conflicts with the roadmap, report `ROADMAP CONFLICT` explicitly before proposing or making a roadmap change.
6. For significant implementation bids, prefer:
   review/decision lock → implementation → focused tests → full tests → checkpoint.
7. Do not start unrelated architecture work merely because it is technically attractive.
   Defer it unless it is required by the current roadmap phase or a real regression/blocker.

Keep the roadmap stable. Record changing implementation progress, blockers, test results, and next actions in `docs/PROJECT_STATUS.md` instead.

## Cursor CLI visibility

When Codex delegates repository work to Cursor CLI:

1. Invoke Cursor through `scripts/run-cursor-live.ps1`.
2. Write the exact prompt to a Git-ignored `tmp-*.txt` file before invoking the wrapper.
3. Keep `.cursor-live/LIVE.md`, `PROMPT.md`, `RESPONSE.md`, and `EVENTS.jsonl` available for the user to inspect.
4. Do not bypass the live wrapper unless it is unavailable; report that explicitly if it happens.
