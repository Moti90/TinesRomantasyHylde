import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  mergeAdaptiveSources,
  nextSourceNumber,
  sourceIdentityKey,
} from "../server/services/adaptiveResearch.js";
import {
  isFollowUpSourceRelevant,
  prepareFollowUpSources,
  runAdaptiveResearch,
  shouldRunAdaptiveResearch,
} from "../server/services/adaptiveResearchLoop.js";
import { researchInputHash } from "../server/services/hash.js";
import { ADAPTIVE_VERSION } from "../server/services/versions.js";

const THAD = "Touch her and die-vibe (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";

const identity = {
  title: "Shadowbound",
  author: "Jane Doe",
  firstBook: "Shadowbound",
};

function assessment(over = {}) {
  return {
    score: 4,
    confidence: "medium",
    basis: "source_consensus",
    evidenceSourceIds: [],
    conflictingSourceIds: [],
    sourceCount: 0,
    sourceBatch: "helteprofil",
    ...over,
  };
}

function weakAssessments() {
  return Object.fromEntries(
    SUBJECTIVE_KEYS.map((k) => [
      k,
      assessment({
        score: 3,
        confidence: "low",
        basis: "ai_inference",
        evidenceSourceIds: [],
      }),
    ])
  );
}

function strongAssessments(ids) {
  return Object.fromEntries(
    SUBJECTIVE_KEYS.map((k) => [
      k,
      assessment({
        score: 4,
        confidence: "high",
        basis: "source_consensus",
        evidenceSourceIds: ids,
        sourceCount: ids.length,
      }),
    ])
  );
}

function source(id, over = {}) {
  return {
    id,
    batch: "helteprofil",
    title: over.title || `Source ${id}`,
    summary: over.summary || "",
    url: over.url,
    type: over.type,
    ...over,
  };
}

function researchWith(sources, extra = {}) {
  return {
    identity,
    sources,
    reviewConsensus: {},
    observations: [],
    facts: {},
    ratings: {},
    meta: {
      webSearchCalls: 4,
      estimatedCostUsd: 0.09,
      inputTokens: 1000,
      outputTokens: 400,
      warnings: [],
    },
    ...extra,
  };
}

function analysisWith(assessments) {
  return {
    row: { "Seriens navn": "Shadowbound" },
    meta: { assessments, estimatedCostUsd: 0.02, inputTokens: 200, outputTokens: 80 },
  };
}

const PROTECTIVE_SUMMARY =
  "He keeps her safe and acts like a bodyguard. He goes feral whenever she is threatened. Respects her agency and is an equal partner. Heroine growth and character development. Rich worldbuilding and magic system. Epic plot with high stakes. Political intrigue. War and military conflict. Open door spice. Spice quality is well-written intimate scenes. Romance-focused. Book hangover; couldn't put the book down. Grabs you immediately.";

function diverseProtectiveSources(prefix = "n") {
  return [
    {
      title: "Reddit thread",
      url: `https://reddit.com/r/RomanceBooks/comments/${prefix}aaa111/one`,
      type: "forum",
      summary: PROTECTIVE_SUMMARY,
      batch: "helteprofil",
    },
    {
      title: "Goodreads review",
      url: `https://www.goodreads.com/review/show/${prefix}2`,
      type: "goodreads",
      summary:
        "Watching over her, personal guard. Touch her and die energy. Supports her growth. Female character arc. Intricate magic system. Grand scale plot. Court intrigue. Army conflict. Steamy open door. Well-written intimate scenes. Romance takes the focus. Book hangover. Grabs you quickly.",
      batch: "helteprofil",
    },
    {
      title: "Blog review",
      url: `https://${prefix}.bookblog.example.com/review`,
      type: "blog",
      summary:
        "Assigned to protect her. Respects her agency. Strong heroine growth. Character arcs. Worldbuilding. Epic plot. Political intrigue. Military. Explicit spice scenes. Spice quality is meaningful. Romance-focused. Couldn't put the book down. Grabs you immediately.",
      batch: "helteprofil",
    },
  ];
}

describe("shouldRunAdaptiveResearch", () => {
  it("cache hit og reanalyze kører ikke adaptive websearch", () => {
    assert.equal(
      shouldRunAdaptiveResearch({ researchCacheHit: true, mode: "analyze", enabled: true }),
      false
    );
    assert.equal(
      shouldRunAdaptiveResearch({ researchCacheHit: false, mode: "reanalyze", enabled: true }),
      false
    );
  });

  it("refresh og cache miss kører adaptive når enabled", () => {
    assert.equal(
      shouldRunAdaptiveResearch({ researchCacheHit: false, mode: "refresh", enabled: true }),
      true
    );
    assert.equal(
      shouldRunAdaptiveResearch({ researchCacheHit: false, mode: "analyze", enabled: true }),
      true
    );
  });

  it("feature flag slår adaptive fra", () => {
    assert.equal(
      shouldRunAdaptiveResearch({ researchCacheHit: false, mode: "analyze", enabled: false }),
      false
    );
  });
});

describe("research cache adaptive version", () => {
  const prev = process.env.ADAPTIVE_RESEARCH_ENABLED;
  afterEach(() => {
    if (prev == null) delete process.env.ADAPTIVE_RESEARCH_ENABLED;
    else process.env.ADAPTIVE_RESEARCH_ENABLED = prev;
  });

  it("ændrer hash når adaptive er enabled vs disabled", () => {
    process.env.ADAPTIVE_RESEARCH_ENABLED = "false";
    const off = researchInputHash(identity);
    process.env.ADAPTIVE_RESEARCH_ENABLED = "true";
    const on = researchInputHash(identity);
    assert.notEqual(off, on);
    process.env.ADAPTIVE_RESEARCH_ENABLED = "true";
    assert.equal(researchInputHash(identity), on);
  });
});

describe("adaptive source merge", () => {
  it("beholder eksisterende IDs og tildeler næste nummer", () => {
    const existing = [
      source("source-1", { url: "https://a.example.com/1", type: "blog" }),
      source("source-2", { url: "https://b.example.com/2", type: "blog" }),
      source("source-7", { url: "https://c.example.com/7", type: "forum" }),
    ];
    const merged = mergeAdaptiveSources(existing, [
      {
        url: "https://new.example.com/x",
        type: "blog",
        title: "New",
        summary: "He keeps her safe and acts like a bodyguard.",
      },
    ]);
    assert.equal(nextSourceNumber(existing), 8);
    assert.deepEqual(
      merged.sources.map((s) => s.id),
      ["source-1", "source-2", "source-7", "source-8"]
    );
    assert.equal(merged.added.length, 1);
    assert.equal(merged.added[0].id, "source-8");
  });

  it("deduplikerer samme Reddit-post via old.reddit.com", () => {
    const existing = [
      source("source-1", {
        url: "https://www.reddit.com/r/RomanceBooks/comments/abc123/foo",
        type: "forum",
        summary: "Original summary about the protective hero.",
      }),
    ];
    const merged = mergeAdaptiveSources(existing, [
      {
        url: "https://old.reddit.com/r/RomanceBooks/comments/abc123/bar",
        type: "forum",
        title: "Same post",
        summary: "Fundet via helteprofil-søgning",
        targetFields: [BODYGUARD],
        adaptiveRound: 1,
        strategy: "hero_protective_dynamic",
      },
    ]);
    assert.equal(merged.sources.length, 1);
    assert.equal(merged.sources[0].id, "source-1");
    assert.equal(merged.added.length, 0);
    assert.ok(merged.enriched.length >= 1);
    assert.ok(merged.sources[0].targetFields.includes(BODYGUARD));
    assert.equal(
      sourceIdentityKey(existing[0]),
      sourceIdentityKey({ url: "https://old.reddit.com/r/RomanceBooks/comments/abc123/bar" })
    );
  });

  it("overskriver ikke en bedre summary med en dårligere", () => {
    const existing = [
      source("source-1", {
        url: "https://blog.example.com/review",
        type: "blog",
        summary: "Detailed review: he keeps her safe as a bodyguard and goes feral.",
      }),
    ];
    const merged = mergeAdaptiveSources(existing, [
      {
        url: "https://blog.example.com/review",
        type: "blog",
        summary: "Fundet via helteprofil-søgning",
      },
    ]);
    assert.match(merged.sources[0].summary, /Detailed review/);
  });
});

describe("follow-up source relevance", () => {
  it("catalog/generic tæller ikke som relevant target-evidence", () => {
    const job = { fields: [BODYGUARD, THAD], strategy: "hero_protective_dynamic" };
    assert.equal(
      isFollowUpSourceRelevant(
        {
          type: "catalog",
          summary: "Buy the bodyguard romantasy today",
          url: "https://amazon.com/dp/1",
        },
        [job]
      ),
      false
    );
    const prepared = prepareFollowUpSources(
      [
        {
          url: "https://amazon.com/dp/1",
          type: "catalog",
          title: "Buy now",
          summary: "Official listing",
        },
        {
          url: "https://reddit.com/r/RomanceBooks/comments/rel111/one",
          type: "forum",
          title: "Thread",
          summary: PROTECTIVE_SUMMARY,
        },
      ],
      job,
      1
    );
    assert.equal(prepared.some((s) => s.type === "catalog"), false);
    assert.equal(prepared.length, 1);
    assert.equal(isFollowUpSourceRelevant({ ...prepared[0], id: "source-9" }, [job]), true);
  });
});

describe("runAdaptiveResearch loop", () => {
  it("no gaps → 0 web searches", async () => {
    const ids = ["source-1", "source-2", "source-3"];
    const sources = diverseProtectiveSources("g").map((s, i) =>
      source(ids[i], s)
    );
    let executes = 0;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith(sources),
      initialAnalysis: analysisWith(strongAssessments(ids)),
      options: {
        executeFollowUpJob: async () => {
          executes += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => {
          throw new Error("should not synthesize");
        },
        analyze: async () => {
          throw new Error("should not analyze");
        },
      },
    });
    assert.equal(executes, 0);
    assert.equal(result.adaptive.additionalWebSearchCalls, 0);
    assert.ok(["no_gaps", "target_reached"].includes(result.adaptive.stopReason));
  });

  it("feature flag disabled → identisk initial research", async () => {
    let executes = 0;
    const initial = researchWith([]);
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: initial,
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        enabled: false,
        executeFollowUpJob: async () => {
          executes += 1;
          return { sources: [], webSearchCalls: 1 };
        },
      },
    });
    assert.equal(executes, 0);
    assert.equal(result.adaptive.stopReason, "disabled");
    assert.equal(result.adaptive.additionalWebSearchCalls, 0);
  });

  it("one round success → coverage stiger og stopper", async () => {
    let analyzes = 0;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith([]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            diverseProtectiveSources(`r${round}${job.strategy}`),
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.02,
        }),
        synthesize: async ({ sources }) => ({
          parsed: {
            identity,
            facts: {},
            ratings: {},
            reviewConsensus: {},
            sources,
          },
          inputTokens: 10,
          outputTokens: 10,
          costUsd: 0.01,
        }),
        analyze: async ({ research }) => {
          analyzes += 1;
          const ids = (research.sources || []).map((s) => s.id).slice(0, 3);
          return analysisWith(strongAssessments(ids.length ? ids : ["source-1"]));
        },
      },
    });
    assert.ok(result.adaptive.rounds.length >= 1);
    assert.ok(analyzes >= 1);
    assert.ok(result.adaptive.finalCoverage > result.adaptive.initialCoverage);
    assert.ok(["target_reached", "no_gaps"].includes(result.adaptive.stopReason));
    assert.ok(result.research.meta.adaptive);
    assert.equal(result.research.meta.adaptive.version, ADAPTIVE_VERSION);
  });

  it("two rounds: planner genkaldes og coverage stiger igen", async () => {
    let executeRounds = [];
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith([]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxFollowUpRounds: 2,
        executeFollowUpJob: async ({ job, round }) => {
          executeRounds.push(round);
          if (round === 1) {
            return {
              sources: prepareFollowUpSources(
                [diverseProtectiveSources("one")[0]],
                job,
                round
              ),
              webSearchCalls: 1,
              costUsd: 0.02,
            };
          }
          return {
            sources: prepareFollowUpSources(
              diverseProtectiveSources("two"),
              job,
              round
            ),
            webSearchCalls: 1,
            costUsd: 0.02,
          };
        },
        synthesize: async ({ sources }) => ({
          parsed: { identity, facts: {}, ratings: {}, reviewConsensus: {}, sources },
          costUsd: 0.005,
        }),
        analyze: async ({ research }) => {
          const ids = (research.sources || []).map((s) => s.id);
          if (ids.length >= 3) return analysisWith(strongAssessments(ids.slice(0, 3)));
          return analysisWith(
            Object.fromEntries(
              SUBJECTIVE_KEYS.map((k) => [
                k,
                assessment({
                  score: 3,
                  confidence: "low",
                  basis: ids.length ? "mixed_sources" : "ai_inference",
                  evidenceSourceIds: ids.slice(0, 1),
                }),
              ])
            )
          );
        },
      },
    });
    assert.ok(executeRounds.includes(1));
    assert.ok(executeRounds.includes(2));
    assert.ok(result.adaptive.plannerCalls >= 2);
    assert.ok(result.adaptive.rounds.length >= 2);
    assert.ok(
      result.adaptive.rounds[1].coverageAfter >=
        result.adaptive.rounds[0].coverageAfter
    );
  });

  it("duplicate follow-up → no re-analysis, no_new_evidence", async () => {
    const existing = [
      source("source-1", {
        url: "https://reddit.com/r/RomanceBooks/comments/abc123/foo",
        type: "forum",
        summary: PROTECTIVE_SUMMARY,
      }),
    ];
    let analyzes = 0;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith(existing),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [
              {
                url: "https://old.reddit.com/r/RomanceBooks/comments/abc123/other",
                type: "forum",
                title: "Same",
                summary: PROTECTIVE_SUMMARY,
              },
            ],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async () => {
          throw new Error("no synth");
        },
        analyze: async () => {
          analyzes += 1;
          throw new Error("no analyze");
        },
      },
    });
    assert.equal(analyzes, 0);
    assert.equal(result.adaptive.stopReason, "no_new_evidence");
    assert.equal(result.research.sources.length, 1);
    assert.equal(result.research.sources[0].id, "source-1");
  });

  it("search-call budget stopper næste job", async () => {
    let jobsRun = 0;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith([]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxAdditionalWebSearchCalls: 2,
        executeFollowUpJob: async ({ job, round }) => {
          jobsRun += 1;
          return {
            sources: prepareFollowUpSources(
              diverseProtectiveSources(`b${jobsRun}`),
              job,
              round
            ),
            webSearchCalls: 2,
            costUsd: 0.01,
          };
        },
        synthesize: async ({ sources }) => ({
          parsed: { identity, facts: {}, ratings: {}, reviewConsensus: {}, sources },
          costUsd: 0.001,
        }),
        analyze: async ({ research }) => {
          const ids = (research.sources || []).map((s) => s.id).slice(0, 3);
          return analysisWith(strongAssessments(ids));
        },
      },
    });
    assert.equal(jobsRun, 1);
    assert.ok(
      ["search_budget_reached", "target_reached", "no_gaps"].includes(
        result.adaptive.stopReason
      )
    );
    assert.ok(result.adaptive.additionalWebSearchCalls <= 2);
  });

  it("cost budget: behold runden og stop", async () => {
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith([]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxAdditionalCostUsd: 0.05,
        maxFollowUpRounds: 2,
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(diverseProtectiveSources("cost"), job, round),
          webSearchCalls: 1,
          costUsd: 0.08,
        }),
        synthesize: async ({ sources }) => ({
          parsed: { identity, facts: {}, ratings: {}, reviewConsensus: {}, sources },
          costUsd: 0.01,
        }),
        analyze: async ({ research }) => {
          const ids = (research.sources || []).map((s) => s.id).slice(0, 3);
          const stillWeak = Object.fromEntries(
            SUBJECTIVE_KEYS.map((k) => [
              k,
              assessment({
                score: 3,
                confidence: "low",
                basis: "mixed_sources",
                evidenceSourceIds: ids.slice(0, 1),
              }),
            ])
          );
          return analysisWith(stillWeak);
        },
      },
    });
    assert.ok(result.adaptive.rounds.length >= 1);
    assert.equal(result.adaptive.stopReason, "cost_budget_reached");
    assert.ok(result.research.sources.length > 0);
  });

  it("max rounds = 1 stopper selv om gaps er tilbage", async () => {
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith([]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxFollowUpRounds: 1,
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [diverseProtectiveSources("mx")[0]],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async ({ sources }) => ({
          parsed: { identity, facts: {}, ratings: {}, reviewConsensus: {}, sources },
          costUsd: 0.001,
        }),
        analyze: async ({ research }) => {
          const ids = (research.sources || []).map((s) => s.id);
          return analysisWith(
            Object.fromEntries(
              SUBJECTIVE_KEYS.map((k) => [
                k,
                assessment({
                  basis: "ai_inference",
                  confidence: "low",
                  evidenceSourceIds: ids.slice(0, 1),
                }),
              ])
            )
          );
        },
      },
    });
    assert.equal(result.adaptive.rounds.length, 1);
    assert.equal(result.adaptive.stopReason, "max_rounds");
  });

  it("diminishing returns når gain er lille og intet critical/conflict løses", async () => {
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith([]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        minCoverageGain: 50,
        maxFollowUpRounds: 2,
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [
              {
                url: `https://blog.example.com/world-${round}`,
                type: "blog",
                title: "World",
                summary: "He is fiercely protective of her.",
              },
            ],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async ({ sources }) => ({
          parsed: { identity, facts: {}, ratings: {}, reviewConsensus: {}, sources },
          costUsd: 0.001,
        }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(result.adaptive.stopReason, "diminishing_returns");
    assert.ok(result.adaptive.rounds[0].coverageGain < 50);
  });

  it("conflict resolution tæller som success selv ved lille coverage-gain", async () => {
    const support = diverseProtectiveSources("cf").map((s, i) =>
      source(`s${i + 1}`, s)
    );
    const conflicts = [
      source("c1", {
        url: "https://other.example.net/c1",
        type: "blog",
        summary: "He is controlling, not protective. No guardian dynamic.",
      }),
      source("c2", {
        url: "https://www.goodreads.com/review/show/c2",
        type: "goodreads",
        summary: "Possessive rather than a bodyguard.",
      }),
    ];
    const initialAssessments = strongAssessments(["s1", "s2", "s3"]);
    initialAssessments[BODYGUARD] = assessment({
      score: 4,
      confidence: "medium",
      basis: "mixed_sources",
      evidenceSourceIds: ["s1", "s2", "s3"],
      conflictingSourceIds: ["c1", "c2"],
    });

    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith([...support, ...conflicts]),
      initialAnalysis: analysisWith(initialAssessments),
      options: {
        minCoverageGain: 50,
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [
              {
                url: "https://independent.example.org/more",
                type: "blog",
                title: "Independent",
                summary: PROTECTIVE_SUMMARY,
              },
            ],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async ({ sources }) => ({
          parsed: { identity, facts: {}, ratings: {}, reviewConsensus: {}, sources },
          costUsd: 0.001,
        }),
        analyze: async ({ research }) => {
          const ids = (research.sources || []).map((s) => s.id).slice(0, 3);
          const next = strongAssessments(ids);
          next[BODYGUARD] = assessment({
            score: 4,
            confidence: "high",
            basis: "source_consensus",
            evidenceSourceIds: ids,
            conflictingSourceIds: [],
          });
          return analysisWith(next);
        },
      },
    });
    assert.ok(result.adaptive.rounds.length >= 1);
    const round = result.adaptive.rounds[0];
    assert.ok(round.conflictsAfter < round.conflictsBefore);
    assert.notEqual(result.adaptive.stopReason, "diminishing_returns");
  });

  it("job A fejler, job B lykkes → brug B", async () => {
    let n = 0;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith([]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async ({ job, round }) => {
          n += 1;
          if (n === 1) throw new Error("timeout");
          return {
            sources: prepareFollowUpSources(diverseProtectiveSources("ok"), job, round),
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async ({ sources }) => ({
          parsed: { identity, facts: {}, ratings: {}, reviewConsensus: {}, sources },
          costUsd: 0.001,
        }),
        analyze: async ({ research }) => {
          const ids = (research.sources || []).map((s) => s.id).slice(0, 3);
          return analysisWith(strongAssessments(ids));
        },
      },
    });
    assert.ok(result.research.sources.length >= 1);
    assert.ok(result.adaptive.warnings.some((w) => /timeout/.test(w)));
    assert.notEqual(result.adaptive.stopReason, "error");
  });

  it("alle jobs fejler → initial research intakt, stop error", async () => {
    const initial = researchWith([
      source("source-1", {
        url: "https://keep.example.com/1",
        type: "blog",
        summary: "keep me",
      }),
    ]);
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: initial,
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async () => {
          throw new Error("api down");
        },
      },
    });
    assert.equal(result.adaptive.stopReason, "error");
    assert.equal(result.research.sources[0].id, "source-1");
    assert.equal(result.research.sources.length, 1);
    assert.ok(result.analysis.row);
  });
});
