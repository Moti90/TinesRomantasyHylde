import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  evaluateSourceForField,
  hasTargetFieldSignal,
  isFieldSpecificEvidence,
} from "../server/services/evidenceRelevance.js";
import { selectValuableSources } from "../server/services/webResearch.js";
import {
  debugSourceEvidenceTrace,
  isFollowUpSourceRelevant,
  runAdaptiveResearch,
} from "../server/services/adaptiveResearchLoop.js";

const THAD = "Touch her and die-vibe (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const RHYSAND = "Rhysand-faktoren";
const HEROINE = "Kvindelig udvikling (0-5)";

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
  return Object.fromEntries(SUBJECTIVE_KEYS.map((k) => [k, assessment()]));
}

const identity = {
  title: "The Ember Cycle",
  author: "A. Writer",
  series: "The Ember Cycle",
  firstBook: "Ember One",
  isSeries: true,
};

function researchWith(sources) {
  return {
    identity: { title: identity.title, author: identity.author },
    sources,
    reviewConsensus: {},
    facts: {},
    ratings: {},
    meta: { webSearchCalls: 4, estimatedCostUsd: 0.09, warnings: [] },
  };
}

const stablePairing = [
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

describe("B.1.2 evidence flow", () => {
  it("field-specific fandom source is retained in adaptive follow-up selection", () => {
    const field = PROTECTIVE;
    const kept = {
      title: "Character analysis",
      url: "https://ember.fandom.com/wiki/Hero",
      type: "other",
      batch: "helteprofil",
      summary:
        "The male lead exhibits protective behavior towards the heroine and repeatedly steps between her and danger.",
      targetFields: [field],
    };
    const generic = Array.from({ length: 3 }, (_, i) => ({
      title: `Bio ${i}`,
      url: `https://ember.fandom.com/wiki/Extra${i}`,
      type: "other",
      batch: "helteprofil",
      summary: "A named character in the series with a court title.",
      targetFields: [field],
    }));
    const selected = selectValuableSources([kept, ...generic], {
      adaptiveFollowUp: true,
      targetFields: [field],
    });
    assert.ok(
      selected.some((s) => /wiki\/Hero/i.test(s.url)),
      "field-specific fandom source should be kept"
    );
    assert.equal(hasTargetFieldSignal(kept, [field]), true);
    assert.equal(hasTargetFieldSignal(generic[0], [field]), false);
  });

  it("generic fandom bio remains contextual or droppable", () => {
    const src = {
      id: "source-fan",
      title: "Character bio",
      url: "https://ember.fandom.com/wiki/HeroBio",
      type: "other",
      summary: "The male lead is High Lord of the night court.",
      targetFields: [PROTECTIVE, BODYGUARD, THAD],
    };
    const ev = evaluateSourceForField({ source: src, field: PROTECTIVE });
    assert.ok(["contextual", "none"].includes(ev.relevance), ev.relevance);
    assert.equal(isFieldSpecificEvidence(ev), false);
    assert.equal(
      isFollowUpSourceRelevant(src, [{ targetFields: [PROTECTIVE, BODYGUARD] }]),
      false
    );
  });

  it("Rhysand-factor supporting vs contextual", () => {
    const supporting = {
      id: "s-r1",
      url: "https://blog.example.com/equal",
      type: "blog",
      summary:
        "The male lead supports the heroine's autonomy, respects her decisions, and treats her as an equal.",
    };
    const grey = {
      id: "s-r2",
      url: "https://blog.example.com/grey",
      type: "blog",
      summary: "The male lead is powerful and morally grey.",
    };
    const evA = evaluateSourceForField({ source: supporting, field: RHYSAND });
    const evB = evaluateSourceForField({ source: grey, field: RHYSAND });
    assert.ok(["direct", "supporting"].includes(evA.relevance), evA.relevance);
    assert.ok(["contextual", "none"].includes(evB.relevance), evB.relevance);
  });

  it("Protective / Bodyguard / THAD distinction", () => {
    const watch = {
      id: "s-p1",
      url: "https://blog.example.com/watch",
      type: "blog",
      summary:
        "He repeatedly steps between her and danger. He keeps watch over her.",
    };
    const brutal = {
      id: "s-p2",
      url: "https://blog.example.com/brutal",
      type: "blog",
      summary: "He brutally attacks anyone who threatens her.",
    };
    const prot = evaluateSourceForField({ source: watch, field: PROTECTIVE });
    const bg = evaluateSourceForField({ source: watch, field: BODYGUARD });
    const thad = evaluateSourceForField({ source: watch, field: THAD });
    assert.equal(prot.relevance, "direct");
    assert.ok(["direct", "supporting"].includes(bg.relevance), bg.relevance);
    assert.ok(["none", "contextual"].includes(thad.relevance), thad.relevance);

    const prot2 = evaluateSourceForField({ source: brutal, field: PROTECTIVE });
    const thad2 = evaluateSourceForField({ source: brutal, field: THAD });
    assert.equal(prot2.relevance, "direct");
    assert.equal(thad2.relevance, "direct");
  });

  it("source trace reports drop stage and field matches", () => {
    const src = {
      id: "source-x",
      url: "https://ember.fandom.com/wiki/Hero",
      type: "other",
      title: "Hero analysis",
      summary:
        "He exhibits protective behavior towards the heroine and supports her autonomy.",
      targetFields: [PROTECTIVE, RHYSAND],
    };
    const jobs = [{ targetFields: [PROTECTIVE, RHYSAND, THAD] }];
    const trace = debugSourceEvidenceTrace(src, jobs);
    assert.equal(trace.select.kept, true);
    assert.ok(trace.fields[PROTECTIVE]);
    assert.ok(["direct", "supporting"].includes(trace.fields[PROTECTIVE].relevance));
    assert.ok(["direct", "supporting"].includes(trace.fields[RHYSAND].relevance));
    assert.equal(trace.countsAsNewRelevant, true);
    assert.equal(trace.contentOverride, true);
  });

  it("identity-purpose is not automatically field-relevant", () => {
    const src = {
      id: "source-id",
      url: "https://wiki.example.com/ember/romance",
      type: "blog",
      purpose: "identity",
      summary:
        "Later books establish Bram as the heroine's central/endgame partner. Lysa remains the heroine.",
      targetFields: [],
    };
    const jobs = [{ targetFields: [PROTECTIVE, BODYGUARD, THAD, RHYSAND] }];
    assert.equal(isFollowUpSourceRelevant(src, jobs), false);
    assert.equal(hasTargetFieldSignal(src, [PROTECTIVE, RHYSAND]), false);
  });

  it("2 field-specific + 3 contextual => newRelevantSources 2 and re-analysis", async () => {
    let synthesized = false;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith(stablePairing),
      initialAnalysis: {
        meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
      },
      options: {
        maxFollowUpRounds: 1,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            return { sources: [], webSearchCalls: 0, costUsd: 0 };
          }
          return {
            sources: [
              {
                url: "https://blog.example.com/protect-1",
                type: "blog",
                title: "Protective review",
                summary:
                  "Aldric exhibits protective behavior towards Elowen and keeps her safe.",
                targetFields: job.targetFields,
              },
              {
                url: "https://blog.example.com/equal-1",
                type: "blog",
                title: "Equal partner",
                summary:
                  "Aldric supports Elowen's autonomy and treats her as an equal.",
                targetFields: job.targetFields,
              },
              {
                url: "https://blog.example.com/grey-1",
                type: "blog",
                title: "Grey hero",
                summary: "He is powerful and morally grey.",
                targetFields: job.targetFields,
              },
              {
                url: "https://blog.example.com/grey-2",
                type: "blog",
                title: "Dangerous",
                summary: "A dangerous, ruthless wingleader.",
                targetFields: job.targetFields,
              },
              {
                url: "https://blog.example.com/grey-3",
                type: "blog",
                title: "Bio",
                summary: "Court politics and a named male lead.",
                targetFields: job.targetFields,
              },
            ],
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async () => {
          synthesized = true;
          return { parsed: { sources: stablePairing } };
        },
        analyze: async () => ({
          meta: { assessments: weakAssessments(), estimatedCostUsd: 0.01 },
        }),
      },
    });
    const fieldRound = (result.adaptive.rounds || []).find((r) => r.round >= 1);
    assert.ok(fieldRound);
    assert.equal(fieldRound.newSources, 5);
    assert.equal(fieldRound.newRelevantSources, 2);
    assert.equal(synthesized, true);
    assert.ok(fieldRound.evidenceTrace);
    assert.equal(fieldRound.evidenceTrace.directCount + fieldRound.evidenceTrace.supportingCount, 2);
  });

  it("0 relevant contextual sources skip re-analysis", async () => {
    let synthesized = false;
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: researchWith(stablePairing),
      initialAnalysis: {
        meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
      },
      options: {
        maxFollowUpRounds: 1,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            return { sources: [], webSearchCalls: 0, costUsd: 0 };
          }
          return {
            sources: Array.from({ length: 5 }, (_, i) => ({
              url: `https://blog.example.com/generic-${i}`,
              type: "blog",
              title: `Character profile ${i}`,
              summary: `A powerful and ruthless wingleader. Dangerous hero number ${i} with a court title.`,
              targetFields: job.targetFields,
            })),
            webSearchCalls: 1,
            costUsd: 0.01,
          };
        },
        synthesize: async () => {
          synthesized = true;
          throw new Error("should not re-analyze contextual-only sources");
        },
        analyze: async () => {
          throw new Error("should not analyze");
        },
      },
    });
    const fieldRound = (result.adaptive.rounds || []).find((r) => r.round >= 1);
    assert.ok(fieldRound);
    assert.equal(fieldRound.newSources, 5);
    assert.equal(fieldRound.newRelevantSources, 0);
    assert.equal(synthesized, false);
    assert.equal(result.adaptive.stopReason, "no_new_evidence");
  });

  it("heroine growth wording can count for Kvindelig udvikling", () => {
    const src = {
      id: "s-g",
      url: "https://blog.example.com/growth",
      type: "blog",
      summary:
        "The heroine grows in confidence and agency. The relationship supports her development.",
    };
    const ev = evaluateSourceForField({ source: src, field: HEROINE });
    assert.ok(["direct", "supporting"].includes(ev.relevance), ev.relevance);
  });
});
