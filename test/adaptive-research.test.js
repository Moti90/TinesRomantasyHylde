import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS, getTineFieldWeight } from "../server/services/decisionScores.js";
import {
  ADAPTIVE_MAX_JOBS_PER_ROUND,
  ADAPTIVE_VERSION,
} from "../server/services/versions.js";
import {
  analyzeResearchNeeds,
  calculateEvidenceDiversity,
  calculateFieldCoverage,
  calculateGapPriority,
  calculateResearchCoverage,
  detectResearchGaps,
  findSourceById,
  planFollowUpResearch,
  resolveSourceIdentity,
  sourceIdentityKey,
  summarizeAdaptiveIntelligence,
} from "../server/services/adaptiveResearch.js";
import { canonicalizeUrl, sourceDedupeKey } from "../server/services/webResearch.js";

const THAD = "Touch her and die-vibe (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const RHYSAND = "Rhysand-faktoren";
const WAR = "Krig/militær (0-5)";
const WORLD = "Worldbuilding (0-5)";

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

function assessmentsFor(map) {
  const out = {};
  for (const key of SUBJECTIVE_KEYS) {
    out[key] = assessment({
      score: 3,
      basis: "source_consensus",
      confidence: "medium",
      evidenceSourceIds: [],
      sourceBatch: "helteprofil",
      ...(map[key] || {}),
    });
  }
  return out;
}

function researchWith(sources, extra = {}) {
  return {
    identity: { title: "A Court of Thorns and Roses", author: "Sarah J. Maas" },
    sources,
    reviewConsensus: {},
    ...extra,
  };
}

describe("adaptive source identity", () => {
  it("bruger canonical URL / dedupe-key, ikke array-index", () => {
    const a = source("source-1", {
      url: "https://www.reddit.com/r/RomanceBooks/comments/abc123/foo?utm_source=share",
      type: "forum",
    });
    const b = source("source-99", {
      url: "https://old.reddit.com/r/RomanceBooks/comments/abc123/bar",
      type: "forum",
    });
    assert.equal(sourceIdentityKey(a), sourceIdentityKey(b));
    assert.equal(sourceDedupeKey(a.url), sourceDedupeKey(b.url));
    assert.equal(canonicalizeUrl(a.url).includes("reddit.com"), true);
    assert.notEqual(resolveSourceIdentity(a).sourceId, resolveSourceIdentity(b).sourceId);
  });

  it("resolver evidence IDs via source.id, ikke position", () => {
    const research = researchWith([
      source("source-2", {
        url: "https://blog.example.com/unrelated",
        summary: "worldbuilding only",
        type: "blog",
      }),
      source("source-1", {
        url: "https://reviews.example.net/bodyguard",
        summary: "He acts as her personal guard and keeps her safe.",
        type: "blog",
      }),
    ]);
    const found = findSourceById(research, "source-1");
    assert.equal(found.url.includes("bodyguard"), true);
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({ evidenceSourceIds: ["source-1"] }),
      research,
    });
    assert.equal(cov.directEvidenceCount, 1);
    assert.equal(cov.uniqueUrls, 1);
  });

  it("tæller samme canonical URL kun én gang", () => {
    const sources = [
      source("source-1", {
        url: "https://www.goodreads.com/book/show/12345-foo?utm_medium=email",
        type: "goodreads",
        summary: "He goes feral whenever she is threatened.",
      }),
      source("source-2", {
        url: "https://goodreads.com/book/show/12345-foo-bar",
        type: "goodreads",
        summary: "He goes feral whenever she is threatened.",
      }),
    ];
    const diversity = calculateEvidenceDiversity(sources);
    assert.equal(diversity.uniqueUrls, 1);
    assert.equal(diversity.independentIdentities, 1);

    const cov = calculateFieldCoverage({
      field: THAD,
      assessment: assessment({
        evidenceSourceIds: ["source-1", "source-2"],
      }),
      research: researchWith(sources),
    });
    assert.equal(
      cov.directEvidenceCount + cov.supportingEvidenceCount,
      1,
      "canonical Goodreads book page counts once, as usable supporting"
    );
  });
});

describe("adaptive field coverage", () => {
  it("0 evidence + insufficient => meget lav coverage", () => {
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        score: null,
        basis: "insufficient",
        confidence: "low",
        sourceCount: 0,
      }),
      research: researchWith([]),
    });
    assert.ok(cov.coverageScore <= 12, `got ${cov.coverageScore}`);
    assert.ok(cov.reasons.includes("insufficient"));
    assert.ok(cov.reasons.includes("no_direct_evidence"));
  });

  it("0 evidence + ai_inference => meget lav coverage", () => {
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        score: 4,
        basis: "ai_inference",
        confidence: "low",
        sourceCount: 8,
      }),
      research: researchWith([
        source("source-1", {
          url: "https://example.com/a",
          summary: "Great worldbuilding and politics.",
          type: "blog",
        }),
      ]),
    });
    assert.ok(cov.coverageScore <= 15, `got ${cov.coverageScore}`);
    assert.ok(cov.reasons.includes("ai_inference"));
    assert.ok(cov.reasons.includes("no_direct_evidence"));
  });

  it("1 direct relevant source => weak/moderate", () => {
    const research = researchWith([
      source("source-1", {
        url: "https://reddit.com/r/RomanceBooks/comments/aaa111/thread",
        type: "forum",
        summary: "He keeps her safe and acts like a bodyguard.",
      }),
    ]);
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        evidenceSourceIds: ["source-1"],
        confidence: "low",
      }),
      research,
    });
    assert.ok(cov.coverageScore >= 25, `got ${cov.coverageScore}`);
    assert.ok(cov.coverageScore <= 55, `got ${cov.coverageScore}`);
    assert.equal(cov.directEvidenceCount, 1);
  });

  it("2 direct sources same domain => bedre, men same-domain limiter", () => {
    const one = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({ evidenceSourceIds: ["source-1"], confidence: "medium" }),
      research: researchWith([
        source("source-1", {
          url: "https://reddit.com/r/RomanceBooks/comments/aaa111/one",
          type: "forum",
          summary: "He keeps her safe and acts like a bodyguard.",
        }),
      ]),
    });
    const two = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        evidenceSourceIds: ["source-1", "source-2"],
        confidence: "medium",
      }),
      research: researchWith([
        source("source-1", {
          url: "https://reddit.com/r/RomanceBooks/comments/aaa111/one",
          type: "forum",
          summary: "He keeps her safe and acts like a bodyguard.",
        }),
        source("source-2", {
          url: "https://reddit.com/r/RomanceBooks/comments/bbb222/two",
          type: "forum",
          summary: "Assigned to protect her as a personal guard.",
        }),
      ]),
    });
    const diverse = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        evidenceSourceIds: ["source-1", "source-2", "source-3"],
        confidence: "high",
        basis: "source_consensus",
      }),
      research: researchWith([
        source("source-1", {
          url: "https://reddit.com/r/RomanceBooks/comments/aaa111/one",
          type: "forum",
          summary: "He keeps her safe and acts like a bodyguard.",
        }),
        source("source-2", {
          url: "https://www.goodreads.com/review/show/999",
          type: "goodreads",
          summary: "Watching over her constantly, personal guard energy.",
        }),
        source("source-3", {
          url: "https://bookblog.example.com/acotr-review",
          type: "blog",
          summary: "He shields her and was assigned to protect her.",
        }),
      ]),
    });
    assert.ok(two.coverageScore > one.coverageScore, `${two.coverageScore} vs ${one.coverageScore}`);
    assert.ok(two.reasons.includes("same_domain_stacking"));
    assert.ok(diverse.coverageScore > two.coverageScore);
    assert.ok(diverse.coverageScore >= 75, `diverse got ${diverse.coverageScore}`);
  });

  it("3 batch sources men 0 relevant evidence => stadig lav coverage", () => {
    const research = researchWith([
      source("source-1", {
        url: "https://a.example.com/1",
        type: "blog",
        batch: "helteprofil",
        summary: "Lush worldbuilding and court politics.",
      }),
      source("source-2", {
        url: "https://b.example.com/2",
        type: "blog",
        batch: "helteprofil",
        summary: "Epic plot and war scenes.",
      }),
      source("source-3", {
        url: "https://c.example.com/3",
        type: "forum",
        batch: "helteprofil",
        summary: "Great magic system.",
      }),
    ]);
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        basis: "ai_inference",
        sourceCount: 10,
        evidenceSourceIds: [],
      }),
      research,
    });
    assert.ok(cov.coverageScore <= 25, `got ${cov.coverageScore}`);
    assert.equal(cov.directEvidenceCount, 0);
  });

  it("low score + 3 negative evidence sources => HIGH coverage", () => {
    const research = researchWith([
      source("source-1", {
        url: "https://reddit.com/r/RomanceBooks/comments/neg111/one",
        type: "forum",
        summary: "She protects herself. He is not protective, no guardian dynamic.",
      }),
      source("source-2", {
        url: "https://www.goodreads.com/review/show/neg2",
        type: "goodreads",
        summary: "No bodyguard vibe — she keeps herself safe.",
      }),
      source("source-3", {
        url: "https://reviews.example.org/not-a-guardian",
        type: "blog",
        summary: "He is not assigned to protect her; she is the fighter.",
      }),
    ]);
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        score: 0.5,
        confidence: "high",
        basis: "source_consensus",
        evidenceSourceIds: ["source-1", "source-2", "source-3"],
      }),
      research,
    });
    assert.ok(cov.coverageScore >= 75, `got ${cov.coverageScore}`);
    assert.equal(cov.score, 0.5);
  });

  it("source_consensus + high confidence + diverse direct evidence => very high coverage", () => {
    const research = researchWith([
      source("source-1", {
        url: "https://reddit.com/r/Fantasy/comments/fer111/one",
        type: "forum",
        summary: "He goes feral whenever she is threatened. Touch her and die energy.",
      }),
      source("source-2", {
        url: "https://www.goodreads.com/review/show/fer2",
        type: "goodreads",
        summary: "Would kill anyone who touches her. Violent protective reaction.",
      }),
      source("source-3", {
        url: "https://kirkus.example.com/review/fer3",
        type: "professional",
        summary: "Possessive and protective rage when she is in danger.",
      }),
    ]);
    const cov = calculateFieldCoverage({
      field: THAD,
      assessment: assessment({
        score: 5,
        confidence: "high",
        basis: "source_consensus",
        evidenceSourceIds: ["source-1", "source-2", "source-3"],
      }),
      research,
    });
    assert.ok(cov.coverageScore >= 85, `got ${cov.coverageScore}`);
    assert.equal(cov.needsResearch, false);
  });

  it("tæller ikke phenomenon og evidenceSourceIds to gange for samme kilde", () => {
    const research = researchWith([
      source("source-1", {
        url: "https://reddit.com/r/RomanceBooks/comments/dbl111/one",
        type: "forum",
        summary: "He goes feral whenever she is threatened.",
      }),
    ]);
    const cov = calculateFieldCoverage({
      field: THAD,
      assessment: assessment({ evidenceSourceIds: ["source-1"] }),
      research,
    });
    assert.equal(cov.directEvidenceCount, 1);
    assert.equal(cov.phenomenonEvidenceCount, 1);
  });

  it("catalog/publisher giver ikke stærk subjective evidenskvalitet", () => {
    const research = researchWith([
      source("source-1", {
        url: "https://www.amazon.com/dp/B00TEST",
        type: "catalog",
        title: "Official series listing",
        summary: "A protective bodyguard romance with a touch her and die hero.",
      }),
      source("source-2", {
        url: "https://bloomsbury.com/acotr",
        type: "publisher",
        title: "Publisher description",
        summary: "He keeps her safe as her bodyguard.",
      }),
    ]);
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        evidenceSourceIds: ["source-1", "source-2"],
        basis: "source_consensus",
        confidence: "high",
      }),
      research,
    });
    assert.ok(cov.coverageScore <= 25, `got ${cov.coverageScore}`);
    assert.ok(cov.reasons.includes("weak_subjective_source_type"));
  });
});

describe("adaptive conflicts", () => {
  function threeSupport() {
    return [
      source("s1", {
        url: "https://reddit.com/r/RomanceBooks/comments/sup111/one",
        type: "forum",
        summary: "He keeps her safe and acts like a bodyguard.",
      }),
      source("s2", {
        url: "https://www.goodreads.com/review/show/sup2",
        type: "goodreads",
        summary: "Watching over her, personal guard energy.",
      }),
      source("s3", {
        url: "https://blog.example.com/sup3",
        type: "blog",
        summary: "Assigned to protect her.",
      }),
    ];
  }

  it("3 support + 0 conflict => high coverage / no conflict gap", () => {
    const research = researchWith(threeSupport());
    const assessments = assessmentsFor({
      [BODYGUARD]: assessment({
        confidence: "high",
        evidenceSourceIds: ["s1", "s2", "s3"],
      }),
    });
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessments[BODYGUARD],
      research,
    });
    assert.ok(cov.coverageScore >= 75, `got ${cov.coverageScore}`);
    assert.equal(cov.conflictLevel, "none");
    assert.equal(cov.needsResearch, false);
    const coverage = calculateResearchCoverage({ assessments, research });
    const gaps = detectResearchGaps({ coverage, assessments, research });
    assert.equal(gaps.some((g) => g.field === BODYGUARD), false);
  });

  it("3 support + 2 conflict => høj evidensdækning men needsResearch", () => {
    const research = researchWith([
      ...threeSupport(),
      source("c1", {
        url: "https://forum.example.net/conflict1",
        type: "blog",
        summary: "He is controlling, not protective. No guardian dynamic.",
      }),
      source("c2", {
        url: "https://www.goodreads.com/review/show/conf2",
        type: "goodreads",
        summary: "Readers argue he is possessive rather than a bodyguard.",
      }),
    ]);
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        confidence: "medium",
        basis: "mixed_sources",
        evidenceSourceIds: ["s1", "s2", "s3"],
        conflictingSourceIds: ["c1", "c2"],
      }),
      research,
    });
    assert.ok(cov.coverageScore >= 70, `got ${cov.coverageScore}`);
    assert.equal(cov.conflictLevel, "meaningful");
    assert.equal(cov.needsResearch, true);
    assert.ok(cov.reasons.includes("meaningful_source_conflict"));
  });

  it("1 support + 1 conflict => weak certainty og høj gap priority", () => {
    const research = researchWith([
      source("s1", {
        url: "https://reddit.com/r/RomanceBooks/comments/one111/one",
        type: "forum",
        summary: "He keeps her safe.",
      }),
      source("c1", {
        url: "https://blog.example.com/conflict",
        type: "blog",
        summary: "Not protective at all.",
      }),
    ]);
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        basis: "mixed_sources",
        confidence: "low",
        evidenceSourceIds: ["s1"],
        conflictingSourceIds: ["c1"],
      }),
      research,
    });
    assert.equal(cov.conflictLevel, "meaningful");
    assert.equal(cov.needsResearch, true);
    const { priority } = calculateGapPriority({
      field: BODYGUARD,
      coverageScore: cov.coverageScore,
      claim: { basis: "mixed_sources" },
      conflictLevel: "meaningful",
    });
    const noConflict = calculateGapPriority({
      field: BODYGUARD,
      coverageScore: cov.coverageScore,
      claim: { basis: "mixed_sources" },
      conflictLevel: "none",
    });
    assert.ok(priority > noConflict.priority);
  });
});

describe("adaptive source diversity", () => {
  it("3 reddit posts => 3 URLs, one domain family", () => {
    const diversity = calculateEvidenceDiversity([
      source("a", {
        url: "https://reddit.com/r/RomanceBooks/comments/aaa111/one",
        type: "forum",
      }),
      source("b", {
        url: "https://old.reddit.com/r/Fantasy/comments/bbb222/two",
        type: "forum",
      }),
      source("c", {
        url: "https://www.reddit.com/r/acotar/comments/ccc333/three",
        type: "forum",
      }),
    ]);
    assert.equal(diversity.uniqueUrls, 3);
    assert.equal(diversity.uniqueDomains, 1);
    assert.deepEqual(diversity.sourceTypes, ["forum"]);
  });

  it("reddit + goodreads + blog => stronger diversity", () => {
    const mixed = calculateEvidenceDiversity([
      source("a", {
        url: "https://reddit.com/r/RomanceBooks/comments/aaa111/one",
        type: "forum",
      }),
      source("b", {
        url: "https://www.goodreads.com/review/show/1",
        type: "goodreads",
      }),
      source("c", {
        url: "https://mybookblog.example.com/review",
        type: "blog",
      }),
    ]);
    const redditOnly = calculateEvidenceDiversity([
      source("a", {
        url: "https://reddit.com/r/RomanceBooks/comments/aaa111/one",
        type: "forum",
      }),
      source("b", {
        url: "https://reddit.com/r/Fantasy/comments/bbb222/two",
        type: "forum",
      }),
      source("c", {
        url: "https://reddit.com/r/acotar/comments/ccc333/three",
        type: "forum",
      }),
    ]);
    assert.ok(mixed.uniqueDomains >= 3);
    assert.ok(mixed.sourceTypes.length >= 3);
    assert.ok(mixed.uniqueDomains > redditOnly.uniqueDomains);
  });
});

describe("adaptive gaps and priority", () => {
  it("high coverage direct field => no gap", () => {
    const research = researchWith([
      source("s1", {
        url: "https://reddit.com/r/RomanceBooks/comments/h111/one",
        type: "forum",
        summary: "He keeps her safe and acts like a bodyguard.",
      }),
      source("s2", {
        url: "https://www.goodreads.com/review/show/h2",
        type: "goodreads",
        summary: "Watching over her, personal guard.",
      }),
      source("s3", {
        url: "https://blog.example.com/h3",
        type: "blog",
        summary: "Assigned to protect her.",
      }),
    ]);
    const assessments = assessmentsFor({
      [BODYGUARD]: assessment({
        confidence: "high",
        evidenceSourceIds: ["s1", "s2", "s3"],
      }),
    });
    const coverage = calculateResearchCoverage({ assessments, research });
    const gaps = detectResearchGaps({ coverage, assessments, research });
    assert.equal(
      gaps.some((g) => g.field === BODYGUARD),
      false
    );
  });

  it("score null, ai_inference, synopsis_only, critical below, conflict => gaps", () => {
    const research = researchWith([
      source("s1", {
        url: "https://reddit.com/r/RomanceBooks/comments/g111/one",
        type: "forum",
        summary: "He keeps her safe and acts like a bodyguard.",
      }),
      source("s2", {
        url: "https://www.goodreads.com/review/show/g2",
        type: "goodreads",
        summary: "Watching over her, personal guard.",
      }),
      source("s3", {
        url: "https://blog.example.com/g3",
        type: "blog",
        summary: "Assigned to protect her.",
      }),
      source("c1", {
        url: "https://other.example.net/c1",
        type: "blog",
        summary: "Not a bodyguard at all.",
      }),
      source("c2", {
        url: "https://www.goodreads.com/review/show/c2",
        type: "goodreads",
        summary: "Controlling rather than protective.",
      }),
    ]);
    const assessments = assessmentsFor({
      [THAD]: assessment({ score: null, basis: "insufficient", evidenceSourceIds: [] }),
      [RHYSAND]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
      [WORLD]: assessment({ basis: "synopsis_only", evidenceSourceIds: [] }),
      [PROTECTIVE]: assessment({
        basis: "ai_inference",
        confidence: "low",
        evidenceSourceIds: [],
      }),
      [BODYGUARD]: assessment({
        confidence: "medium",
        basis: "mixed_sources",
        evidenceSourceIds: ["s1", "s2", "s3"],
        conflictingSourceIds: ["c1", "c2"],
      }),
    });
    const coverage = calculateResearchCoverage({ assessments, research });
    const gaps = detectResearchGaps({ coverage, assessments, research });
    const byField = Object.fromEntries(gaps.map((g) => [g.field, g]));
    assert.ok(byField[THAD]?.reasons.includes("score_missing"));
    assert.ok(byField[RHYSAND]?.reasons.includes("ai_inference"));
    assert.ok(byField[RHYSAND]?.reasons.includes("critical_field"));
    assert.ok(byField[WORLD]?.reasons.includes("synopsis_only"));
    assert.ok(byField[BODYGUARD]?.reasons.includes("meaningful_source_conflict"));
  });

  it("højere Tine-weight prioriteres ved samme evidence deficit", () => {
    const thad = calculateGapPriority({
      field: THAD,
      coverageScore: 10,
      claim: { basis: "ai_inference" },
      conflictLevel: "none",
    });
    const war = calculateGapPriority({
      field: WAR,
      coverageScore: 10,
      claim: { basis: "ai_inference" },
      conflictLevel: "none",
    });
    assert.ok(getTineFieldWeight(THAD) > getTineFieldWeight(WAR));
    assert.ok(thad.priority > war.priority, `${thad.priority} vs ${war.priority}`);
    assert.ok(thad.priorityFactors.tineImportance > war.priorityFactors.tineImportance);
  });
});

describe("adaptive follow-up planner", () => {
  const identity = {
    title: "A Court of Thorns and Roses",
    author: "Sarah J. Maas",
    firstBook: "A Court of Thorns and Roses",
  };

  it("grupperer Protective + Bodyguard + Touch-her-and-die i samme job", () => {
    const research = researchWith(
      [
        source("w1", {
          url: "https://blog.example.com/world",
          type: "blog",
          batch: "plotkarakter",
          summary: "Rich worldbuilding. MMC Rhysand and FMC Feyre between them.",
        }),
      ],
      {
        reviewConsensus: {
          notes: "between Feyre and Rhysand",
        },
      }
    );
    const assessments = assessmentsFor({
      [PROTECTIVE]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
      [BODYGUARD]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
      [THAD]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
      [RHYSAND]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
    });
    const result = analyzeResearchNeeds({ identity, research, assessments });
    const protectiveJobs = result.followUpPlan.filter(
      (j) => j.strategy === "hero_protective_dynamic"
    );
    assert.equal(protectiveJobs.length, 1);
    assert.ok(protectiveJobs[0].fields.includes(PROTECTIVE));
    assert.ok(protectiveJobs[0].fields.includes(BODYGUARD));
    assert.ok(protectiveJobs[0].fields.includes(THAD));
    assert.equal(protectiveJobs[0].fields.includes(RHYSAND), false);
    const rhysandJob = result.followUpPlan.find(
      (j) => j.strategy === "hero_respect_agency"
    );
    assert.ok(rhysandJob);
    assert.ok(rhysandJob.fields.includes(RHYSAND));
  });

  it("bruger MMC/FMC-navne når de kan findes, ellers generic fallback", () => {
    const withNames = analyzeResearchNeeds({
      identity,
      research: researchWith([], {
        reviewConsensus: { blurb: "Romance between Feyre and Rhysand" },
      }),
      assessments: assessmentsFor({
        [THAD]: assessment({ basis: "ai_inference" }),
        [BODYGUARD]: assessment({ basis: "ai_inference" }),
        [PROTECTIVE]: assessment({ basis: "ai_inference" }),
      }),
    });
    const named = withNames.followUpPlan[0];
    assert.ok(named.leadCharacters.mmc || named.leadCharacters.fmc);
    assert.match(named.userPrompt, /Feyre|Rhysand/);

    const generic = analyzeResearchNeeds({
      identity,
      research: researchWith([]),
      assessments: assessmentsFor({
        [THAD]: assessment({ basis: "ai_inference" }),
        [BODYGUARD]: assessment({ basis: "ai_inference" }),
        [PROTECTIVE]: assessment({ basis: "ai_inference" }),
      }),
    });
    assert.equal(generic.followUpPlan[0].leadCharacters.mmc, "");
    assert.equal(generic.followUpPlan[0].leadCharacters.fmc, "");
    assert.match(
      generic.followUpPlan[0].userPrompt,
      /mandlige hovedperson|heltinden/
    );
  });

  it("maxJobs = 2 => aldrig 3 jobs", () => {
    const assessments = assessmentsFor(
      Object.fromEntries(
        SUBJECTIVE_KEYS.map((k) => [
          k,
          assessment({ basis: "ai_inference", score: 3, evidenceSourceIds: [] }),
        ])
      )
    );
    const jobs = planFollowUpResearch({
      identity,
      research: researchWith([]),
      assessments,
      maxJobs: 2,
    });
    assert.ok(jobs.length <= 2);
    assert.notEqual(jobs.length, 3);
    assert.equal(ADAPTIVE_MAX_JOBS_PER_ROUND, 3);
  });

  it("high coverage / no gaps => ingen follow-up", () => {
    const fieldBlurb = {
      [THAD]: "He goes feral whenever she is threatened. Touch her and die energy.",
      [BODYGUARD]: "He is her bodyguard and was assigned to protect her.",
      [PROTECTIVE]: "The MMC is protective of her and keeps her safe.",
      [RHYSAND]: "He respects her agency and is an equal partner who supports her growth.",
      "Spice/erotik (0-5)": "Open door spice with steamy explicit scenes.",
      "Spice/erotik kvalitet (0-5)": "Spice quality is well-written intimate scenes.",
      "Romance i fokus (0-100%)": "Romance-focused story; romance takes the focus.",
      "Worldbuilding (0-5)": "Rich worldbuilding and an intricate magic system.",
      "Episk plot (0-5)": "Epic plot with high stakes and grand scale.",
      "Politiske intriger (0-5)": "Political intrigue and court intrigue throughout.",
      "Krig/militær (0-5)": "War and military conflict drive the plot.",
      "Kvindelig udvikling (0-5)": "Heroine growth and a strong female character arc.",
      "Karakterudvikling (0-5)": "Deep character development and character arcs.",
      "Book hangover (0-5)": "Serious book hangover; couldn't put the book down.",
      "Hvor hurtigt griber den? (0-100%)": "It grabs you immediately from page one.",
    };
    const sources = [];
    const assessments = {};
    let i = 0;
    for (const field of SUBJECTIVE_KEYS) {
      const ids = [`a${i}`, `b${i}`, `c${i}`];
      const blurb = fieldBlurb[field] || `${field} described directly.`;
      sources.push(
        source(ids[0], {
          url: `https://reddit.com/r/RomanceBooks/comments/x${i}aaa111/one`,
          type: "forum",
          summary: blurb,
        }),
        source(ids[1], {
          url: `https://www.goodreads.com/review/show/${i}b`,
          type: "goodreads",
          summary: blurb,
        }),
        source(ids[2], {
          url: `https://blog${i}.example.com/review`,
          type: "blog",
          summary: blurb,
        })
      );
      assessments[field] = assessment({
        confidence: "high",
        basis: "source_consensus",
        evidenceSourceIds: ids,
      });
      i += 1;
    }
    const result = analyzeResearchNeeds({
      identity,
      research: researchWith(sources),
      assessments,
    });
    assert.equal(result.followUpPlan.length, 0);
    assert.ok(result.coverage.weightedCoverage >= 80);
    assert.equal(result.coverage.criticalFieldsBelowMinimum.length, 0);
  });

  it("conflict_resolution når coverage er høj men kilder er uenige", () => {
    const research = researchWith([
      source("s1", {
        url: "https://reddit.com/r/RomanceBooks/comments/cr111/one",
        type: "forum",
        summary:
          "He keeps her safe and acts like a bodyguard. He goes feral when she is threatened. Respects her agency and is an equal partner. Rich worldbuilding and magic system. Heroine growth. Epic plot. Open door spice. Book hangover. Grabs you immediately. Romance-focused. Character development. Political intrigue. War.",
      }),
      source("s2", {
        url: "https://www.goodreads.com/review/show/cr2",
        type: "goodreads",
        summary:
          "Watching over her, personal guard. Touch her and die. Supports her growth. Intricate magic system. Female character arc. Grand scale. Steamy spice. Couldn't put the book down. Romance takes the focus. Character arcs. Court intrigue. Military.",
      }),
      source("s3", {
        url: "https://blog.example.com/cr3",
        type: "blog",
        summary:
          "Assigned to protect her. Respects her agency. Worldbuilding. Strong heroine growth. Epic plot. Explicit spice. Spice quality is well-written intimate scenes. Book hangover. Grabs you immediately. Romance-focused. Character development. Political intrigue. Army.",
      }),
      source("c1", {
        url: "https://other.example.net/cr-c1",
        type: "blog",
        summary: "Controlling, not protective.",
      }),
      source("c2", {
        url: "https://www.goodreads.com/review/show/cr-c2",
        type: "goodreads",
        summary: "No guardian dynamic.",
      }),
    ]);
    const strong = {
      confidence: "high",
      basis: "source_consensus",
      evidenceSourceIds: ["s1", "s2", "s3"],
    };
    const assessments = assessmentsFor({
      [PROTECTIVE]: assessment(strong),
      [THAD]: assessment(strong),
      [RHYSAND]: assessment(strong),
      [WORLD]: assessment(strong),
      [BODYGUARD]: assessment({
        confidence: "medium",
        basis: "mixed_sources",
        evidenceSourceIds: ["s1", "s2", "s3"],
        conflictingSourceIds: ["c1", "c2"],
      }),
    });
    // Fill remaining critical/high-weight fields so planner isn't dominated by missing evidence.
    for (const field of SUBJECTIVE_KEYS) {
      if (!assessments[field].evidenceSourceIds.length) {
        assessments[field] = assessment(strong);
      }
    }
    const result = analyzeResearchNeeds({ identity, research, assessments });
    assert.ok(result.coverage.fields[BODYGUARD].coverageScore >= 70);
    const conflictJob = result.followUpPlan.find(
      (j) => j.strategy === "conflict_resolution"
    );
    assert.ok(conflictJob, `jobs: ${result.followUpPlan.map((j) => j.strategy).join(",")}`);
    assert.ok(conflictJob.fields.includes(BODYGUARD));
    assert.match(conflictJob.userPrompt, /uenige|forskellige retninger/i);
  });
});

describe("analyzeResearchNeeds API", () => {
  it("returnerer coverage, gaps og followUpPlan uden API-kald", () => {
    const result = analyzeResearchNeeds({
      identity: { title: "Test", author: "Author" },
      research: researchWith([]),
      assessments: assessmentsFor({
        [THAD]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
      }),
    });
    assert.equal(typeof result.coverage.weightedCoverage, "number");
    assert.ok(result.coverage.fields[THAD]);
    assert.ok(Array.isArray(result.coverage.criticalFieldsBelowMinimum));
    assert.ok(Array.isArray(result.gaps));
    assert.ok(Array.isArray(result.followUpPlan));
    assert.equal(result.adaptiveVersion, ADAPTIVE_VERSION);
    const debug = summarizeAdaptiveIntelligence(result);
    assert.ok(Array.isArray(debug.topGaps));
    assert.ok(Array.isArray(debug.proposedJobs));
  });
});
