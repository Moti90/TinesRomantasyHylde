import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  calculateFieldCoverage,
  planFollowUpResearch,
} from "../server/services/adaptiveResearch.js";
import {
  evaluateSourceForField,
  isFieldSpecificEvidence,
} from "../server/services/evidenceRelevance.js";
import {
  executeFocusedJobWithFallback,
  isFollowUpSourceRelevant,
  prepareFollowUpSources,
  runAdaptiveResearch,
} from "../server/services/adaptiveResearchLoop.js";
import {
  assessRetrievalYield,
  buildFallbackUserPrompt,
  buildRetrievalApproaches,
  canAffordRetrievalFallback,
  classifyEvidenceOutcome,
  extractWebSearchQueries,
  flattenRetrievalApproaches,
  mergeRetrievalAttempts,
} from "../server/services/searchRetrieval.js";
import { buildSearchPlan } from "../server/services/webResearch.js";
import { summarizeRetrieval } from "../server/services/researchBenchmark.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THAD = "Touch her and die-vibe (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";
const A = "Aldric";
const B = "Bram";
const HEROINE = "Elowen";

const resolvedLeads = {
  mmc: B,
  fmc: HEROINE,
  confidence: "high",
  resolution: { resolved: true, reason: "series_pairing_confirmed" },
};

const unresolvedLeads = {
  mmc: "",
  fmc: "",
  confidence: "low",
  alternatives: [{ name: A, role: "early_love_interest" }],
  resolution: { resolved: false, reason: "missing_lead" },
};

function blobOf(approaches) {
  return flattenRetrievalApproaches(approaches).join("\n");
}

function finding(i, extra = {}) {
  return {
    url: extra.url || `https://blog.example.com/review-${i}`,
    title: extra.title || `Review ${i}`,
    type: extra.type || "blog",
    summary:
      extra.summary ||
      `${B} keeps ${HEROINE} safe and steps in when she is in danger. ${i}`,
  };
}

function searchResult({
  findings = [],
  rawUrls,
  parseStatus = "structured",
  retryUsed = false,
  webSearchCalls = 1,
  extra = {},
} = {}) {
  const raw = rawUrls ?? findings.map((f) => ({ url: f.url, title: f.title }));
  return {
    findings,
    rawUrls: raw,
    rawUrlCount: raw.length,
    parseStatus,
    retryUsed,
    webSearchCalls,
    inputTokens: extra.inputTokens ?? 200,
    outputTokens: extra.outputTokens ?? 80,
    retryInputTokens: extra.retryInputTokens ?? 0,
    retryOutputTokens: extra.retryOutputTokens ?? 0,
    retryCostUsd: extra.retryCostUsd ?? 0,
    searchQueries: extra.searchQueries ?? null,
    pairing: extra.pairing ?? null,
    costUsd: extra.costUsd,
  };
}

function protectiveJob(over = {}) {
  return {
    id: "followup-hero_protective_dynamic-r1-1",
    strategy: "hero_protective_dynamic",
    batchHint: "helteprofil",
    targetFields: [THAD, BODYGUARD, PROTECTIVE],
    userPrompt: `Find reader evidence about whether ${B} reacts violently when ${HEROINE} is hurt.`,
    queryHints: [`${B} touch her and die`],
    leadCharacters: resolvedLeads,
    series: { title: "The Ember Cycle", author: "A. Writer" },
    ...over,
  };
}

function assessment(over = {}) {
  return {
    score: 4,
    confidence: "medium",
    basis: "source_consensus",
    evidenceSourceIds: [],
    conflictingSourceIds: [],
    sourceCount: 0,
    sourceBatch: "helteprofil",
    reason: "",
    ...over,
  };
}

describe("C.1 retrieval approaches", () => {
  it("resolved MMC/FMC get named natural-language variants", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: resolvedLeads,
      targetFields: [PROTECTIVE, THAD],
      strategy: "hero_protective_dynamic",
      purpose: "field",
    });
    const blob = blobOf(approaches);
    assert.match(blob, new RegExp(B));
    assert.match(blob, new RegExp(HEROINE));
    assert.match(blob, /protects|keeps .* safe|protective relationship/i);
    assert.equal(approaches.named, true);
    assert.equal(/the series' central male romantic lead/i.test(blob), false);
  });

  it("unresolved identity uses generic lead wording", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: unresolvedLeads,
      targetFields: [PROTECTIVE],
      strategy: "hero_protective_dynamic",
      purpose: "field",
    });
    const blob = blobOf(approaches);
    assert.match(blob, /main romantic lead heroine|eventual romantic partner|central male romantic lead|the heroine/i);
    assert.equal(approaches.named, false);
    assert.match(blob, new RegExp(A));
  });

  it("THAD gets both trope and natural reader wording", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: resolvedLeads,
      targetFields: [THAD],
      strategy: "hero_protective_dynamic",
    });
    const blob = blobOf(approaches);
    assert.match(blob, /touch her and die|goes feral/i);
    assert.match(
      blob,
      /loses control when .* is hurt|reacts violently when .* is threatened|keeps .* safe|protects/i
    );
  });

  it("Rhysand-factor uses autonomy/equal/respect wording", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: resolvedLeads,
      targetFields: [RHYSAND],
      strategy: "hero_respect_agency",
    });
    const blob = blobOf(approaches);
    assert.match(blob, /respects .* choices/i);
    assert.match(blob, /supports .* independence|treats .* as an equal|protective without controlling/i);
  });

  it("FMC development uses natural growth wording", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Ember Cycle" },
      leadCharacters: resolvedLeads,
      targetFields: [FMC_DEV],
      strategy: "heroine_growth",
    });
    const blob = blobOf(approaches);
    assert.match(blob, /becomes more confident|character growth|own choices|comes into her power|gains independence/i);
  });
});

describe("C.1 yield + fallback execution", () => {
  it("usable first retrieval makes exactly one Responses execution", async () => {
    let calls = 0;
    const prompts = [];
    const result = await executeFocusedJobWithFallback({
      job: protectiveJob(),
      identity: { title: "The Ember Cycle", series: "The Ember Cycle" },
      remainingSearchCalls: 6,
      client: {},
      runSearch: async (_client, args) => {
        calls += 1;
        prompts.push(args.userPrompt);
        return searchResult({
          findings: [finding(1), finding(2), finding(3)],
        });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.fallbackTriggered, false);
    assert.equal(result.retrievalStatus, "primary_usable");
    assert.equal(result.retrievalAttempts.length, 1);
    assert.equal(/ALTERNATIVE search approaches/i.test(prompts[0]), false);
    assert.ok((protectiveJob().queryHints || []).length >= 1);
  });

  it("zero retrieval executes fallback exactly once", async () => {
    let calls = 0;
    const prompts = [];
    const result = await executeFocusedJobWithFallback({
      job: protectiveJob(),
      identity: { title: "The Ember Cycle" },
      remainingSearchCalls: 6,
      client: {},
      runSearch: async (_client, args) => {
        calls += 1;
        prompts.push(args.userPrompt);
        if (calls === 1) return searchResult({ findings: [], rawUrls: [] });
        return searchResult({ findings: [finding(1), finding(2), finding(3)] });
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.fallbackTriggered, true);
    assert.equal(result.retrievalStatus, "fallback_recovered");
    assert.equal(result.retrievalAttempts.length, 2);
    assert.equal(result.retrievalAttempts[1].strategy, "broad_fallback");
    assert.match(prompts[1], /relationship across the series|in danger|hurt|threatened|needs protection/i);
    assert.equal(/touch her and die/i.test(prompts[1]), false);
  });

  it("low retrieval executes fallback exactly once", async () => {
    let calls = 0;
    const result = await executeFocusedJobWithFallback({
      job: protectiveJob(),
      remainingSearchCalls: 4,
      client: {},
      runSearch: async () => {
        calls += 1;
        if (calls === 1) {
          return searchResult({ findings: [finding(1)], rawUrls: [{ url: finding(1).url }] });
        }
        return searchResult({ findings: [finding(2), finding(3), finding(4)] });
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.retrievalAttempts.length, 2);
  });

  it("fallback also zero: max 2 attempts total", async () => {
    let calls = 0;
    const result = await executeFocusedJobWithFallback({
      job: protectiveJob(),
      remainingSearchCalls: 6,
      client: {},
      runSearch: async () => {
        calls += 1;
        return searchResult({ findings: [], rawUrls: [] });
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.retrievalStatus, "retrieval_zero");
    assert.equal(result.retrievalAttempts.length, 2);
  });

  it("parse repair does not count as an extra retrieval attempt", async () => {
    let calls = 0;
    const result = await executeFocusedJobWithFallback({
      job: protectiveJob(),
      remainingSearchCalls: 6,
      client: {},
      runSearch: async () => {
        calls += 1;
        return searchResult({
          findings: [finding(1), finding(2), finding(3)],
          parseStatus: "repaired",
          retryUsed: true,
          extra: { retryInputTokens: 50, retryOutputTokens: 20, retryCostUsd: 0.0001 },
        });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.retryUsed, true);
    assert.equal(result.retrievalAttempts.length, 1);
    assert.equal(result.retrievalAttempts[0].webSearchCalls, 1);
    assert.ok(result.retryCostUsd > 0);
  });

  it("no fallback when search budget is exhausted after primary", async () => {
    let calls = 0;
    const result = await executeFocusedJobWithFallback({
      job: protectiveJob(),
      remainingSearchCalls: 1,
      client: {},
      runSearch: async () => {
        calls += 1;
        return searchResult({ findings: [], rawUrls: [] });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.fallbackTriggered, false);
    assert.equal(result.fallbackBlockedByBudget, true);
    assert.equal(result.retrievalStatus, "budget_blocked_fallback");
    assert.equal(canAffordRetrievalFallback({ remainingSearchCalls: 1, primaryWebSearchCalls: 1 }), false);
  });

  it("tracks fallback search cost separately", async () => {
    const result = await executeFocusedJobWithFallback({
      job: protectiveJob(),
      remainingSearchCalls: 6,
      client: {},
      runSearch: async (_c, args) => {
        const isFallback = /fallback/i.test(args.id);
        if (!isFallback) {
          return searchResult({
            findings: [],
            rawUrls: [],
            extra: { inputTokens: 1000, outputTokens: 400 },
          });
        }
        return searchResult({
          findings: [finding(1), finding(2), finding(3)],
          extra: { inputTokens: 2000, outputTokens: 800 },
        });
      },
    });
    assert.ok(result.primarySearchCostUsd > 0);
    assert.ok(result.fallbackSearchCostUsd > 0);
    assert.ok(result.totalSearchCostUsd > result.primarySearchCostUsd);
    assert.equal(
      Math.round(result.totalSearchCostUsd * 1e6),
      Math.round((result.primarySearchCostUsd + result.fallbackSearchCostUsd) * 1e6)
    );
    assert.ok(result.costUsd >= result.totalSearchCostUsd);
  });
});

describe("C.1 merge + diagnostics", () => {
  it("duplicate source from primary+fallback counts once", () => {
    const url = "https://blog.example.com/same";
    const merged = mergeRetrievalAttempts(
      searchResult({
        findings: [{ url, title: "Short", type: "blog", summary: "He protects her." }],
      }),
      searchResult({
        findings: [
          {
            url: `${url}/`,
            title: "Much richer review title about the pairing",
            type: "blog",
            summary:
              "He keeps her safe in later books and reacts violently when she is threatened, with concrete scene detail.",
          },
        ],
      })
    );
    assert.equal(merged.findings.length, 1);
    assert.equal(merged.rawUrls.length, 1);
  });

  it("richer metadata survives merge", () => {
    const url = "https://forum.example.com/thread";
    const merged = mergeRetrievalAttempts(
      {
        findings: [
          {
            url,
            title: "forum.example.com",
            type: "forum",
            summary: "Fundet via helteprofil-søgning",
            retrievalAttempt: 1,
          },
        ],
        rawUrls: [{ url }],
      },
      {
        findings: [
          {
            url,
            title: "Detailed reader discussion of the protective pairing",
            type: "forum",
            summary: "Longer independent review describing how he steps in when she is in danger.",
            retrievalAttempt: 2,
          },
        ],
        rawUrls: [{ url }],
      }
    );
    assert.equal(merged.findings.length, 1);
    assert.match(merged.findings[0].title, /Detailed reader discussion/i);
    assert.match(merged.findings[0].summary, /steps in when she is in danger/i);
  });

  it("primary+fallback dedupe uses canonical Reddit/Goodreads identity and strips tracking", () => {
    const reddit = mergeRetrievalAttempts(
      {
        findings: [
          {
            url: "https://old.reddit.com/r/RomanceBooks/comments/abc123/foo?utm_source=share",
            title: "Short",
            type: "forum",
            summary: "He protects her.",
          },
        ],
        rawUrls: [
          {
            url: "https://old.reddit.com/r/RomanceBooks/comments/abc123/foo?utm_source=share",
          },
        ],
      },
      {
        findings: [
          {
            url: "https://www.reddit.com/r/RomanceBooks/comments/abc123/bar",
            title: "Detailed Reddit thread about the pairing",
            type: "forum",
            summary:
              "Longer independent review describing how he steps in when she is in danger.",
          },
        ],
        rawUrls: [
          { url: "https://www.reddit.com/r/RomanceBooks/comments/abc123/bar" },
        ],
      }
    );
    assert.equal(reddit.findings.length, 1);
    assert.equal(reddit.rawUrls.length, 1);
    assert.match(reddit.findings[0].title, /Detailed Reddit thread/i);
    assert.match(reddit.findings[0].summary, /steps in when she is in danger/i);

    const goodreads = mergeRetrievalAttempts(
      {
        findings: [
          {
            url: "https://www.goodreads.com/book/show/12345-foo?utm_medium=email",
            title: "GR",
            type: "goodreads",
            summary: "Short pairing note.",
          },
        ],
        rawUrls: [
          { url: "https://www.goodreads.com/book/show/12345-foo?utm_medium=email" },
        ],
      },
      {
        findings: [
          {
            url: "https://goodreads.com/book/show/12345-foo-bar",
            title: "Richer Goodreads review of the central pairing",
            type: "goodreads",
            summary: "Much longer review of how he keeps her safe across later books.",
          },
        ],
        rawUrls: [{ url: "https://goodreads.com/book/show/12345-foo-bar" }],
      }
    );
    assert.equal(goodreads.findings.length, 1);
    assert.equal(goodreads.rawUrls.length, 1);
    assert.match(goodreads.findings[0].summary, /keeps her safe/i);
  });

  it("retrieval_zero / retrieved_but_irrelevant / no_new_unique_sources / fallback_recovered", () => {
    assert.equal(
      classifyEvidenceOutcome({
        retrievalStatus: "retrieval_zero",
        addedCount: 0,
        relevantCount: 0,
        rawUrlCount: 0,
        mergedCount: 0,
      }),
      "retrieval_zero"
    );
    assert.equal(
      classifyEvidenceOutcome({
        retrievalStatus: "primary_usable",
        addedCount: 4,
        relevantCount: 0,
        rawUrlCount: 9,
        mergedCount: 6,
      }),
      "retrieved_but_irrelevant"
    );
    assert.equal(
      classifyEvidenceOutcome({
        retrievalStatus: "fallback_recovered",
        addedCount: 0,
        relevantCount: 0,
        rawUrlCount: 8,
        mergedCount: 5,
      }),
      "no_new_unique_sources"
    );
    assert.equal(
      classifyEvidenceOutcome({
        retrievalStatus: "fallback_recovered",
        addedCount: 3,
        relevantCount: 2,
        rawUrlCount: 9,
        mergedCount: 6,
      }),
      "new_evidence"
    );
  });

  it("identity fallback uses identity-specific broadening", async () => {
    let calls = 0;
    const prompts = [];
    const job = {
      id: "identity-resolution-r0-1",
      strategy: "series_identity_resolution",
      purpose: "identity",
      userPrompt: "Find the central / endgame romantic pairing across the FULL SERIES.",
      leadCharacters: unresolvedLeads,
      series: { title: "The Ember Cycle", author: "A. Writer" },
    };
    const result = await executeFocusedJobWithFallback({
      job,
      identity: { title: "The Ember Cycle", series: "The Ember Cycle", isSeries: true },
      remainingSearchCalls: 6,
      client: {},
      runSearch: async (_c, args) => {
        calls += 1;
        prompts.push(args.userPrompt);
        if (calls === 1) return searchResult({ findings: [], rawUrls: [] });
        return searchResult({
          findings: [
            {
              url: "https://wiki.example.com/ember/romance",
              title: "Pairing",
              type: "blog",
              summary: "Later books establish Bram as endgame.",
            },
          ],
          extra: {
            pairing: { mmc: B, fmc: HEROINE, confidence: "high" },
          },
        });
      },
    });
    assert.equal(calls, 2);
    assert.match(prompts[1], /endgame|later books|FULL SERIES|spoiler/i);
    assert.equal(/touch her and die|goes feral/i.test(prompts[1]), false);
    assert.match(buildFallbackUserPrompt({ purpose: "identity", series: job.series }), /later books/i);
    assert.equal(result.retrievalAttempts.length, 2);
  });

  it("initial 4-batch does not get automatic extra calls", () => {
    const plan = buildSearchPlan({
      title: "Shadowbound",
      author: "Jane Doe",
    });
    assert.equal(plan.length, 4);
    assert.ok(plan.every((p) => !p.queryHints || p.queryHints.length === 0));
    const webResearchSrc = readFileSync(
      join(ROOT, "server/services/webResearch.js"),
      "utf8"
    );
    assert.equal(webResearchSrc.includes("executeFocusedJobWithFallback"), false);
    assert.equal(webResearchSrc.includes("assessRetrievalYield"), false);
    assert.equal(webResearchSrc.includes("runFocusedSearch(client, step)"), true);
  });

  it("extractWebSearchQueries is null-safe when action.query is missing", () => {
    assert.equal(
      extractWebSearchQueries({
        output: [{ type: "web_search_call", action: { sources: [{ url: "https://x.example" }] } }],
      }),
      null
    );
    assert.deepEqual(
      extractWebSearchQueries({
        output: [
          { type: "web_search_call", action: { query: "heroine endgame couple" } },
        ],
      }),
      ["heroine endgame couple"]
    );
  });

  it("planner queryHints stay diversified and identity-safe", () => {
    const jobs = planFollowUpResearch({
      identity: { title: "The Ember Cycle", series: "The Ember Cycle", isSeries: true },
      research: {
        sources: [
          {
            id: "source-1",
            summary: `Later books establish ${B} as ${HEROINE}'s central/endgame partner.`,
            url: "https://wiki.example.com/ember",
            type: "blog",
          },
        ],
        reviewConsensus: { notes: `between ${HEROINE} and ${B}` },
      },
      assessments: Object.fromEntries(
        SUBJECTIVE_KEYS.map((k) => [
          k,
          assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
        ])
      ),
    });
    const protective = jobs.find((j) => j.strategy === "hero_protective_dynamic");
    assert.ok(protective);
    const hints = (protective.queryHints || []).join(" ");
    assert.match(hints, new RegExp(B));
    assert.match(hints, /protects|keeps .* safe|touch her and die|loses control/i);
    assert.match(protective.userPrompt, new RegExp(B));
  });
});

describe("C.1 evidence guards remain in force", () => {
  it("alternative MMC evidence still does not lift target coverage", () => {
    const identity = {
      mmc: B,
      fmc: HEROINE,
      confidence: "high",
      resolution: { resolved: true, reason: "series_pairing_confirmed" },
    };
    const ctx = { leadCharacters: identity, identity: { series: "The Ember Cycle" } };
    const sources = Array.from({ length: 10 }, (_, i) => ({
      id: `alt-${i + 1}`,
      url: `https://forum.example.com/alt${i + 1}`,
      type: "forum",
      title: "Protective",
      summary: `${A} becomes extremely protective of ${HEROINE} and tries to keep her safe.`,
      targetFields: [PROTECTIVE],
    }));
    const after = calculateFieldCoverage({
      field: PROTECTIVE,
      assessment: assessment({
        evidenceSourceIds: sources.map((s) => s.id),
        basis: "source_consensus",
        confidence: "high",
      }),
      research: { sources, seriesIdentity: identity },
      leadCharacters: identity,
    });
    assert.equal(after.directEvidenceCount, 0);
    assert.equal(after.supportingEvidenceCount, 0);
    assert.ok(after.coverageScore <= 25, `wrong-subject coverage ${after.coverageScore}`);
    assert.equal(
      sources.filter((s) =>
        isFollowUpSourceRelevant(s, [{ targetFields: [PROTECTIVE] }], ctx)
      ).length,
      0
    );
  });

  it("generic powerful/ruthless evidence is not Bodyguard/THAD direct", () => {
    const job = { fields: [BODYGUARD, THAD], strategy: "hero_protective_dynamic" };
    const prepared = prepareFollowUpSources(
      Array.from({ length: 5 }, (_, i) => ({
        url: `https://blog${i}.example.com/character`,
        type: "blog",
        title: "Character profile",
        summary: "He is powerful, ruthless, dangerous, and a wingleader.",
      })),
      job,
      1
    );
    assert.equal(prepared.length, 5);
    const relevant = prepared.filter((s) =>
      isFollowUpSourceRelevant({ ...s, id: "tmp" }, [job])
    );
    assert.equal(relevant.length, 0);
    for (const s of prepared) {
      const ev = evaluateSourceForField({
        source: { ...s, id: "tmp" },
        field: THAD,
      });
      assert.equal(isFieldSpecificEvidence(ev), false);
      assert.ok(["contextual", "none"].includes(ev.relevance), ev.relevance);
    }
  });

  it("loop copies retrieval diagnostics onto job/round trace", async () => {
    const identity = {
      title: "Shadowbound",
      author: "Jane Doe",
      firstBook: "Shadowbound",
    };
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: {
        identity,
        sources: [],
        reviewConsensus: {},
        observations: [],
        facts: {},
        ratings: {},
        meta: { estimatedCostUsd: 0.1, webSearchCalls: 4, inputTokens: 1, outputTokens: 1 },
      },
      initialAnalysis: {
        meta: {
          assessments: Object.fromEntries(
            SUBJECTIVE_KEYS.map((k) => [
              k,
              assessment({ basis: "ai_inference", score: 3, evidenceSourceIds: [] }),
            ])
          ),
        },
      },
      options: {
        maxAdditionalWebSearchCalls: 6,
        executeFollowUpJob: async ({ remainingSearchCalls }) => {
          assert.equal(typeof remainingSearchCalls, "number");
          return {
            sources: [],
            rawUrls: [],
            webSearchCalls: 2,
            costUsd: 0.02,
            parseStatus: "structured",
            retrievalStatus: "retrieval_zero",
            fallbackTriggered: true,
            retrievalAttempts: [
              {
                attempt: 1,
                strategy: "primary",
                rawUrlCount: 0,
                mergedCount: 0,
                preparedCount: 0,
                parseStatus: "structured",
                webSearchCalls: 1,
              },
              {
                attempt: 2,
                strategy: "broad_fallback",
                rawUrlCount: 0,
                mergedCount: 0,
                preparedCount: 0,
                parseStatus: "structured",
                webSearchCalls: 1,
              },
            ],
          };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => ({ meta: { assessments: {} } }),
      },
    });
    const round = result.adaptive.rounds[0];
    assert.ok(round);
    assert.equal(round.jobs[0].retrievalStatus, "retrieval_zero");
    assert.equal(round.evidenceOutcome, "retrieval_zero");
    assert.equal(round.fallbackTriggered, true);
    const retrieval = summarizeRetrieval(result.adaptive);
    assert.ok(retrieval.zeroRetrievalRate > 0);
    assert.ok(retrieval.fallbackRate > 0);
  });
});

describe("C.1 yield helper", () => {
  it("classifies zero / low / usable conservatively", () => {
    assert.deepEqual(assessRetrievalYield({ rawUrlCount: 0, mergedCount: 0, preparedCount: 0 }).level, "zero");
    assert.equal(assessRetrievalYield({ rawUrlCount: 0, mergedCount: 0, preparedCount: 0 }).shouldFallback, true);
    assert.equal(assessRetrievalYield({ rawUrlCount: 2, mergedCount: 1, preparedCount: 1 }).level, "low");
    assert.equal(assessRetrievalYield({ rawUrlCount: 9, mergedCount: 6, preparedCount: 5 }).level, "usable");
    assert.equal(assessRetrievalYield({ rawUrlCount: 9, mergedCount: 6, preparedCount: 5 }).shouldFallback, false);
  });
});

describe("cleanup 0.1 dead helpers", () => {
  it("removed helpers have no remaining callers", () => {
    const files = [
      "server/services/searchRetrieval.js",
      "server/services/evidenceRelevance.js",
      "server/services/webResearch.js",
      "server/services/adaptiveResearch.js",
      "server/services/adaptiveResearchLoop.js",
      "server/services/researchBenchmark.js",
    ];
    const blob = files
      .map((rel) => readFileSync(join(ROOT, rel), "utf8"))
      .join("\n");
    assert.equal(blob.includes("formatRetrievalApproachHints"), false);
    assert.equal(blob.includes("countRelevance"), false);
    assert.equal(blob.includes("adaptiveFollowUp"), false);
  });
});
