import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  assessSeriesIdentityResolution,
  buildIdentityResolutionJob,
  calculateFieldCoverage,
  planFollowUpResearch,
  shouldTriggerIdentitySearch,
  softLeadCharacters,
} from "../server/services/adaptiveResearch.js";
import {
  evaluateSourceForField,
  isFieldSpecificEvidence,
} from "../server/services/evidenceRelevance.js";
import { inferSeriesRomanticLeads } from "../server/services/webResearch.js";
import {
  prepareIdentitySources,
  runAdaptiveResearch,
} from "../server/services/adaptiveResearchLoop.js";

const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const RHYSAND = "Rhysand-faktoren";

const seriesIdentity = {
  title: "The Ember Cycle",
  author: "A. Writer",
  series: "The Ember Cycle",
  firstBook: "Ember One",
  isSeries: true,
};

function assessment(over = {}) {
  return {
    score: 3,
    confidence: "low",
    basis: "ai_inference",
    evidenceSourceIds: [],
    conflictingSourceIds: [],
    sourceCount: 0,
    sourceBatch: "helteprofil",
    reason: "",
    ...over,
  };
}

function weakAssessments() {
  return Object.fromEntries(
    SUBJECTIVE_KEYS.map((k) => [k, assessment()])
  );
}

function analysisWith(assessments) {
  return { meta: { assessments, estimatedCostUsd: 0.02 } };
}

function researchWith(sources, extra = {}) {
  return {
    identity: { title: seriesIdentity.title, author: seriesIdentity.author },
    sources,
    reviewConsensus: {},
    facts: {},
    ratings: {},
    meta: { webSearchCalls: 4, estimatedCostUsd: 0.09, warnings: [] },
    ...extra,
  };
}

function book1OnlySources() {
  return [
    {
      id: "source-1",
      title: "Book 1 blurb",
      url: "https://publisher.example.com/ember-one",
      type: "blog",
      summary:
        "Book 1: romance between Elowen and Aldric. Aldric is the male love interest in the first book.",
    },
  ];
}

describe("series identity resolution gate", () => {
  it("book-1 love interest is not series-resolved", () => {
    const inferred = inferSeriesRomanticLeads({ sources: book1OnlySources() });
    assert.equal(inferred.mmc, "Aldric");
    assert.equal(inferred.fmc, "Elowen");
    const assessed = assessSeriesIdentityResolution(inferred, {
      identity: seriesIdentity,
    });
    assert.equal(assessed.resolution.resolved, false);
    assert.equal(assessed.resolution.reason, "book1_only_evidence");
    assert.equal(shouldTriggerIdentitySearch(assessed, seriesIdentity), true);
    assert.notEqual(assessed.confidence, "high");
  });

  it("identity search can switch series MMC from A to B", async () => {
    let identityCalls = 0;
    let fieldCalls = 0;
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith(book1OnlySources()),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxAdditionalWebSearchCalls: 4,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            identityCalls += 1;
            assert.match(job.userPrompt, /centrale \/ endgame romantiske pairing/i);
            assert.match(job.userPrompt, /Spoilers are allowed/i);
            assert.match(job.userPrompt, /Do not answer based only on book 1/i);
            assert.ok(job.queryHints.some((h) => /endgame couple/i.test(h)));
            return {
              sources: prepareIdentitySources(
                [
                  {
                    title: "Series pairing guide",
                    url: "https://fandom.example.com/ember-cycle/pairing",
                    type: "blog",
                    summary:
                      "Later books establish Corin as the heroine's central/endgame partner. Aldric is an early love interest. Elowen remains the heroine.",
                  },
                ],
                job
              ),
              webSearchCalls: 1,
              costUsd: 0.02,
            };
          }
          fieldCalls += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });

    assert.equal(identityCalls, 1);
    assert.equal(result.adaptive.identityResolution.triggered, true);
    assert.equal(result.adaptive.identityResolution.searchCalls, 1);
    assert.equal(result.adaptive.identityResolution.before.mmc, "Aldric");
    assert.equal(result.adaptive.identityResolution.after.mmc, "Corin");
    assert.equal(result.adaptive.identityResolution.after.fmc, "Elowen");
    assert.equal(result.adaptive.identityResolution.changed, true);
    assert.equal(result.adaptive.identityResolution.after.resolved, true);
    const alts = result.adaptive.identityResolution.after.alternatives || [];
    assert.ok(
      alts.some((a) => a.name === "Aldric" && a.role === "early_love_interest")
    );
    assert.ok(result.adaptive.additionalWebSearchCalls >= 1);
    assert.ok(fieldCalls === 0 || result.research.seriesIdentity.mmc === "Corin");
  });

  it("stable series pairing skips identity search", async () => {
    const sources = [
      {
        id: "source-1",
        url: "https://reviews.example.com/ember-stable",
        type: "blog",
        summary:
          "Book 1 through later series: Aldric remains the heroine's primary romantic partner. Elowen and Aldric are the central romantic pairing across the series.",
      },
      {
        id: "source-2",
        url: "https://www.goodreads.com/review/show/ember-stable-2",
        type: "goodreads",
        summary:
          "The central romantic pairing of Elowen and Aldric continues. He is her endgame partner.",
      },
    ];
    const inferred = inferSeriesRomanticLeads({ sources });
    const assessed = assessSeriesIdentityResolution(inferred, {
      identity: seriesIdentity,
    });
    assert.equal(assessed.mmc, "Aldric");
    assert.equal(assessed.resolution.resolved, true);
    assert.equal(shouldTriggerIdentitySearch(assessed, seriesIdentity), false);

    let identityCalls = 0;
    await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith(sources),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") identityCalls += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(identityCalls, 0);
  });

  it("ambiguous identity after search stays unresolved and does not lock queries to A", async () => {
    const sources = [
      {
        id: "source-1",
        summary: "Readers disagree on the male lead.",
        url: "https://forum.example.com/ember-who",
        type: "forum",
      },
      {
        id: "source-2",
        summary: "MMC Aldric appears throughout book 1.",
        url: "https://blog.example.com/aldric",
        type: "blog",
      },
      {
        id: "source-3",
        summary: "MMC Corin is also described as the male lead.",
        url: "https://blog.example.com/corin",
        type: "blog",
      },
    ];
    let identityCalls = 0;
    const fieldPrompts = [];
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith(sources),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 4,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            identityCalls += 1;
            return {
              sources: prepareIdentitySources(
                [
                  {
                    title: "Still unclear",
                    url: "https://reddit.com/r/RomanceBooks/comments/emberambig111/who",
                    type: "forum",
                    summary:
                      "Some readers say MMC Aldric is the lead. Others say MMC Corin is the male lead. The pairing is unclear.",
                  },
                ],
                job
              ),
              webSearchCalls: 1,
              costUsd: 0.02,
            };
          }
          fieldPrompts.push(job.userPrompt + " " + (job.queryHints || []).join(" "));
          assert.notEqual(job.leadCharacters.confidence, "high");
          assert.equal(job.leadCharacters.resolution.resolved, false);
          assert.match(
            job.userPrompt,
            /centrale mandlige romantiske lead|eventual romantiske partner|heltinden/i
          );
          assert.equal(/hvordan Aldric reagerer/.test(job.userPrompt), false);
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(identityCalls, 1);
    assert.equal(result.adaptive.identityResolution.after.resolved, false);
    assert.notEqual(result.adaptive.identityResolution.after.confidence, "high");
    assert.ok(fieldPrompts.length >= 1);
    const jobs = planFollowUpResearch({
      identity: seriesIdentity,
      research: result.research,
      assessments: weakAssessments(),
    });
    const hints = jobs.flatMap((j) => j.queryHints).join(" ");
    assert.match(hints, /main romantic lead heroine|eventual romantic partner/i);
  });

  it("study guide can be strong identity evidence and weak Bodyguard/THAD evidence", () => {
    const source = {
      id: "source-guide",
      url: "https://www.sparknotes.com/lit/ember-cycle/characters/",
      type: "other",
      title: "Character list",
      summary:
        "Corin becomes heroine's partner in later books. Elowen is the heroine.",
    };
    const inferred = inferSeriesRomanticLeads({ sources: [source] });
    assert.equal(inferred.mmc, "Corin");
    const assessed = assessSeriesIdentityResolution(inferred, {
      identity: seriesIdentity,
    });
    assert.equal(assessed.resolution.resolved, true);

    for (const field of [BODYGUARD, THAD, RHYSAND]) {
      const ev = evaluateSourceForField({ source, field });
      assert.ok(["contextual", "none"].includes(ev.relevance), field);
      assert.equal(isFieldSpecificEvidence(ev), false, field);
    }
  });

  it("identity search counts against adaptive budget and runs before field jobs", async () => {
    const order = [];
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith(book1OnlySources()),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxAdditionalWebSearchCalls: 1,
        maxAdditionalCostUsd: 1,
        executeFollowUpJob: async ({ job }) => {
          order.push(job.strategy);
          return {
            sources:
              job.strategy === "series_identity_resolution"
                ? prepareIdentitySources(
                    [
                      {
                        title: "Later pairing",
                        url: "https://wiki.example.com/ember/romance",
                        type: "blog",
                        summary:
                          "Later books establish Corin as the heroine's central/endgame partner. Aldric is an early love interest.",
                      },
                    ],
                    job
                  )
                : [],
            webSearchCalls: 1,
            costUsd: 0.04,
          };
        },
        synthesize: async () => {
          throw new Error("should not synthesize when budget is spent on identity");
        },
        analyze: async () => {
          throw new Error("should not analyze");
        },
      },
    });
    assert.deepEqual(order, ["series_identity_resolution"]);
    assert.equal(result.adaptive.identityResolution.triggered, true);
    assert.equal(result.adaptive.identityResolution.searchCalls, 1);
    assert.equal(result.adaptive.identityResolution.costUsd, 0.04);
    assert.equal(result.adaptive.additionalWebSearchCalls, 1);
    assert.ok(result.adaptive.additionalCostUsd >= 0.04);
    assert.ok(
      ["search_budget_reached", "no_new_evidence", "no_gaps"].includes(
        result.adaptive.stopReason
      ) || result.adaptive.additionalWebSearchCalls === 1
    );
  });

  it("identity sources do not artificially raise Bodyguard/THAD coverage", async () => {
    const initial = book1OnlySources();
    const before = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        score: 4,
        confidence: "medium",
        basis: "source_consensus",
        evidenceSourceIds: ["source-1"],
      }),
      research: { sources: initial },
    });

    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith(initial),
      initialAnalysis: analysisWith({
        ...weakAssessments(),
        [BODYGUARD]: assessment({
          score: 4,
          confidence: "medium",
          basis: "source_consensus",
          evidenceSourceIds: ["source-1"],
        }),
        [THAD]: assessment({
          score: 4,
          confidence: "medium",
          basis: "source_consensus",
          evidenceSourceIds: ["source-1"],
        }),
      }),
      options: {
        maxFollowUpRounds: 1,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            return {
              sources: prepareIdentitySources(
                [
                  {
                    title: "Wiki pairing",
                    url: "https://ember.fandom.com/wiki/Romance",
                    type: "blog",
                    summary:
                      "Later books establish Corin as the heroine's central/endgame partner. He is powerful and ruthless.",
                  },
                ],
                job
              ),
              webSearchCalls: 1,
              costUsd: 0.02,
            };
          }
          return {
            sources: Array.from({ length: 5 }, (_, i) => ({
              url: `https://generic${i}.example.com/character`,
              type: "blog",
              title: "Character profile",
              summary: "He is powerful, ruthless, dangerous, and a wingleader.",
              targetFields: [BODYGUARD, THAD],
              purpose: "field",
            })),
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async () => {
          throw new Error("should not rebuild on contextual-only field sources");
        },
        analyze: async () => {
          throw new Error("should not analyze contextual-only field sources");
        },
      },
    });

    const identitySrc = (result.research.sources || []).find(
      (s) => s.purpose === "identity"
    );
    assert.ok(identitySrc);
    const bg = evaluateSourceForField({
      source: identitySrc,
      field: BODYGUARD,
    });
    assert.equal(isFieldSpecificEvidence(bg), false);

    const after = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        score: 4,
        confidence: "medium",
        basis: "source_consensus",
        evidenceSourceIds: ["source-1"],
      }),
      research: result.research,
    });
    assert.ok(
      after.coverageScore - before.coverageScore < 8,
      `coverage jumped ${before.coverageScore} → ${after.coverageScore}`
    );
    const fieldRound = (result.adaptive.rounds || []).find((r) => r.round >= 1);
    if (fieldRound) {
      assert.equal(fieldRound.newRelevantSources, 0);
    }
    assert.ok(
      ["no_new_evidence", "search_budget_reached", "diminishing_returns"].includes(
        result.adaptive.stopReason
      )
    );
  });

  it("softLeadCharacters medium between-only is still unresolved for a series", () => {
    const leads = softLeadCharacters(
      { sources: book1OnlySources() },
      seriesIdentity
    );
    assert.equal(leads.mmc, "Aldric");
    assert.equal(leads.confidence, "medium");
    assert.equal(leads.resolution.resolved, false);
  });

  it("structured identity pairing B reaches planner when FMC is known and MMC missing", async () => {
    const A = "Aric";
    const B = "Bram";
    const heroine = "Lysa";
    const initial = [
      {
        id: "source-1",
        title: "",
        url: "https://publisher.example.com/ember-heroine",
        type: "blog",
        summary: `${heroine} is the heroine.`,
      },
    ];
    const before = softLeadCharacters(
      { sources: initial },
      seriesIdentity
    );
    assert.equal(before.fmc, heroine);
    assert.equal(before.mmc || "", "");
    assert.equal(before.resolution.resolved, false);

    const fieldMmcs = [];
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith(initial),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 4,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            return {
              pairing: {
                fmc: heroine,
                mmc: B,
                confidence: "high",
                basis: ["later-series central pairing", "endgame relationship"],
                alternatives: [{ name: A, role: "early_love_interest" }],
              },
              sources: prepareIdentitySources(
                [
                  {
                    title: "Series pairing guide",
                    url: "https://wiki.example.com/ember/romance",
                    type: "blog",
                    summary:
                      `Later books establish ${B} as the heroine's central/endgame partner. ${A} is an early love interest. ${heroine} remains the heroine.`,
                  },
                ],
                job
              ),
              parseStatus: "structured",
              retryUsed: false,
              retryCostUsd: 0,
              webSearchCalls: 1,
              costUsd: 0.02,
            };
          }
          fieldMmcs.push(job.leadCharacters?.mmc);
          assert.equal(job.leadCharacters.mmc, B);
          assert.equal(job.leadCharacters.resolution.resolved, true);
          if (/hero_protective|hero_respect|thad|bodyguard/i.test(job.strategy || "")) {
            assert.match(job.userPrompt, new RegExp(B));
            assert.equal(new RegExp(`\\b${A}\\b`).test(job.userPrompt), false);
          }
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: initial } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });

    assert.equal(result.adaptive.identityResolution.after.mmc, B);
    assert.equal(result.adaptive.identityResolution.after.fmc, heroine);
    assert.equal(result.adaptive.identityResolution.after.resolved, true);
    assert.equal(
      result.adaptive.identityResolution.after.reason,
      "series_pairing_confirmed"
    );
    assert.equal(result.adaptive.identityResolution.parseStatus, "structured");
    assert.equal(result.adaptive.identityResolution.retryUsed, false);
    assert.ok(fieldMmcs.length >= 1);
    assert.ok(fieldMmcs.every((name) => name === B));
  });

  it("structured hint alone does not auto-resolve without source support", async () => {
    const A = "Aric";
    const B = "Bram";
    const heroine = "Lysa";
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith([
        {
          id: "source-1",
          title: "",
          url: "https://publisher.example.com/ember-one",
          type: "blog",
          summary: `Book 1: romance between ${heroine} and ${A}. ${A} is the male love interest in the first book.`,
        },
      ]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxFollowUpRounds: 1,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            return {
              pairing: {
                fmc: heroine,
                mmc: B,
                confidence: "high",
                basis: ["central_pairing"],
                alternatives: [{ name: A, role: "early_love_interest" }],
              },
              sources: [],
              parseStatus: "structured",
              webSearchCalls: 1,
              costUsd: 0.01,
            };
          }
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(result.adaptive.identityResolution.after.resolved, false);
    assert.equal(result.adaptive.identityResolution.after.identityHintConfirmed, false);
  });

  it("identity search prefers series name over first-book-only query", () => {
    const job = buildIdentityResolutionJob({
      identity: {
        title: "First Flight",
        author: "P. Author",
        series: "Skyborne Cycle",
        firstBook: "First Flight",
        isSeries: true,
      },
      leadCharacters: {
        fmc: "Lysa",
        mmc: "",
        resolution: { resolved: false, reason: "missing_lead" },
      },
    });
    assert.match(job.userPrompt, /Skyborne Cycle/);
    assert.match(job.userPrompt, /IKKE det primære søgeemne/i);
    assert.ok(job.queryHints.some((h) => /"Skyborne Cycle"/i.test(h)));
    assert.ok(job.queryHints.every((h) => !/"First Flight"/i.test(h)));
    assert.ok(job.queryHints.some((h) => /later books romantic pairing/i.test(h)));
    assert.ok(job.queryHints.some((h) => /endgame couple/i.test(h)));
  });

  it("total parse failure keeps identity unresolved, preserves raw URLs, uses generic planner wording", async () => {
    const fieldPrompts = [];
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith([
        {
          id: "source-1",
          title: "Heroine note",
          url: "https://publisher.example.com/ember-heroine",
          type: "blog",
          summary: "Lysa is the heroine.",
        },
      ]),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 4,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            return {
              pairing: null,
              sources: [],
              rawUrls: [
                {
                  url: "https://wiki.example.com/ember/romance",
                  title: "Romance wiki",
                },
              ],
              parseStatus: "failed",
              retryUsed: true,
              retryCostUsd: 0.0004,
              webSearchCalls: 1,
              costUsd: 0.02,
            };
          }
          fieldPrompts.push(job.userPrompt);
          assert.equal(job.leadCharacters.resolution.resolved, false);
          assert.match(
            job.userPrompt,
            /centrale mandlige romantiske lead|eventual romantiske partner|heltinden/i
          );
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });

    assert.equal(result.adaptive.identityResolution.after.resolved, false);
    assert.equal(result.adaptive.identityResolution.parseStatus, "failed");
    assert.equal(result.adaptive.identityResolution.retryUsed, true);
    assert.equal(result.adaptive.identityResolution.retryCostUsd, 0.0004);
    assert.equal(result.adaptive.identityResolution.rawUrlCount, 1);
    assert.ok(
      (result.research.sources || []).some(
        (s) => s.url === "https://wiki.example.com/ember/romance"
      )
    );
    assert.ok(fieldPrompts.length >= 1);
  });

  it("field-search malformed output preserves raw URLs and does not invent field evidence", async () => {
    const sources = [
      {
        id: "source-1",
        url: "https://reviews.example.com/ember-stable",
        type: "blog",
        summary:
          "Book 1 through later series: Aldric remains the heroine's primary romantic partner. Elowen and Aldric are the central romantic pairing across the series.",
      },
      {
        id: "source-2",
        url: "https://www.goodreads.com/review/show/ember-stable-2",
        type: "goodreads",
        summary:
          "The central romantic pairing of Elowen and Aldric continues. He is her endgame partner.",
      },
    ];
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith(sources),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxFollowUpRounds: 1,
        executeFollowUpJob: async ({ job }) => {
          assert.notEqual(job.strategy, "series_identity_resolution");
          return {
            sources: [],
            rawUrls: [
              {
                url: "https://bookriot.com/ember-cycle-hero-review",
                title: "Hero review",
              },
            ],
            parseStatus: "raw_only",
            retryUsed: true,
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async () => {
          throw new Error("should not invent field evidence from prose-less URLs");
        },
        analyze: async () => {
          throw new Error("should not analyze");
        },
      },
    });

    const added = (result.research.sources || []).find(
      (s) => s.url === "https://bookriot.com/ember-cycle-hero-review"
    );
    assert.ok(added);
    assert.match(String(added.summary || ""), /Fundet via /i);
    const fieldRound = (result.adaptive.rounds || []).find((r) => r.round >= 1);
    assert.ok(fieldRound);
    assert.equal(fieldRound.newRelevantSources, 0);
    assert.equal(fieldRound.jobs[0].parseStatus, "raw_only");
    assert.equal(result.adaptive.stopReason, "no_new_evidence");
  });
});
