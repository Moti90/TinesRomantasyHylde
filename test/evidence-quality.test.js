import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateFieldCoverage,
  isSubjectiveCoverageQuality,
  subjectiveSourceQuality,
} from "../server/services/adaptiveResearch.js";
import {
  evaluateEvidenceQualityForField,
  fieldQualityClass,
} from "../server/services/evidenceQuality.js";
import {
  criticalFieldStopQualitySatisfied,
  evaluateSourceForField,
  isFieldSpecificEvidence,
} from "../server/services/evidenceRelevance.js";
import { detectFailureFlags } from "../server/services/researchBenchmark.js";
import {
  buildJobSourceFlow,
  classifyDraftEvidence,
  subjectRejectedCount,
  summarizeSourceFlow,
} from "../server/services/sourceFlow.js";
import { subjectIdentityFrom } from "../server/services/sourceSubject.js";
import { ADAPTIVE_VERSION } from "../server/services/versions.js";

const THAD = "Touch her and die-vibe (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const RHYSAND = "Rhysand-faktoren";
const FMC_DEV = "Kvindelig udvikling (0-5)";
const HANGOVER = "Book hangover (0-5)";
const B = "Bram";
const HEROINE = "Elowen";
const ALT = "Aldric";

const leads = {
  mmc: B,
  fmc: HEROINE,
  confidence: "high",
  resolution: { resolved: true, reason: "series_pairing_confirmed" },
  alternatives: [{ name: ALT, role: "early_love_interest" }],
};

function ctx() {
  return {
    leadCharacters: leads,
    identity: { title: "The Ember Cycle" },
    ...subjectIdentityFrom({}, {}, { leadCharacters: leads }),
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

function coverageOf(field, sources, extra = {}) {
  return calculateFieldCoverage({
    field,
    assessment: assessment({
      evidenceSourceIds: sources.map((s) => s.id),
      ...extra.assessment,
    }),
    research: {
      sources,
      seriesIdentity: leads,
    },
    identity: { title: "The Ember Cycle" },
    leadCharacters: leads,
  });
}

function fandom(id, summary, extra = {}) {
  return {
    id,
    title: extra.title || `Guide ${id}`,
    url: extra.url || `https://ember.fandom.com/wiki/${id}`,
    type: extra.type || "other",
    summary,
    ...extra,
  };
}

function blog(id, summary, extra = {}) {
  return {
    id,
    title: extra.title || `Review ${id}`,
    url: extra.url || `https://books.example.com/review/${id}`,
    type: extra.type || "blog",
    summary,
    ...extra,
  };
}

describe("C.1.3 field-aware evidence quality", () => {
  it("field classes come from handbook fields, not series names", () => {
    assert.equal(fieldQualityClass(PROTECTIVE), "behavior");
    assert.equal(fieldQualityClass(BODYGUARD), "behavior");
    assert.equal(fieldQualityClass(THAD), "behavior");
    assert.equal(fieldQualityClass(RHYSAND), "relationship");
    assert.equal(fieldQualityClass(HANGOVER), "reader_experience");
    assert.equal(fieldQualityClass(FMC_DEV), "fmc_development");
    assert.equal(ADAPTIVE_VERSION, "adaptive-v9");
  });

  it("1. generic fandom character bio gives no Protective/Bodyguard/THAD coverage", () => {
    const source = fandom(
      "bio",
      `${B} is High Lord of the night court. He is powerful, ruthless, and dangerous.`
    );
    for (const field of [PROTECTIVE, BODYGUARD, THAD]) {
      const ev = evaluateSourceForField({ source, field, context: ctx() });
      assert.ok(["contextual", "none"].includes(ev.relevance), field);
      const q = evaluateEvidenceQualityForField({
        source,
        field,
        relevance: ev.relevance,
      });
      assert.equal(q.eligible, false);
      const cov = coverageOf(field, [source]);
      assert.equal(cov.directEvidenceCount, 0);
      assert.equal(cov.supportingEvidenceCount, 0);
      assert.ok(cov.coverageScore <= 25, `${field} ${cov.coverageScore}`);
    }
  });

  it("2. fandom with concrete target-MMC protective action is usable/reduced", () => {
    const source = fandom(
      "protect",
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    assert.ok(subjectiveSourceQuality(source) < 0.5);
    assert.equal(isSubjectiveCoverageQuality(source), false);
    const ev = evaluateSourceForField({
      source,
      field: PROTECTIVE,
      context: ctx(),
    });
    assert.ok(["direct", "supporting"].includes(ev.relevance));
    const q = evaluateEvidenceQualityForField({
      source,
      field: PROTECTIVE,
      relevance: ev.relevance,
    });
    assert.equal(q.eligible, true);
    assert.equal(q.qualityTier, "usable");
    assert.equal(q.coverageBucket, "supporting");
    const cov = coverageOf(PROTECTIVE, [source]);
    assert.equal(cov.directEvidenceCount, 0);
    assert.equal(cov.supportingEvidenceCount, 1);
    assert.ok(cov.coverageScore > 8);
  });

  it("3. study guide with concrete autonomy/equal-partner claim can support relationship", () => {
    const source = fandom(
      "agency",
      `${B} respects her agency and treats ${HEROINE} as an equal partner.`,
      { url: "https://www.sparknotes.com/lit/ember-cycle/characters/" }
    );
    const ev = evaluateSourceForField({
      source,
      field: RHYSAND,
      context: ctx(),
    });
    assert.ok(["direct", "supporting"].includes(ev.relevance), ev.relevance);
    const q = evaluateEvidenceQualityForField({
      source,
      field: RHYSAND,
      relevance: ev.relevance,
    });
    assert.equal(q.fieldClass, "relationship");
    assert.equal(q.eligible, true);
    assert.equal(q.qualityTier, "usable");
    const cov = coverageOf(RHYSAND, [source]);
    assert.equal(cov.directEvidenceCount, 0);
    assert.ok(cov.supportingEvidenceCount >= 1);
  });

  it("4. study guide alone must not give high critical stop-quality", () => {
    const source = fandom(
      "solo",
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const cov = coverageOf(PROTECTIVE, [source]);
    assert.equal(cov.stopQualitySatisfied, false);
    assert.equal(
      criticalFieldStopQualitySatisfied({
        directSources: [],
        supportingSources: [source],
        score: 4,
      }),
      false
    );
  });

  it("5. Reddit reader discussion is strong for reader-experience fields", () => {
    const source = {
      id: "reddit-hangover",
      url: "https://reddit.com/r/RomanceBooks/comments/hang111/ember",
      type: "forum",
      title: "Still thinking about it",
      summary: `Book hangover for days. I couldn't put the book down after ${HEROINE} and ${B} finally reunited.`,
    };
    const ev = evaluateSourceForField({
      source,
      field: HANGOVER,
      context: ctx(),
    });
    assert.ok(["direct", "supporting"].includes(ev.relevance), ev.relevance);
    const q = evaluateEvidenceQualityForField({
      source,
      field: HANGOVER,
      relevance: ev.relevance,
    });
    assert.equal(q.qualityTier, "strong");
    assert.equal(q.eligible, true);
    assert.equal(q.coverageBucket, ev.relevance);
    const cov = coverageOf(HANGOVER, [source]);
    assert.ok(cov.directEvidenceCount + cov.supportingEvidenceCount >= 1);
    assert.equal(cov.readerReviewEvidence, true);
  });

  it("6. fandom about emotional impact without reader evidence is ineligible", () => {
    const source = fandom(
      "hangover",
      `Readers mention a book hangover and couldn't put the book down after the finale.`
    );
    const ev = evaluateSourceForField({
      source,
      field: HANGOVER,
      context: ctx(),
    });
    assert.ok(["direct", "supporting"].includes(ev.relevance), ev.relevance);
    const q = evaluateEvidenceQualityForField({
      source,
      field: HANGOVER,
      relevance: ev.relevance,
    });
    assert.equal(q.eligible, false);
    assert.equal(q.reason, "reader_experience_wrong_role");
    const cov = coverageOf(HANGOVER, [source]);
    assert.equal(cov.directEvidenceCount, 0);
    assert.equal(cov.supportingEvidenceCount, 0);
  });

  it("7. Goodreads discussion with THAD scene + correct MMC can be strong/direct", () => {
    const source = {
      id: "gr-thad",
      url: "https://www.goodreads.com/review/show/ember-thad",
      type: "goodreads",
      summary: `${B} goes feral whenever ${HEROINE} is threatened. Touch her and die energy throughout.`,
    };
    const ev = evaluateSourceForField({ source, field: THAD, context: ctx() });
    assert.ok(isFieldSpecificEvidence(ev), ev.relevance);
    const q = evaluateEvidenceQualityForField({
      source,
      field: THAD,
      relevance: ev.relevance,
    });
    assert.equal(q.qualityTier, "strong");
    if (ev.relevance === "direct") {
      assert.equal(q.coverageBucket, "direct");
    }
    const cov = coverageOf(THAD, [source]);
    if (ev.relevance === "direct") {
      assert.equal(cov.directEvidenceCount, 1);
    } else {
      assert.equal(cov.supportingEvidenceCount, 1);
    }
  });

  it("8. alternative MMC protective source is still 0 after subject validation", () => {
    const source = fandom(
      "alt",
      `${ALT} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const ev = evaluateSourceForField({
      source,
      field: PROTECTIVE,
      context: ctx(),
    });
    assert.equal(isFieldSpecificEvidence(ev), false);
    const q = evaluateEvidenceQualityForField({
      source,
      field: PROTECTIVE,
      relevance: ev.relevance,
    });
    assert.equal(q.eligible, false);
    const cov = coverageOf(PROTECTIVE, [source]);
    assert.equal(cov.directEvidenceCount, 0);
    assert.equal(cov.supportingEvidenceCount, 0);
  });

  it("9. powerful/ruthless/morally-grey generic stays contextual/none", () => {
    const source = blog(
      "grey",
      `${B} is morally grey, powerful, ruthless, and dangerous.`
    );
    const prot = evaluateSourceForField({
      source,
      field: PROTECTIVE,
      context: ctx(),
    });
    const rhys = evaluateSourceForField({
      source,
      field: RHYSAND,
      context: ctx(),
    });
    assert.ok(["contextual", "none"].includes(prot.relevance));
    assert.ok(["contextual", "none"].includes(rhys.relevance));
    assert.equal(coverageOf(PROTECTIVE, [source]).directEvidenceCount, 0);
    assert.equal(coverageOf(RHYSAND, [source]).directEvidenceCount, 0);
  });

  it("10. identity-purpose source is not automatic field evidence", () => {
    const source = fandom(
      "pairing",
      `${B} repeatedly protects ${HEROINE} and steps between her and danger. ${HEROINE} and ${B} are the central romantic pairing.`,
      { purpose: "identity" }
    );
    const ev = evaluateSourceForField({
      source,
      field: PROTECTIVE,
      context: ctx(),
    });
    const q = evaluateEvidenceQualityForField({
      source,
      field: PROTECTIVE,
      relevance: ev.relevance,
    });
    assert.equal(q.eligible, false);
    assert.equal(q.reason, "identity_only");
    const cov = coverageOf(PROTECTIVE, [source]);
    assert.equal(cov.directEvidenceCount, 0);
    assert.equal(cov.supportingEvidenceCount, 0);
  });

  it("11. multiple same-domain usable sources do not fake diversity or stop-quality", () => {
    const sources = [1, 2, 3].map((i) =>
      fandom(
        `copy-${i}`,
        `${B} repeatedly protects ${HEROINE} and steps between her and danger.`,
        { url: `https://ember.fandom.com/wiki/Hero${i}` }
      )
    );
    const cov = coverageOf(PROTECTIVE, sources);
    assert.equal(cov.directEvidenceCount, 0);
    assert.ok(cov.supportingEvidenceCount >= 1);
    assert.equal(cov.independentDomains, 1);
    assert.ok(cov.reasons.includes("same_domain_stacking"));
    assert.equal(cov.stopQualitySatisfied, false);
  });

  it("12. existing high-quality review/blog behavior does not regress", () => {
    const source = blog(
      "hq",
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const ev = evaluateSourceForField({
      source,
      field: PROTECTIVE,
      context: ctx(),
    });
    assert.equal(ev.relevance, "direct");
    const q = evaluateEvidenceQualityForField({
      source,
      field: PROTECTIVE,
      relevance: ev.relevance,
    });
    assert.equal(q.qualityTier, "strong");
    assert.equal(q.coverageBucket, "direct");
    const cov = coverageOf(PROTECTIVE, [source]);
    assert.equal(cov.directEvidenceCount, 1);
    assert.ok(cov.coverageScore >= 25);
  });

  it("13. C.1.2 sourceFlow reports strong/usable/ineligible counts", () => {
    const strong = blog(
      "s",
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const usable = fandom(
      "u",
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    const ineligible = fandom(
      "i",
      `Book hangover; readers couldn't put the book down.`
    );
    const flow = buildJobSourceFlow({
      prepared: [strong, usable, ineligible],
      returnedFindings: [strong, usable, ineligible],
      mergedDraftsBeforeCap: [strong, usable, ineligible],
      rawUrls: [strong, usable, ineligible],
      targetFields: [PROTECTIVE, HANGOVER],
      context: ctx(),
    });
    assert.equal(flow.qualityStrongCount, 1);
    assert.equal(flow.qualityUsableCount, 1);
    assert.equal(flow.qualityIneligibleCount, 1);
    assert.equal(flow.coverageContributingCount, 2);
    assert.equal(flow.dropReasons.readerExperienceWrongRole, 1);
    const summary = summarizeSourceFlow([flow]);
    assert.equal(summary.qualityStrongCount, 1);
    assert.equal(summary.qualityUsableCount, 1);
    assert.equal(summary.qualityIneligibleCount, 1);
  });

  it("14. SUBJECT_REJECTION_HEAVY numerator cannot exceed fieldRelevant", () => {
    assert.equal(subjectRejectedCount(12, 12), 0);
    assert.equal(subjectRejectedCount(12, 0), 12);
    assert.ok(subjectRejectedCount(12, 17) <= 12);
    const mixed = classifyDraftEvidence(
      blog(
        "mix",
        `${B} repeatedly protects ${HEROINE} and steps between her and danger. Also a morally grey court.`
      ),
      { targetFields: [PROTECTIVE, RHYSAND], context: ctx() }
    );
    assert.equal(mixed.fieldRelevant, true);
    assert.equal(mixed.subjectValid, true);
    const flow = buildJobSourceFlow({
      prepared: [
        blog(
          "ok",
          `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
        ),
        blog("ctx", `${B} is a powerful High Lord.`),
      ],
      returnedFindings: [],
      mergedDraftsBeforeCap: [],
      rawUrls: [],
      targetFields: [PROTECTIVE, RHYSAND],
      context: ctx(),
    });
    assert.ok(flow.dropReasons.wrongSubject <= flow.fieldRelevantCount);
    const inflated = {
      fieldRelevantCount: 12,
      subjectValidCount: 12,
      coverageEligibleCount: 4,
      dropReasons: { wrongSubject: 10, ambiguousSubject: 7, lowCoverageQuality: 0 },
    };
    const summary = summarizeSourceFlow([inflated]);
    assert.equal(summary.subjectRejectedCount, 0);
    assert.ok(summary.subjectRejectedCount <= summary.fieldRelevantCount);
    const flags = detectFailureFlags({
      baseline: { weightedCoverage: 10 },
      adaptive: {
        research: { sources: [] },
        analysis: { meta: { assessments: {} } },
      },
      fields: [],
      remainingGaps: [],
      adaptiveMeta: {
        rounds: [{ jobs: [{ sourceFlow: inflated }] }],
      },
    });
    assert.equal(
      flags.some((f) => f.code === "SUBJECT_REJECTION_HEAVY"),
      false
    );
    const heavy = detectFailureFlags({
      baseline: { weightedCoverage: 10 },
      adaptive: {
        research: { sources: [] },
        analysis: { meta: { assessments: {} } },
      },
      fields: [],
      remainingGaps: [],
      adaptiveMeta: {
        rounds: [
          {
            jobs: [
              {
                sourceFlow: {
                  fieldRelevantCount: 12,
                  subjectValidCount: 4,
                  coverageEligibleCount: 1,
                  dropReasons: { wrongSubject: 8, ambiguousSubject: 0 },
                },
              },
            ],
          },
        ],
      },
    });
    const flag = heavy.find((f) => f.code === "SUBJECT_REJECTION_HEAVY");
    assert.ok(flag);
    assert.match(flag.detail, /^8\/12 /);
  });

  it("study guide FMC development can be usable supporting, not auto-direct", () => {
    const source = fandom(
      "fmc",
      `The heroine's growth is central. ${HEROINE} becomes more independent and grows in confidence.`
    );
    const ev = evaluateSourceForField({
      source,
      field: FMC_DEV,
      context: ctx(),
    });
    assert.ok(isFieldSpecificEvidence(ev), ev.relevance);
    const q = evaluateEvidenceQualityForField({
      source,
      field: FMC_DEV,
      relevance: ev.relevance,
    });
    assert.equal(q.qualityTier, "usable");
    assert.equal(q.coverageBucket, "supporting");
    const cov = coverageOf(FMC_DEV, [source]);
    assert.equal(cov.directEvidenceCount, 0);
    assert.ok(cov.supportingEvidenceCount >= 1);
  });
});
