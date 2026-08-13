import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  assessSeriesIdentityResolution,
  calculateFieldCoverage,
  confirmIdentityHint,
  planFollowUpResearch,
} from "../server/services/adaptiveResearch.js";
import {
  evaluateSourceForField,
  isFieldSpecificEvidence,
} from "../server/services/evidenceRelevance.js";
import { isFollowUpSourceRelevant } from "../server/services/adaptiveResearchLoop.js";
import {
  collectWrongSubjectEvidence,
  detectFailureFlags,
  FAILURE_FLAGS,
} from "../server/services/researchBenchmark.js";
import {
  characterNameMentionedInText,
  evaluateSourceSubject,
  namesReferToSamePerson,
  normalizeCharacterIdentityName,
} from "../server/services/sourceSubject.js";

const THAD = "Touch her and die-vibe (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const RHYSAND = "Rhysand-faktoren";
const HEROINE_DEV = "Kvindelig udvikling (0-5)";
const ROMANCE = "Romance i fokus (0-100%)";

const A = "Aldric";
const B = "Bram";
const HEROINE = "Elowen";

const identity = {
  mmc: B,
  fmc: HEROINE,
  alternatives: [{ name: A, role: "early_love_interest" }],
};

const ctx = {
  mmc: B,
  fmc: HEROINE,
  alternatives: identity.alternatives,
  leadCharacters: identity,
};

function src(id, summary, extra = {}) {
  return {
    id,
    title: extra.title || `Source ${id}`,
    summary,
    url: extra.url || `https://forum.example.com/${id}`,
    type: extra.type || "forum",
    batch: extra.batch || "helteprofil",
    targetFields: extra.targetFields,
    ...extra,
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

function weakAssessments() {
  return Object.fromEntries(
    SUBJECTIVE_KEYS.map((k) => [
      k,
      assessment({
        score: 2,
        confidence: "low",
        basis: "ai_inference",
        evidenceSourceIds: [],
      }),
    ])
  );
}

function ev(source, field) {
  return evaluateSourceForField({ source, field, context: ctx });
}

describe("B.1.3 subject-aware evidence", () => {
  it("wrong MMC protective is rejected for target B", () => {
    const source = src(
      "alt-prot",
      `${A} becomes extremely protective of ${HEROINE}.`
    );
    assert.equal(evaluateSourceSubject(source, identity).subjectStatus, "alternative");
    assert.equal(isFieldSpecificEvidence(ev(source, PROTECTIVE)), false);
    assert.equal(ev(source, PROTECTIVE).subjectRejectionReason, "FIELD_MATCH_ALTERNATIVE_CHARACTER");
    assert.equal(isFieldSpecificEvidence(ev(source, BODYGUARD)), false);
    assert.equal(isFieldSpecificEvidence(ev(source, THAD)), false);
  });

  it("target MMC protective is accepted", () => {
    const source = src(
      "tgt-prot",
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`
    );
    assert.equal(evaluateSourceSubject(source, identity).subjectStatus, "target");
    assert.equal(ev(source, PROTECTIVE).relevance, "direct");
    assert.equal(ev(source, PROTECTIVE).subjectReason, "FIELD_MATCH_TARGET_MMC");
    assert.ok(
      ["direct", "supporting"].includes(ev(source, BODYGUARD).relevance),
      ev(source, BODYGUARD).relevance
    );
  });

  it("wrong MMC autonomy is rejected", () => {
    const source = src("alt-aut", `${A} respects ${HEROINE}'s decisions.`);
    assert.equal(isFieldSpecificEvidence(ev(source, RHYSAND)), false);
    assert.equal(ev(source, RHYSAND).subjectRejectionReason, "FIELD_MATCH_ALTERNATIVE_CHARACTER");
  });

  it("target MMC autonomy is accepted", () => {
    const source = src(
      "tgt-aut",
      `${B} respects ${HEROINE}'s decisions, encourages her power, and treats her as an equal.`
    );
    assert.equal(evaluateSourceSubject(source, identity).subjectStatus, "target");
    assert.ok(
      ["direct", "supporting"].includes(ev(source, RHYSAND).relevance),
      ev(source, RHYSAND).relevance
    );
  });

  it("FMC-only development is accepted without MMC", () => {
    const source = src(
      "fmc-dev",
      `${HEROINE} becomes more confident, independent and powerful throughout the series.`,
      { batch: "plotkarakter" }
    );
    const subject = evaluateSourceSubject(source, identity);
    assert.equal(subject.subjectStatus, "target_fmc");
    const heroineEv = ev(source, HEROINE_DEV);
    assert.ok(
      ["direct", "supporting"].includes(heroineEv.relevance),
      heroineEv.relevance
    );
    assert.equal(isFieldSpecificEvidence(ev(source, PROTECTIVE)), false);
  });

  it("mixed A/B source is conservative for MMC fields", () => {
    const source = src(
      "mixed",
      `${A} wants to keep ${HEROINE} confined for her safety, while ${B} repeatedly respects her choices and supports her independence.`
    );
    const subject = evaluateSourceSubject(source, identity);
    assert.equal(subject.subjectStatus, "mixed");
    const prot = ev(source, PROTECTIVE);
    assert.notEqual(prot.relevance, "direct");
    const rhys = ev(source, RHYSAND);
    assert.ok(
      ["direct", "supporting"].includes(rhys.relevance),
      `Rhysand-factor ${rhys.relevance}`
    );
  });

  it("negative evidence about the target is accepted", () => {
    const source = src(
      "neg-tgt",
      `${B} is not especially protective of ${HEROINE}.`
    );
    const prot = ev(source, PROTECTIVE);
    assert.equal(prot.relevance, "direct");
    assert.equal(prot.polarity, "negative");
  });

  it("negative evidence about an alternative is rejected for B", () => {
    const source = src("neg-alt", `${A} is not protective.`);
    assert.equal(isFieldSpecificEvidence(ev(source, PROTECTIVE)), false);
  });

  it("pronoun-only source is ambiguous, not auto-bound", () => {
    const source = src(
      "pronoun",
      "He becomes extremely protective of her."
    );
    assert.equal(evaluateSourceSubject(source, identity).subjectStatus, "ambiguous");
    assert.equal(isFieldSpecificEvidence(ev(source, PROTECTIVE)), false);
    assert.equal(ev(source, PROTECTIVE).subjectRejectionReason, "FIELD_MATCH_AMBIGUOUS_SUBJECT");
  });

  it("title establishes subject context for pronouns", () => {
    const source = src(
      "title-ctx",
      "He becomes extremely protective of her and tries to keep her safe.",
      { title: `${B} Character Analysis` }
    );
    assert.equal(evaluateSourceSubject(source, identity).subjectStatus, "target");
    assert.ok(isFieldSpecificEvidence(ev(source, PROTECTIVE)));
  });

  it("Feyre vs Feyre Archeron normalization is conservative", () => {
    assert.equal(namesReferToSamePerson("Feyre", "Feyre Archeron"), true);
    assert.equal(namesReferToSamePerson("Feyre", "Feyre Cursebreaker"), true);
    assert.equal(namesReferToSamePerson("Ann", "Anna"), false);
    assert.equal(namesReferToSamePerson("Rhys", "Rhysand"), false);
    assert.equal(characterNameMentionedInText("Feyre is the heroine", "Feyre Archeron"), true);
    assert.equal(characterNameMentionedInText("Anna arrives", "Ann"), false);
    const n = normalizeCharacterIdentityName("Feyre Archeron");
    assert.equal(n.given, "feyre");
  });

  it("identity hint confirmation after name normalization", () => {
    const leads = {
      mmc: B,
      fmc: "Feyre",
      confidence: "low",
      basis: ["endgame_partner"],
      seriesLevelSignals: ["endgame_partner"],
      alternatives: [{ name: A, role: "early_love_interest" }],
    };
    const research = {
      identityHint: {
        mmc: B,
        fmc: "Feyre Archeron",
        confidence: "high",
        basis: ["central_pairing", "endgame"],
      },
      sources: [
        {
          id: "source-id",
          purpose: "identity",
          title: `${B} and Feyre Archeron endgame pairing`,
          summary: `Later books establish ${B} and Feyre as the central/endgame couple.`,
          url: "https://wiki.example.com/pairing",
          type: "blog",
        },
      ],
    };
    const confirmation = confirmIdentityHint(leads, { research });
    assert.equal(confirmation.hintAgrees, true);
    assert.equal(confirmation.identityHintConfirmed, true);
    const resolved = assessSeriesIdentityResolution(leads, {
      identity: { series: "The Ember Cycle", isSeries: true },
      research,
    });
    assert.equal(resolved.resolution.identityHintConfirmed, true);
    assert.equal(resolved.resolution.resolved, true);
  });

  it("resolved identity planner uses character names", () => {
    const research = {
      identityHint: {
        mmc: B,
        fmc: HEROINE,
        confidence: "high",
        basis: ["central_pairing", "endgame"],
      },
      sources: [
        {
          id: "source-id",
          purpose: "identity",
          title: "Series pairing guide",
          url: "https://wiki.example.com/ember/romance",
          type: "blog",
          summary: `Later books establish ${B} as ${HEROINE}'s central/endgame partner. ${A} is an early love interest.`,
        },
      ],
    };
    const jobs = planFollowUpResearch({
      identity: { title: "The Ember Cycle", series: "The Ember Cycle", isSeries: true },
      research,
      assessments: weakAssessments(),
    });
    assert.ok(jobs.length >= 1);
    assert.equal(jobs[0].leadCharacters.resolution.resolved, true);
    const blob = jobs.map((j) => `${j.userPrompt} ${(j.queryHints || []).join(" ")}`).join(" ");
    assert.match(blob, new RegExp(B));
    assert.match(blob, new RegExp(HEROINE));
    assert.equal(/seriens centrale mandlige romantiske lead/i.test(blob), false);
    assert.ok(jobs.some((j) => (j.queryHints || []).some((h) => /protective/i.test(h))));
  });

  it("unresolved planner remains generic", () => {
    const research = {
      sources: [
        {
          id: "source-1",
          title: "Book 1 blurb",
          url: "https://publisher.example.com/ember-one",
          type: "blog",
          summary: `Book 1: romance between ${HEROINE} and ${A}. ${A} is the male love interest in the first book. Some readers also mention ${B}.`,
        },
      ],
    };
    const jobs = planFollowUpResearch({
      identity: { title: "The Ember Cycle", series: "The Ember Cycle", isSeries: true },
      research,
      assessments: weakAssessments(),
    });
    assert.ok(jobs.length >= 1);
    assert.equal(jobs[0].leadCharacters.resolution.resolved, false);
    const prompt = jobs.map((j) => j.userPrompt).join(" ");
    assert.match(prompt, /centrale mandlige romantiske lead|heltinden/i);
    const hints = jobs.flatMap((j) => j.queryHints || []).join(" ");
    assert.match(hints, /main romantic lead heroine|eventual romantic partner/i);
  });

  it("newRelevantSources ignores wrong-subject field matches", () => {
    const source = src(
      "wrong-rel",
      `${A} becomes extremely protective of ${HEROINE} and keeps her safe.`,
      { targetFields: [PROTECTIVE, BODYGUARD, THAD] }
    );
    assert.equal(
      isFollowUpSourceRelevant(source, [{ targetFields: [PROTECTIVE, BODYGUARD] }], ctx),
      false
    );
    const good = src(
      "good-rel",
      `${B} repeatedly protects ${HEROINE} and steps between her and danger.`,
      { targetFields: [PROTECTIVE, BODYGUARD] }
    );
    assert.equal(
      isFollowUpSourceRelevant(good, [{ targetFields: [PROTECTIVE, BODYGUARD] }], ctx),
      true
    );
  });

  it("coverage ignores 10 alternative-MMC protective sources", () => {
    const sources = Array.from({ length: 10 }, (_, i) =>
      src(
        `alt-${i + 1}`,
        `${A} becomes extremely protective of ${HEROINE} and tries to keep her safe.`,
        { url: `https://forum.example.com/alt${i + 1}` }
      )
    );
    const research = {
      sources,
      seriesIdentity: {
        ...identity,
        confidence: "high",
        resolution: { resolved: true, reason: "series_pairing_confirmed" },
      },
    };
    const empty = calculateFieldCoverage({
      field: PROTECTIVE,
      assessment: assessment({
        evidenceSourceIds: [],
        basis: "source_consensus",
        confidence: "high",
      }),
      research: { sources: [], seriesIdentity: research.seriesIdentity },
      leadCharacters: identity,
    });
    const after = calculateFieldCoverage({
      field: PROTECTIVE,
      assessment: assessment({
        evidenceSourceIds: sources.map((s) => s.id),
        basis: "source_consensus",
        confidence: "high",
      }),
      research,
      leadCharacters: identity,
    });
    assert.equal(after.directEvidenceCount, 0);
    assert.equal(after.supportingEvidenceCount, 0);
    assert.ok(
      after.coverageScore <= 25,
      `wrong-subject coverage ${after.coverageScore}`
    );
    assert.ok(
      after.coverageScore - empty.coverageScore < 8,
      `coverage rose ${empty.coverageScore} → ${after.coverageScore}`
    );
    assert.equal(
      sources.filter((s) =>
        isFollowUpSourceRelevant(s, [{ targetFields: [PROTECTIVE] }], ctx)
      ).length,
      0
    );
  });

  it("valid target evidence increases Protective coverage", () => {
    const sources = [
      src(
        "b1",
        `${B} repeatedly protects ${HEROINE} and steps between her and danger.`,
        { url: "https://reddit.com/r/RomanceBooks/comments/bprot111/one" }
      ),
      src(
        "b2",
        `${B} is fiercely protective of ${HEROINE} and keeps her safe.`,
        { url: "https://blog.example.com/bram-protects" }
      ),
      src(
        "b3",
        `${B} looks after ${HEROINE} with protective behavior throughout the later books.`,
        { url: "https://www.goodreads.com/review/show/bramprot" }
      ),
    ];
    const research = {
      sources,
      seriesIdentity: {
        ...identity,
        confidence: "high",
        resolution: { resolved: true, reason: "series_pairing_confirmed" },
      },
    };
    const before = calculateFieldCoverage({
      field: PROTECTIVE,
      assessment: assessment({
        evidenceSourceIds: [],
        basis: "ai_inference",
        confidence: "low",
      }),
      research: { sources: [], seriesIdentity: research.seriesIdentity },
      leadCharacters: identity,
    });
    const after = calculateFieldCoverage({
      field: PROTECTIVE,
      assessment: assessment({
        evidenceSourceIds: sources.map((s) => s.id),
        basis: "source_consensus",
        confidence: "high",
      }),
      research,
      leadCharacters: identity,
    });
    assert.ok(after.directEvidenceCount >= 1, `direct=${after.directEvidenceCount}`);
    assert.ok(
      after.coverageScore > before.coverageScore,
      `${before.coverageScore} → ${after.coverageScore}`
    );
    assert.ok(
      sources.every((s) =>
        isFollowUpSourceRelevant(s, [{ targetFields: [PROTECTIVE] }], ctx)
      )
    );
  });

  it("conflict does not mix two different characters", () => {
    const alt = src("c-alt", `${A} becomes extremely protective of ${HEROINE}.`);
    const tgt = src(
      "c-tgt",
      `${B} respects ${HEROINE}'s decisions and treats her as an equal.`
    );
    const cov = calculateFieldCoverage({
      field: PROTECTIVE,
      assessment: assessment({
        evidenceSourceIds: [tgt.id],
        conflictingSourceIds: [alt.id],
        basis: "source_consensus",
      }),
      research: {
        sources: [alt, tgt],
        seriesIdentity: { ...identity, confidence: "high" },
      },
      leadCharacters: identity,
    });
    assert.equal(cov.conflictLevel, "none");
    assert.equal(cov.conflictCount, 0);
  });

  it("relationship evidence requires the target pairing", () => {
    const SPICE = "Spice/erotik (0-5)";
    const good = src(
      "pair-good",
      `${B} and ${HEROINE} develop an equal partnership based on trust.`
    );
    const bad = src(
      "pair-bad",
      `${A} and ${HEROINE} have intense chemistry and steamy open door scenes.`
    );
    assert.ok(["direct", "supporting"].includes(ev(good, RHYSAND).relevance));
    assert.equal(isFieldSpecificEvidence(ev(bad, SPICE)), false);
    assert.equal(isFieldSpecificEvidence(ev(bad, ROMANCE)), false);
  });

  it("benchmark WRONG_SUBJECT_EVIDENCE flag", () => {
    assert.ok(FAILURE_FLAGS.includes("WRONG_SUBJECT_EVIDENCE"));
    const research = {
      seriesIdentity: { ...identity, confidence: "high" },
      sources: [
        src("w1", `${A} becomes extremely protective of ${HEROINE}.`),
        src("w2", `${A} keeps ${HEROINE} safe like a bodyguard.`),
      ],
    };
    const wrong = collectWrongSubjectEvidence({
      research,
      leadCharacters: identity,
    });
    assert.ok(wrong.wrongSubjectEvidenceCount >= 1, String(wrong.wrongSubjectEvidenceCount));
    assert.equal(wrong.examples[0].targetSubject, B);
    const flags = detectFailureFlags({
      baseline: { weightedCoverage: 20 },
      adaptive: {
        research,
        metrics: { weightedCoverage: 22, criticalFieldsBelowMinimum: [] },
        analysis: { meta: { assessments: {} } },
      },
      fields: [],
      characters: { status: "match", expected: { mmc: B, fmc: HEROINE } },
      adaptiveMeta: { rounds: [], additionalCostUsd: 0.01 },
      remainingGaps: [],
      wrongSubjectEvidence: wrong,
    });
    assert.ok(flags.some((f) => f.code === "WRONG_SUBJECT_EVIDENCE"));
  });
});
