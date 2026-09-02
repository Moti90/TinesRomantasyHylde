import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSubjectiveCoverageQuality,
  subjectiveSourceQuality,
} from "../server/services/adaptiveResearch.js";
import {
  executeFocusedJobWithFallback,
  prepareFollowUpSources,
} from "../server/services/adaptiveResearchLoop.js";
import {
  aggregateRoundSourceFlow,
  buildJobSourceFlow,
  classifyDraftEvidence,
  emptySourceFlow,
  flowRatio,
  summarizeSourceFlow,
} from "../server/services/sourceFlow.js";
import { subjectIdentityFrom } from "../server/services/sourceSubject.js";
import { buildSearchPlan } from "../server/services/webResearch.js";
import { ADAPTIVE_VERSION } from "../server/services/versions.js";

const THAD = "Touch her and die-vibe (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";
const B = "Bram";
const HEROINE = "Elowen";
const ALT = "Aldric";

const resolvedLeads = {
  mmc: B,
  fmc: HEROINE,
  confidence: "high",
  resolution: { resolved: true, reason: "series_pairing_confirmed" },
};

function ctx(leads = resolvedLeads) {
  return {
    leadCharacters: leads,
    identity: { title: "The Ember Cycle" },
    ...subjectIdentityFrom({}, {}, { leadCharacters: leads }),
  };
}

function blog(i, summary, extra = {}) {
  return {
    url: extra.url || `https://blog.example.com/review-${i}`,
    title: extra.title || `Review ${i}`,
    type: extra.type || "blog",
    summary,
    ...extra,
  };
}

const TARGETS = [PROTECTIVE, BODYGUARD, THAD, RHYSAND, FMC_DEV];

describe("C.1.2 source flow observability", () => {
  it("A. 12 merged → cap 8 with 2 capped field-relevant", () => {
    const drafts = Array.from({ length: 12 }, (_, i) =>
      blog(
        i,
        i === 8 || i === 9
          ? `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
          : "A generic series recap about court politics and magic systems."
      )
    );
    const flow = buildJobSourceFlow({
      rawUrls: drafts,
      modelFindingCount: 12,
      mergedDraftsBeforeCap: drafts,
      returnedFindings: drafts.slice(0, 8),
      prepared: drafts.slice(0, 8),
      cappedDrafts: drafts.slice(8),
      targetFields: TARGETS,
      context: ctx(),
    });
    assert.equal(flow.mergedBeforeCapCount, 12);
    assert.equal(flow.returnedFindingCount, 8);
    assert.equal(flow.cappedCount, 4);
    assert.equal(flow.cappedFieldRelevantCount, 2);
    assert.equal(flow.dropReasons.cappedBeforePrepare, 4);
  });

  it("B. field direct + correct subject + quality 1 is coverage eligible", () => {
    const source = blog(
      1,
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const classified = classifyDraftEvidence(source, {
      targetFields: [PROTECTIVE, BODYGUARD],
      context: ctx(),
    });
    assert.equal(classified.fieldRelevant, true);
    assert.equal(classified.subjectValid, true);
    assert.equal(classified.coverageEligible, true);
    assert.equal(isSubjectiveCoverageQuality(source), true);
    const flow = buildJobSourceFlow({
      rawUrls: [source],
      modelFindingCount: 1,
      mergedDraftsBeforeCap: [source],
      returnedFindings: [source],
      prepared: [source],
      targetFields: [PROTECTIVE, BODYGUARD],
      context: ctx(),
    });
    assert.equal(flow.fieldRelevantCount, 1);
    assert.equal(flow.subjectValidCount, 1);
    assert.equal(flow.coverageEligibleCount, 1);
  });

  it("C. field direct + wrong subject", () => {
    const source = blog(
      2,
      `${ALT} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const classified = classifyDraftEvidence(source, {
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(classified.fieldRelevant, true);
    assert.equal(classified.subjectValid, false);
    assert.equal(classified.wrongSubject, true);
    const flow = buildJobSourceFlow({
      prepared: [source],
      returnedFindings: [source],
      mergedDraftsBeforeCap: [source],
      rawUrls: [source],
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(flow.fieldRelevantCount, 1);
    assert.equal(flow.subjectValidCount, 0);
    assert.equal(flow.dropReasons.wrongSubject, 1);
    assert.equal(flow.coverageEligibleCount, 0);
  });

  it("D. study guide with concrete protective action is usable coverage", () => {
    const source = {
      url: "https://ember.fandom.com/wiki/Hero",
      title: "Hero",
      type: "other",
      summary: `${B} repeatedly protects ${HEROINE} and steps between her and danger.`,
    };
    assert.ok(subjectiveSourceQuality(source) < 0.5);
    assert.equal(isSubjectiveCoverageQuality(source), false);
    const classified = classifyDraftEvidence(source, {
      targetFields: [PROTECTIVE, BODYGUARD],
      context: ctx(),
    });
    assert.equal(classified.fieldRelevant, true);
    assert.equal(classified.subjectValid, true);
    assert.equal(classified.coverageEligible, true);
    assert.equal(classified.qualityTier, "usable");
    const flow = buildJobSourceFlow({
      prepared: [source],
      returnedFindings: [source],
      mergedDraftsBeforeCap: [source],
      rawUrls: [source],
      targetFields: [PROTECTIVE, BODYGUARD],
      context: ctx(),
    });
    assert.equal(flow.dropReasons.lowCoverageQuality, 0);
    assert.equal(flow.coverageEligibleCount, 1);
    assert.equal(flow.qualityUsableCount, 1);
    assert.equal(flow.dropReasons.studyGuideDemoted, 1);
  });

  it("E. contextual generic source is not field-relevant", () => {
    const source = blog(3, `${B} is High Lord of the Night Court.`);
    const classified = classifyDraftEvidence(source, {
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(classified.fieldRelevant, false);
    const flow = buildJobSourceFlow({
      prepared: [source],
      returnedFindings: [source],
      mergedDraftsBeforeCap: [source],
      rawUrls: [source],
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(flow.fieldRelevantCount, 0);
    assert.equal(flow.dropReasons.fieldIrrelevant, 1);
  });

  it("F. duplicate primary/fallback canonical count is 1", () => {
    const source = blog(
      4,
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const altHost = {
      ...source,
      url: "https://www.blog.example.com/review-4?utm_source=share",
    };
    const flow = buildJobSourceFlow({
      rawUrls: [source, altHost],
      modelFindingCount: 2,
      mergedDraftsBeforeCap: [source, altHost],
      returnedFindings: [source, altHost],
      prepared: [source, altHost],
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(flow.preparedCount, 1);
    assert.equal(flow.rawUrlCount, 1);
    assert.equal(flow.fieldRelevantCount, 1);
  });

  it("G. empty flow is zeros and ratios are null", () => {
    const flow = emptySourceFlow();
    assert.equal(flow.rawUrlCount, 0);
    assert.equal(flow.fieldRelevantCount, 0);
    const summary = summarizeSourceFlow([flow]);
    assert.equal(summary.rawToReturnedRate, null);
    assert.equal(summary.returnedToFieldRelevantRate, null);
    assert.equal(flowRatio(0, 0), null);
    assert.equal(flowRatio(1, 0), null);
  });

  it("H. initial 4-batch plan is unchanged", () => {
    const plan = buildSearchPlan({
      title: "The Ember Cycle",
      author: "A. Writer",
    });
    assert.equal(plan.length, 4);
    assert.deepEqual(
      plan.map((p) => p.id),
      ["helteprofil", "romanceprofil", "plotkarakter", "helhed"]
    );
    assert.equal(ADAPTIVE_VERSION, "adaptive-v12");
  });

  it("I. C.1 fallback still triggers once on zero retrieval", async () => {
    let calls = 0;
    const result = await executeFocusedJobWithFallback({
      job: {
        id: "followup-hero_protective_dynamic-r1-1",
        strategy: "hero_protective_dynamic",
        targetFields: [PROTECTIVE],
        batchHint: "helteprofil",
        userPrompt: "Find reader evidence.",
        queryHints: ['"The Ember Cycle" protective'],
        leadCharacters: resolvedLeads,
      },
      identity: { title: "The Ember Cycle", series: "The Ember Cycle" },
      remainingSearchCalls: 6,
      client: {},
      runSearch: async () => {
        calls += 1;
        return {
          findings: [],
          rawUrls: [],
          rawUrlCount: 0,
          modelFindingCount: 0,
          mergedBeforeCapCount: 0,
          returnedFindingCount: 0,
          cappedCount: 0,
          webSearchCalls: 1,
          parseStatus: "structured",
        };
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.fallbackTriggered, true);
    assert.ok(result.sourceFlow);
    assert.equal(result.sourceFlow.preparedCount, 0);
  });

  it("J. wrong-subject coverage guard still rejects alternative MMC", () => {
    const source = blog(
      5,
      `${ALT} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const classified = classifyDraftEvidence(source, {
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    assert.equal(classified.fieldRelevant, true);
    assert.equal(classified.subjectValid, false);
    assert.equal(classified.coverageEligible, false);
  });

  it("round aggregate prefers canonical unique keys", () => {
    const source = blog(
      6,
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const flow = buildJobSourceFlow({
      rawUrls: [source],
      mergedDraftsBeforeCap: [source],
      returnedFindings: [source],
      prepared: [source],
      targetFields: [PROTECTIVE],
      context: ctx(),
    });
    const round = aggregateRoundSourceFlow([
      { sourceFlow: flow },
      { sourceFlow: flow },
    ]);
    assert.equal(round.unique, true);
    assert.equal(round.prepared, 1);
    assert.equal(round.fieldRelevant, 1);
  });

  it("prepareFollowUpSources still keeps field-specific fandom", () => {
    const kept = {
      title: "Character analysis",
      url: "https://ember.fandom.com/wiki/Hero",
      type: "other",
      summary: `${B} repeatedly protects ${HEROINE}.`,
    };
    const prepared = prepareFollowUpSources([kept], {
      targetFields: [PROTECTIVE],
      batchHint: "helteprofil",
      strategy: "hero_protective_dynamic",
      leadCharacters: resolvedLeads,
    }, 1);
    assert.equal(prepared.length, 1);
  });
});
