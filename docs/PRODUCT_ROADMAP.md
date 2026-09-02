# Tines Romantasy Liste — Product Vision, Architecture Constitution & Roadmap

> **Status:** Authoritative product-direction document  
> **Audience:** Codex, Cursor, future coding agents, maintainers  
> **Purpose:** Preserve the long-term product vision so technical work does not drift into local optimization or endless research-engine refinement.
>
> Changing implementation progress, blockers, test results, and next actions belong in [`PROJECT_STATUS.md`](./PROJECT_STATUS.md). That document is operational status and does not override this roadmap.

---

## 1. The product in one sentence

**Tines Romantasy Liste should answer one core question extremely well:**

> **“Jeg har den her bog eller serie. Hvor godt passer den til mig — og hvorfor?”**

Everything in the system exists to improve the quality, trustworthiness, personalization, or usefulness of that answer.

The app is **not** primarily a book database, a generic recommendation engine, a web-search tool, a fandom encyclopedia, or an AI chat wrapper.

It is a **personalized romantasy fit engine**.

The long-term product should understand:

1. what a book or series actually contains,
2. which romantic pairings, books, arcs, tropes, dynamics, and narrative traits are present,
3. how strong and trustworthy the evidence for those traits is,
4. what the individual user likes and dislikes,
5. how those preferences should influence the final match score,
6. how confident the system should be in that answer.

---

# 2. Product philosophy

## 2.1 Research is a means, not the product

The research engine is necessary because many romantasy traits are not available in clean structured databases.

However:

> **The app must never become an endless research-engine project.**

A more sophisticated retrieval system is only valuable when it materially improves:

- recommendation accuracy,
- confidence calibration,
- personalization,
- explanation quality,
- coverage of books/series,
- or the user's decision-making experience.

Do not optimize retrieval merely because more retrieval sophistication is technically possible.

After the current series/pairing architecture is complete, the product should deliberately shift toward:

- Tine preference learning,
- personalized scoring,
- UX,
- validation,
- and production readiness.

---

## 2.2 The app should be trustworthy, not merely confident

The system should prefer:

- “Vi har middel sikkerhed på dette punkt”

over:

- presenting a highly precise score based on weak evidence.

Coverage and confidence are first-class product concepts.

Low evidence coverage should usually reduce **confidence**, not automatically reduce the underlying estimated preference score.

Example:

A book may genuinely look like a 90/100 match, but if only half the relevant dimensions are documented, the app might show:

- Match: 90
- Confidence: Low/Medium
- Coverage: 7/14 relevant dimensions

Do not silently turn “unknown” into “bad”.

---

## 2.3 Explanations matter

The final result should not merely be:

> 84/100

It should help the user understand why.

A good future result may look conceptually like:

> **Samlet match: 84**
>
> Strong match on protective hero, romantic tension, FMC growth and relationship focus.  
> Weaker match on political plot density and slower early pacing.
>
> Typical documented book: 82–89  
> Lowest documented pairing: 71  
> Coverage: 4/6 books  
> Confidence: Medium

The exact UI may evolve, but the underlying principle should remain:

> A score without interpretable reasons is weaker than a score that explains itself.

---

# 3. Who the initial user is

The first real user is **Tine**.

This is important because Tine provides:

- real ratings,
- real preferences,
- real disagreements with the model,
- real edge cases,
- and a concrete feedback loop.

But the architecture should not permanently hardcode Tine-specific assumptions.

The correct progression is:

1. build and validate the system using Tine,
2. learn how to model one person's taste deeply,
3. generalize the preference model so another person can create their own profile.

“Tines Romantasy Liste” is the proving ground.

The more general commercial concept is:

> **A personalized romance/romantasy recommendation engine that learns your taste and explains whether a book or series is likely to work for you.**

---

# 4. Core product model

The future recommendation pipeline should conceptually become:

```text
Book / Series
    ↓
Identity & topology understanding
    ↓
Research planning
    ↓
Evidence retrieval
    ↓
Evidence provenance / quality
    ↓
Subject + pairing + book / arc binding
    ↓
Field-level assessments
    ↓
Coverage + confidence
    ↓
Book / pairing assessments
    ↓
Series aggregation
    ↓
User preference model
    ↓
Personalized match score
    ↓
Human-readable explanation
```

Every major architecture decision should support this pipeline.

---

# 5. Existing research dimensions are FEATURES, not the final product

Current traits such as:

- THAD / Touch Her And Die
- Beskyttende helt
- Bodyguard-vibe
- Rhysand-faktor
- Kvindelig udvikling
- Romance i fokus
- Spice
- Worldbuilding
- Episk plot
- Politiske intriger
- Book hangover
- pacing / hook
- character development

are useful because they describe a book.

They are **features** used by the personalized model.

They are not the product goal by themselves.

Do not accidentally optimize the application around maximizing these individual field scores.

The goal is:

> determine whether the whole book/series matches the user.

A trait can be high and still be bad for a particular user.

The user profile decides whether a trait is desirable.

---

# 6. Tine preference learning is a core future capability

The long-term system should learn from Tine's own behavior and ratings.

Potential inputs include:

- book/series rating,
- explicit review,
- favorite/least-favorite characters,
- favorite romantic pairing,
- “would reread”,
- DNF,
- “too much politics”,
- “not enough romance”,
- “MMC was too controlling”,
- “loved the protective behavior”,
- “FMC growth was excellent”,
- etc.

The preference system should eventually estimate which features predict Tine's enjoyment.

Conceptually:

```text
Research features
+
Tine ratings/reviews
↓
Learned user preference weights
↓
Personalized predicted enjoyment
```

This is one of the most important future differentiators of the product.

Do not build the final match model as a permanently static manually weighted formula.

Manual weights are a useful bootstrap and fallback.

The mature system should learn.

---

# 7. Research architecture principles

The following principles are non-negotiable unless a future architecture review explicitly changes them.

## 7.1 Determinism

The same semantic inputs should produce stable planning decisions where randomness is not required.

Avoid:

- raw model ordering,
- random candidate selection,
- unstable object iteration,
- arbitrary first-result wins,
- model-generated IDs as important ordering keys.

Use code-controlled normalization and tie-breaking.

---

## 7.2 Provenance

Evidence should remain traceable to actual source material.

A model-created finding is not automatically trustworthy merely because the model produced a URL.

The system should increasingly distinguish:

- actual retrieved source,
- model finding,
- source URL,
- evidence snippet / finding,
- normalized evidence,
- subject binding,
- coverage eligibility.

Future production safety should ensure evidence is traceable to real retrieved sources.

---

## 7.3 Isolation

Evidence for one subject must not silently lift another subject.

Examples:

- Pairing A evidence must not raise Pairing B's protective score.
- Another primary pairing must not be treated as an alternative love interest.
- Secondary pair evidence must not become primary-pair evidence.
- Evidence for one book should not automatically satisfy another book.
- A series-level fact should not be incorrectly duplicated as per-pair evidence.

This principle is especially important for rotating-couple and ensemble series.

---

## 7.4 Budget invariance

Adding topology/pairing awareness must not create uncontrolled search fan-out.

Avoid:

```text
pairings × books × fields × retrieval modes
```

as a naive search strategy.

The same total search/cost budget should remain bounded.

Planning must decide what is most useful to research within the budget.

---

## 7.5 Additive migration

When replacing a singular legacy model with richer structures:

- preserve stable existing behavior where possible,
- add richer metadata first,
- migrate consumers gradually,
- maintain single-couple regression behavior.

Avoid massive rewrites unless clearly necessary.

---

## 7.6 Small implementation bids

Prefer:

- narrow architecture review,
- narrow decision lock,
- narrow implementation,
- focused tests,
- commit checkpoint.

Avoid implementing several roadmap phases in one bid.

This makes regressions easier to diagnose and preserves architectural control.

---

## 7.7 No series-specific hardcoding

Never fix ACOTAR, Mages of the Wheel, or another specific test series using:

- hardcoded character names,
- hardcoded book titles,
- title-specific branches,
- author-specific rules.

Use synthetic tests for architecture whenever practical.

Real series are validation cases, not special logic.

---

# 8. Series romance topology model

The app must support multiple relationship structures.

At minimum:

```text
single_couple
rotating_couples
ensemble_mixed
unknown
```

The model should distinguish legitimate relationships from competing romantic interests.

Important semantics:

### alternative_love_interest

A competitor / former / triangle interest within the same romantic arc.

### another_primary_pairing

A legitimate different primary pairing, typically in another book or arc.

### secondary_pairing

A legitimate romance that is secondary to the main pairing(s).

These concepts must not be conflated.

---

# 9. Pairing-aware architecture

Rotating series revealed a structural problem:

> One series cannot always be represented as one MMC + one FMC.

The mature architecture should therefore operate at multiple scopes.

## Series-global scope

Examples:

- worldbuilding,
- political complexity,
- war/military plot,
- broad narrative tone,
- overarching plot.

## Pairing/book-specific scope

Examples:

- protective behavior,
- bodyguard dynamic,
- THAD,
- Rhysand-like behavior,
- relationship dynamic,
- FMC development,
- spice relationship experience,
- romantic chemistry.

Not every current field must permanently remain in one category. Future evidence may justify finer granularity.

But the architecture should never assume everything is series-global.

---

# 10. Multi-pair scoring philosophy

For rotating/ensemble series, do not score the entire series by pooling all evidence into one bucket.

The desired direction is:

1. assess evidence at the appropriate pair/book scope,
2. calculate per-pair/per-book feature assessments,
3. calculate personalized match per pair/book,
4. aggregate those into a series result.

Important aggregation principle:

> **Do not weight the final series score by evidence quantity.**

A heavily documented pair should not automatically dominate the series merely because it has more internet coverage.

Prefer product-relevant weighting such as:

- primary books,
- primary pairing prominence,
- known book order,
- possibly explicit user's interest.

Coverage should affect confidence.

---

# 11. Variation within a series

A rotating series may not have one truthful single-number experience.

The product should eventually preserve variation.

Conceptually:

```text
Overall series match: 84
Typical documented book: 82–89
Lowest documented primary pair: 71
Coverage: 4/6 books
Confidence: Medium
```

A moderate consistency penalty may be reasonable when book scores vary substantially.

But low coverage alone should not automatically penalize the score.

Again:

> uncertainty → confidence penalty  
> bad match → score penalty

These are different concepts.

---

# 12. Source quality philosophy

Different field types require different source types.

Examples:

## Behavior / relationship dynamics

Useful:

- detailed reader reviews,
- scene descriptions,
- fandom pages,
- study guides,
- direct summaries.

## Reader experience

Useful:

- Goodreads-style reviews,
- Reddit discussion,
- blogs,
- BookTube / BookTok style reactions.

Study guides may describe events accurately but are weak evidence for emotional reader experience.

## Narrative/worldbuilding

Useful:

- structured summaries,
- study guides,
- publisher descriptions,
- detailed reviews.

The evidence-quality system should remain field-aware.

---

# 13. Evidence quantity must not equal truth

Ten weak repetitive sources should not automatically beat one highly specific trustworthy source.

The architecture should consider:

- directness,
- specificity,
- source independence,
- field relevance,
- subject validity,
- source role diversity,
- conflicts.

Supporting evidence may saturate.

Direct evidence should matter more where appropriate.

---

# 14. Confidence and coverage are separate from match

The product should eventually maintain three related but distinct concepts:

```text
MATCH
How compatible does the content appear with the user's preferences?

COVERAGE
How much of the relevant content/features has the system actually researched?

CONFIDENCE
How trustworthy is the prediction given evidence quality, coverage and conflicts?
```

Do not collapse these into a single number.

---

# 15. Current roadmap

This roadmap is the authoritative default sequence unless real implementation findings justify changing it.

---

## Structure 3.1 — Scoped retrieval planning

Purpose:

Attach deterministic pairing scope metadata to existing field jobs.

Key principle:

> Scope scheduling, not pairing-aware need selection.

No query changes yet.

---

## Structure 3.2 — Scoped execution and storage

Purpose:

Actually use the planned pairing scope during retrieval.

Expected direction:

- searches become scoped to the selected pairing/book/arc,
- results are stored with explicit scope,
- evidence for pairing A should not enter pairing B's evidence pool.

Must preserve:

- total search/cost budgets,
- single-couple regression,
- deterministic planning,
- source provenance.

---

## Structure 4 — Pairing-aware subject binding

Purpose:

Determine whether evidence actually belongs to:

- pairing,
- member,
- book,
- arc,
- series-global scope.

Subject binding should distinguish:

- selected primary pair,
- another primary pairing,
- secondary pairing,
- alternative love interest.

A valid source about another primary couple is not “wrong evidence” globally; it is evidence with a different scope.

---

## Structure 5 — Pairing/book-aware coverage

Purpose:

Coverage must reflect the correct scope.

Examples:

> Pairing A is well researched.

must not imply:

> The whole rotating series is well researched.

Coverage should become capable of representing:

```text
field X / pairing A
field X / pairing B
field X / book 3
series-global field Y
```

without uncontrolled combinatorial expansion.

This is where actual pairing-aware need selection becomes possible.

---

## Structure 6 — Pair/book scoring and deterministic series aggregation

Purpose:

Produce scoped assessments and combine them into a meaningful series recommendation.

Desired direction:

- pair/book assessments,
- series-global assessments,
- personalized book scores,
- deterministic series aggregation,
- variation/range display,
- confidence and coverage.

Do not evidence-weight the series result.

Maintain single-couple behavior.

---

# 16. Hard boundary after Structures 3–6

After Structure 6, assume the research architecture is sufficiently mature for product work.

Do **not** automatically create Structure 6.1, 6.2, 6.3, etc. because more technical sophistication is possible.

Further research-engine work should require evidence from:

- real failed benchmarks,
- incorrect recommendations,
- severe source-provenance problems,
- clearly measurable product-quality problems.

Otherwise move forward.

This is a major product rule.

---

# 17. Structure 7 — Source provenance / production safety

Purpose:

Make the research trustworthy enough for real users.

Important future concern:

A model finding should only be accepted as evidence when its source can be traced to an actual retrieved source.

Potential direction:

```text
retrieved source
→ source identifier / URL
→ model finding
→ evidence item
→ subject/scope binding
→ assessment
```

Synthetic-looking or model-invented URLs should not silently become credible evidence.

---

# 18. Structure 8 — Tine preference learning

This is one of the highest-value product phases.

Purpose:

Learn what actually predicts Tine's ratings and enjoyment.

Possible architecture:

```text
Tine rating/review
+
researched feature vector
↓
preference-learning layer
↓
updated weights / learned patterns
```

The system should learn both positive and negative predictors.

Examples:

- high protective score may correlate strongly with Tine liking a book,
- excessive politics may correlate negatively,
- FMC growth may matter more than raw spice,
- a certain mix of romance focus and worldbuilding may matter more than either alone.

The system should not assume linear relationships forever.

Start simple and interpretable.

Increase sophistication only when enough data exists.

---

# 19. Structure 9 — Personalized match model

Purpose:

Turn research + learned preference profile into the actual product answer.

The personalized model should:

- use user-specific preferences,
- tolerate missing features,
- distinguish uncertainty from dislike,
- return explanation,
- return confidence,
- remain understandable/debuggable.

Avoid opaque ML complexity before sufficient rating data exists.

An interpretable weighted model may remain preferable for a long time.

---

# 20. Structure 10 — Product UX

The current UI does not need to be discarded.

The likely need is better result hierarchy and workflow.

The future experience should make it easy to:

1. search/add a book or series,
2. see whether it is already analyzed,
3. run or refresh research,
4. see the personalized match,
5. understand the strongest positive/negative reasons,
6. see confidence/coverage,
7. drill into details only if desired,
8. rate/review the result afterward.

The user should not need to understand the research architecture.

Hide technical complexity by default.

Expose evidence and details progressively.

---

# 21. Structure 11 — Multi-series validation

Before production rollout, validate on different romantasy structures.

Validation set should include examples of:

- one couple through whole series,
- rotating couple per book,
- ensemble,
- love triangle,
- partner switch,
- secondary romances,
- strong plot / weak romance,
- strong romance / weak worldbuilding,
- incomplete/obscure web coverage.

Do not optimize exclusively for one famous series.

Use real series for validation, synthetic fixtures for deterministic tests.

---

# 22. Structure 12 — Railway production replacement

The existing stable app should remain available while experimental architecture evolves.

Principle:

> Do not destabilize the working production version prematurely.

When the experimental branch meets the product criteria:

- regression tests stable,
- representative series validated,
- scoring understandable,
- no severe provenance issue,
- UI usable,
- costs acceptable,

then replace/migrate the Railway production version.

Prefer a deliberate release checkpoint rather than incremental production leakage.

---

# 23. Branch philosophy

Default assumptions unless repository state says otherwise:

## `master`

Stable / production-oriented branch.

Do not modify directly for experimental architecture.

## `adaptive-research`

Experimental architecture branch.

Structures 3+ currently evolve here.

Before significant work:

```text
git branch --show-current
git status --short
git log --oneline -4
```

Do not assume branch/state.

Verify it.

---

# 24. Agent responsibilities

## Codex

Codex should be the main repo-near technical reviewer.

Strengths expected:

- architecture review,
- concrete call-site analysis,
- regression analysis,
- identifying hidden state assumptions,
- budget/caching/version implications,
- deterministic behavior,
- implementation review,
- test adequacy.

Codex should actively challenge an implementation when repo reality conflicts with the roadmap.

However:

> Codex must not allow local technical elegance to override the product goal.

---

## Cursor

Cursor is primarily the implementation agent.

Cursor should receive bounded implementation contracts.

It should not silently invent:

- new product semantics,
- new state models,
- new scoring philosophy,
- new roadmap phases,
- large refactors.

If implementation requires an unresolved architecture decision:

> STOP and report it.

Do not improvise.

---

## Product/roadmap role

This document owns the default product direction.

If a technical agent proposes a change that conflicts with this document, it should explicitly state:

```text
ROADMAP CONFLICT
```

and explain:

- what conflicts,
- why the existing roadmap appears insufficient,
- what real evidence justifies the change,
- the smallest possible amendment.

Do not quietly drift.

---

# 25. Review classification

Technical reviews should classify findings where practical:

## BLOCKER BEFORE COMMIT

The current implementation can create:

- incorrect behavior,
- contamination between scopes,
- nondeterminism,
- broken budgets,
- broken provenance,
- regressions,
- misleading scoring.

Fix before commit.

## SHOULD FIX NEXT BID

Important but can safely be isolated into the next bounded step.

## SAFE TO DEFER

Real issue but intentionally outside the current roadmap phase.

This prevents every review from expanding the current task.

---

# 26. Versioning philosophy

Versions are part of behavioral reproducibility.

If repository conventions say a version covers:

- planner semantics,
- coverage semantics,
- retrieval semantics,
- identity semantics,
- prompts,
- benchmark definitions,

then changing those semantics should normally bump the relevant version.

Do not avoid a version bump merely to avoid cache invalidation.

Cache invalidation is often the purpose of behavioral versioning.

But do not bump unrelated versions.

---

# 27. Caching philosophy

Caching must never prevent required architecture migration indefinitely.

If a new behavior is necessary for correctness, version/cache semantics should allow old records to refresh.

However:

- do not create unnecessary cache churn,
- do not invalidate everything for inert refactors,
- make version behavior explicit.

Manual refresh may be an acceptable temporary migration path where intentionally designed.

---

# 28. Search-budget philosophy

This is a personal/small-scale app and search cost matters.

The architecture should prioritize:

- useful evidence per call,
- field need,
- pairing need,
- source role,
- diversity,
- directness,

within a bounded budget.

Do not solve incomplete coverage by simply multiplying API calls.

A smarter planner is preferable to unlimited retrieval.

---

# 29. Failure behavior

When the system does not know:

- do not guess a winner,
- do not assign a random pairing,
- do not convert unknown into zero,
- do not silently fabricate scope.

Prefer:

```text
unknown
unresolved
low confidence
insufficient evidence
legacy fallback
```

when those are the truthful states.

---

# 30. Manual review and debugging philosophy

Observability is valuable when it answers:

> Why did the system make this decision?

Useful observability includes:

- why a field was considered a gap,
- why a retrieval mode was selected,
- which scope was selected,
- which evidence was eligible,
- why evidence was rejected,
- what lifted a coverage score,
- why a round stopped,
- which sources were capped,
- which pairing/book was researched.

Do not build observability merely for volume.

Prefer explainable causal traces.

---

# 31. Test philosophy

Tests should protect semantics, not implementation trivia.

Prefer tests for:

- determinism,
- array-order invariance,
- budget invariance,
- scope isolation,
- source isolation,
- fallback behavior,
- version behavior,
- single-couple regression,
- rotating/ensemble correctness,
- legacy compatibility.

Use synthetic names where possible.

Real book/character names belong in validation benchmarks, not unit logic.

---

# 32. Single-couple regression is important

The richer architecture must not make simple series worse.

For a genuine single-couple series:

- retrieval should remain efficient,
- scoring should remain straightforward,
- no unnecessary per-book fan-out,
- no rotating-couple machinery should complicate normal behavior.

Complexity should activate only when the topology requires it.

---

# 33. Product metrics to care about later

When real usage exists, evaluate the system using product metrics, not only research metrics.

Possible metrics:

- predicted rating vs actual rating,
- “would read” prediction accuracy,
- DNF prediction,
- calibration of confidence,
- percentage of recommendations Tine agrees with,
- average research cost per series,
- percentage of series requiring manual refresh,
- percentage of results with adequate coverage,
- repeat usage,
- time from search to useful recommendation.

The benchmark should evolve toward product truth.

---

# 34. What NOT to optimize for

Do not optimize the project primarily for:

- maximum source count,
- maximum test count,
- maximum architecture complexity,
- maximum number of extracted traits,
- perfect taxonomy,
- perfect universal book ontology,
- support for every romance genre immediately.

Optimize for:

> better personalized decisions with trustworthy explanations.

---

# 35. What would make this product special

The strongest potential differentiator is the combination of:

```text
deep genre-aware research
+
scope-aware evidence
+
learned individual taste
+
interpretable personalized scoring
+
confidence/coverage transparency
```

Most generic book tools are stronger at:

- catalog size,
- social activity,
- community reviews,
- polished database browsing.

This product should not try to beat them at their strengths.

It should be better at:

> “Will *I* like this specific series, and why?”

---

# 36. Commercial/generalization vision

Although initially built for Tine, the architecture should allow future users to have:

```text
User profile
Ratings
Reviews
Learned preference weights
Personalized match model
```

Potential future onboarding:

1. rate a set of known books,
2. optionally import reading history,
3. answer preference questions,
4. system initializes a profile,
5. predictions improve as the user rates more books.

Do not prioritize monetization now.

First prove recommendation quality.

---

# 37. Architecture stop rule

Before proposing new infrastructure, ask:

> Does this materially improve the quality of the personalized recommendation?

If **no**, do not build it now.

Before expanding an existing roadmap phase, ask:

> Is this required to prevent incorrect behavior, or are we merely improving elegance?

If it is primarily elegance:

> defer.

---

# 38. Decision hierarchy

When principles conflict, use this priority order:

1. Correct personalized recommendation semantics
2. Evidence/source integrity
3. Scope isolation
4. Determinism/reproducibility
5. Confidence honesty
6. Regression safety
7. Bounded cost
8. Maintainability
9. Performance
10. Implementation elegance

This is not absolute, but it is the default.

---

# 39. How Codex should start any significant task

Before architecture or implementation work:

1. Read this document.
2. Inspect current branch/status/log.
3. Inspect the actual relevant code.
4. State the current roadmap phase.
5. State what the task may change.
6. State what it must not change.
7. Identify any roadmap conflict before coding.
8. Prefer a small bounded bid.
9. Run focused tests.
10. Run the full suite before declaring commit-ready.

Do not rely on remembered repository state if current Git/code contradicts it.

Repository truth wins.

---

# 40. Required prompt footer for major Codex reviews

For larger architecture reviews, Codex should internally check:

```text
PRODUCT ALIGNMENT CHECK

- Does this advance the core “will I like this?” product?
- Does it preserve the current roadmap phase boundary?
- Does it create unnecessary research-engine scope?
- Does it preserve budget invariance?
- Does it preserve single-couple regression?
- Does it preserve evidence/scope isolation?
- Does it introduce semantics that belong to a later phase?
- Is any proposed new state actually necessary?
```

If a proposed change fails this check, Codex should challenge it.

---

# 41. Current near-term direction

The current path is:

```text
Structure 3.1
Scoped retrieval planning
        ↓
Structure 3.2
Scoped retrieval execution/storage
        ↓
Structure 4
Pairing-aware subject binding
        ↓
Structure 5
Pairing/book-aware coverage
        ↓
Structure 6
Per-pair/per-book scoring + series aggregation
        ↓
HARD RESEARCH-ARCHITECTURE BOUNDARY
        ↓
Structure 7
Source provenance safety
        ↓
Structure 8
Tine preference learning
        ↓
Structure 9
Personalized match model
        ↓
Structure 10
UX/product experience
        ↓
Structure 11
Multi-series validation
        ↓
Structure 12
Railway production replacement
```

Do not reorder this casually.

A change requires a concrete reason.

---

# 42. Definition of success

The project is successful when Tine can search for a book or series she has not read and receive something like:

> **Match: 87/100**
>
> Du vil sandsynligvis især kunne lide:
> - den meget beskyttende MMC,
> - høj romantisk intensitet,
> - stærk FMC-udvikling,
> - og relativt lidt unødvendigt trekantsdrama.
>
> Det, der kan trække ned:
> - den politiske del fylder mere end i flere af dine favoritter,
> - bog 1 starter langsommere end det, du normalt foretrækker.
>
> **Confidence: High**
>  
> **Coverage: 5/6 primary books**
>
> Based on your ratings, protective behavior and FMC growth are currently much stronger predictors of your enjoyment than raw spice level.

And after Tine reads the book and rates it, the system becomes slightly better at the next prediction.

That feedback loop is the destination.

---

# 43. Final instruction to Codex

**Treat this document as the product constitution.**

You are encouraged to challenge implementation details.

You are encouraged to find architectural bugs.

You are encouraged to reject unsafe or incoherent plans.

But do not let the project drift from:

> **researching what a book contains → learning what the user likes → predicting whether the user will like it → explaining why.**

When in doubt, optimize for that loop.

If a technically attractive change does not meaningfully improve that loop, defer it.

---

**Authoritative roadmap status:** Active  
**Primary product direction:** Personalized romantasy fit prediction  
**Current development branch:** Verify in Git before every task  
**Current immediate roadmap phase:** Structure 3.1 → 3.2 → 4 → 5 → 6  
