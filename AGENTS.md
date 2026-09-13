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

## Product-owner approval gate

Before changing product behavior, architecture, user-visible UI, scoring semantics, or deployment behavior:

1. Explain in plain Danish what the user will notice, what will remain unchanged, and the main tradeoffs.
2. Obtain the user's explicit approval of that direction before implementation.
3. Treat Cursor or other coding agents as implementation/review assistants only. They must not choose product direction or expand scope.
4. Independently review delegated work against the approved direction, roadmap, repository state, and tests before accepting it.
5. Stop and return to the user when implementation evidence requires a material product decision that was not approved.
