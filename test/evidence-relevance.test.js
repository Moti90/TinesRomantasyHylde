import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  evaluateSourceForField,
  evaluateSourcesForFields,
  isFieldSpecificEvidence,
} from "../server/services/evidenceRelevance.js";
import {
  analyzeResearchNeeds,
  calculateFieldCoverage,
  planFollowUpResearch,
} from "../server/services/adaptiveResearch.js";
import {
  inferSeriesRomanticLeads,
  looksLikeReaderDiscussion,
  mergeSearchResultDrafts,
  selectValuableSources,
} from "../server/services/webResearch.js";
import {
  isFollowUpSourceRelevant,
  prepareFollowUpSources,
  runAdaptiveResearch,
} from "../server/services/adaptiveResearchLoop.js";

const THAD = "Touch her and die-vibe (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const RHYSAND = "Rhysand-faktoren";

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
    type: over.type || "blog",
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

describe("field-specific evidence relevance", () => {
  it("generic power/ruthless/wingleader is not Bodyguard/THAD direct", () => {
    const src = source("source-1", {
      url: "https://supersummary.com/fourth-wing/xaden",
      type: "other",
      summary: "Xaden is powerful and ruthless. He is a wingleader.",
    });
    const bg = evaluateSourceForField({ source: src, field: BODYGUARD });
    const thad = evaluateSourceForField({ source: src, field: THAD });
    assert.notEqual(bg.relevance, "direct");
    assert.notEqual(thad.relevance, "direct");
    assert.equal(isFieldSpecificEvidence(bg), false);
    assert.equal(isFieldSpecificEvidence(thad), false);

    const covBg = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({ evidenceSourceIds: ["source-1"] }),
      research: { sources: [src] },
    });
    assert.equal(covBg.directEvidenceCount, 0);
    assert.ok(covBg.coverageScore <= 25, `Bodyguard coverage ${covBg.coverageScore}`);
  });

  it("real protective wording distinguishes Protective / Bodyguard / THAD", () => {
    const src = source("source-1", {
      url: "https://reddit.com/r/RomanceBooks/comments/rel111/one",
      type: "forum",
      summary:
        "Xaden repeatedly shields Violet from danger. He secretly ensures she has protection. He reacts violently when she is attacked.",
    });
    const prot = evaluateSourceForField({ source: src, field: PROTECTIVE });
    const bg = evaluateSourceForField({ source: src, field: BODYGUARD });
    const thad = evaluateSourceForField({ source: src, field: THAD });
    assert.equal(prot.relevance, "direct");
    assert.ok(["direct", "supporting"].includes(bg.relevance), bg.relevance);
    assert.ok(["direct", "supporting"].includes(thad.relevance), thad.relevance);
  });

  it("generic protective is not automatic Bodyguard/THAD direct", () => {
    const src = source("source-1", {
      url: "https://blog.example.com/review",
      type: "blog",
      summary: "He protects her and is a powerful, dangerous hero.",
    });
    const prot = evaluateSourceForField({ source: src, field: PROTECTIVE });
    const bg = evaluateSourceForField({ source: src, field: BODYGUARD });
    const thad = evaluateSourceForField({ source: src, field: THAD });
    assert.ok(["direct", "supporting"].includes(prot.relevance));
    assert.notEqual(bg.relevance, "direct");
    assert.notEqual(thad.relevance, "direct");
  });

  it("10 generic character sources cannot stack Bodyguard coverage to 80+", () => {
    const sources = Array.from({ length: 10 }, (_, i) =>
      source(`source-${i + 1}`, {
        url: `https://guide${i}.example.com/character`,
        type: "blog",
        summary: "He is powerful, ruthless, dangerous, and a wingleader.",
      })
    );
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        evidenceSourceIds: sources.map((s) => s.id),
        confidence: "high",
        basis: "source_consensus",
      }),
      research: { sources },
    });
    assert.equal(cov.directEvidenceCount, 0);
    assert.ok(cov.coverageScore <= 25, `got ${cov.coverageScore}`);
  });

  it("morally grey / powerful is not Rhysand-factor direct", () => {
    const src = source("source-1", {
      url: "https://blog.example.com/grey",
      type: "blog",
      summary: "A morally grey, powerful and ruthless hero.",
    });
    const ev = evaluateSourceForField({ source: src, field: RHYSAND });
    assert.notEqual(ev.relevance, "direct");
  });

  it("negative evidence is still direct for a low score", () => {
    const src = source("source-1", {
      url: "https://reddit.com/r/RomanceBooks/comments/neg111/one",
      type: "forum",
      summary: "He is not particularly protective. She generally protects herself. Their relationship has little guardian dynamic.",
    });
    const ev = evaluateSourceForField({ source: src, field: BODYGUARD });
    assert.equal(ev.relevance, "direct");
    assert.equal(ev.polarity, "negative");
    const cov = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        score: 0.5,
        evidenceSourceIds: ["source-1"],
        confidence: "high",
      }),
      research: { sources: [src] },
    });
    assert.equal(cov.directEvidenceCount, 1);
    assert.ok(cov.coverageScore >= 25);
  });

  it("broad tokens alone are not direct evidence", () => {
    const src = source("source-1", {
      url: "https://blog.example.com/generic",
      type: "blog",
      summary: "There is danger, a powerful hero, a strong relationship, and protective magic.",
    });
    assert.equal(
      evaluateSourceForField({ source: src, field: BODYGUARD }).relevance !== "direct",
      true
    );
    assert.equal(
      evaluateSourceForField({ source: src, field: THAD }).relevance !== "direct",
      true
    );
  });
});

describe("source filtering and metadata merge", () => {
  it("keeps a concrete Goodreads/Reddit discussion with character dynamic", () => {
    const sources = selectValuableSources([
      {
        title: "Feyre and the MMC dynamic discussion",
        url: "https://www.goodreads.com/topic/show/12345-character-dynamic-thread",
        type: "forum",
        batch: "helteprofil",
        summary: "Readers discuss how protective he is of her.",
      },
      {
        title: "Just finished this romantasy — MMC thoughts",
        url: "https://www.reddit.com/r/RomanceBooks/comments/abc123/just_finished_review/",
        type: "forum",
        batch: "helteprofil",
        summary: "Character dynamic between the leads.",
      },
    ]);
    assert.ok(sources.some((s) => /goodreads.com\/topic/i.test(s.url)));
    assert.ok(sources.some((s) => /reddit.com/i.test(s.url)));
    assert.equal(
      looksLikeReaderDiscussion(
        "https://www.goodreads.com/topic/show/12345-foo",
        "",
        ""
      ),
      true
    );
  });

  it("rich model metadata wins over short raw URL metadata", () => {
    const { drafts } = mergeSearchResultDrafts(
      [
        {
          url: "https://www.faereviews.com/fourth-wing-character-analysis",
          title: "Fourth Wing character analysis: the wingleader and the heroine",
          type: "blog",
          summary:
            "A detailed look at how he secretly ensures she has protection and repeatedly shields her from danger.",
        },
      ],
      [
        {
          url: "https://faereviews.com/fourth-wing-character-analysis?utm_source=x",
          title: "faereviews.com",
          summary: "Short teaser of the post.",
        },
      ],
      { focus: "helteprofil", batchLabel: "helteprofil" }
    );
    assert.equal(drafts.length, 1);
    assert.match(drafts[0].title, /character analysis/i);
    assert.ok(String(drafts[0].summary).length > 40);
    assert.doesNotMatch(drafts[0].title, /^faereviews\.com$/i);
  });
});

describe("series-level romantic leads", () => {
  it("prefers later/endgame partner over book-1 love interest", () => {
    const inferred = inferSeriesRomanticLeads({
      sources: [
        {
          summary:
            "Book 1: the heroine dates Aldric. Later series: the relationship with Aldric ends. Corin becomes the central romantic partner/endgame.",
        },
      ],
    });
    assert.equal(inferred.mmc, "Corin");
    assert.notEqual(inferred.mmc, "Aldric");
    assert.ok(
      inferred.alternatives.some(
        (a) => a.name === "Aldric" && a.role === "early_love_interest"
      )
    );
  });

  it("low confidence when two leads are ambiguous", () => {
    const inferred = inferSeriesRomanticLeads({
      sources: [
        { summary: "Readers disagree on the male lead." },
        { summary: "MMC Aldric appears throughout book 1." },
        { summary: "MMC Corin is also described as the male lead." },
      ],
    });
    assert.equal(inferred.confidence, "low");
    const names = [inferred.mmc, ...inferred.alternatives.map((a) => a.name)];
    assert.ok(names.includes("Aldric") || names.includes("Corin"));

    const jobs = planFollowUpResearch({
      identity: {
        title: "The Ember Cycle",
        author: "A. Writer",
        series: "The Ember Cycle",
        isSeries: true,
      },
      research: {
        sources: [
          { id: "s1", summary: "MMC Aldric appears throughout book 1." },
          { id: "s2", summary: "MMC Corin is also described as the male lead." },
        ],
      },
      assessments: assessmentsFor({
        [BODYGUARD]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
        [THAD]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
        [PROTECTIVE]: assessment({ basis: "ai_inference", evidenceSourceIds: [] }),
      }),
    });
    assert.ok(jobs.length >= 1);
    assert.equal(jobs[0].leadCharacters.confidence, "low");
    const hints = jobs.flatMap((j) => j.queryHints).join(" ");
    assert.match(hints, /main romantic lead heroine/i);
  });
});

describe("relevance consistency and stop quality", () => {
  it("contextual follow-ups are not newRelevantSources and do not lift target coverage", () => {
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

    const before = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({ evidenceSourceIds: [] }),
      research: { sources: [] },
    });
    const afterSources = prepared.map((s, i) => ({ ...s, id: `source-${i + 1}` }));
    const after = calculateFieldCoverage({
      field: BODYGUARD,
      assessment: assessment({
        evidenceSourceIds: afterSources.map((s) => s.id),
      }),
      research: { sources: afterSources },
    });
    assert.ok(
      after.coverageScore - before.coverageScore < 15,
      `coverage rose ${before.coverageScore} → ${after.coverageScore}`
    );
  });

  it("high weighted coverage with only contextual Bodyguard is not target_reached", async () => {
    const generic = Array.from({ length: 8 }, (_, i) =>
      source(`source-${i + 1}`, {
        url: `https://guide${i}.example.com/char`,
        type: "blog",
        summary: "A powerful and ruthless wingleader. Dangerous hero.",
      })
    );
    const assessments = assessmentsFor(
      Object.fromEntries(
        SUBJECTIVE_KEYS.map((k) => [
          k,
          assessment({
            score: 4,
            confidence: "high",
            basis: "source_consensus",
            evidenceSourceIds: generic.map((s) => s.id),
          }),
        ])
      )
    );
    const intelligence = analyzeResearchNeeds({
      identity: { title: "Skybound", author: "Jane Doe" },
      research: { sources: generic },
      assessments,
    });
    assert.equal(
      intelligence.coverage.fields[BODYGUARD].directEvidenceCount,
      0
    );
    assert.equal(intelligence.coverage.fields[BODYGUARD].stopQualitySatisfied, false);
    assert.ok(intelligence.followUpPlan.length >= 1);

    let executes = 0;
    const result = await runAdaptiveResearch({
      identity: { title: "Skybound", author: "Jane Doe" },
      initialResearch: {
        identity: { title: "Skybound" },
        sources: generic,
        reviewConsensus: {},
        meta: { webSearchCalls: 4, estimatedCostUsd: 0.09, warnings: [] },
      },
      initialAnalysis: { meta: { assessments } },
      options: {
        executeFollowUpJob: async () => {
          executes += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => {
          throw new Error("should not synthesize when follow-up is empty");
        },
        analyze: async () => {
          throw new Error("should not analyze");
        },
      },
    });
    assert.notEqual(result.adaptive.stopReason, "target_reached");
    assert.ok(executes >= 1 || result.adaptive.stopReason !== "target_reached");
  });

  it("high quality critical evidence can stop at target_reached", async () => {
    const rich = [
      source("source-1", {
        url: "https://reddit.com/r/RomanceBooks/comments/hqaaa111/one",
        type: "forum",
        summary:
          "He keeps her safe and acts like a bodyguard. He goes feral whenever she is threatened. Respects her agency and is an equal partner. Heroine growth and character development. Rich worldbuilding and magic system. Epic plot with high stakes. Political intrigue. War and military conflict. Open door spice. Spice quality is well-written intimate scenes. Romance-focused. Book hangover; couldn't put the book down. Grabs you immediately.",
      }),
      source("source-2", {
        url: "https://www.goodreads.com/review/show/hq2",
        type: "goodreads",
        summary:
          "Personal guard. Touch her and die. Supports her growth. Female character arc. Intricate magic system. Grand scale. Court intrigue. Army. Steamy open door. Well-written intimate scenes. Romance takes the focus. Book hangover. Grabs you immediately.",
      }),
      source("source-3", {
        url: "https://hq.bookblog.example.com/review",
        type: "blog",
        summary:
          "Assigned to protect her. Respects her agency. Strong heroine growth. Character arcs. Worldbuilding. Epic plot. Political intrigue. Military. Explicit spice scenes. Spice quality is meaningful. Romance-focused. Couldn't put the book down. Grabs you immediately.",
      }),
    ];
    const assessments = assessmentsFor(
      Object.fromEntries(
        SUBJECTIVE_KEYS.map((k) => [
          k,
          assessment({
            score: 4,
            confidence: "high",
            basis: "source_consensus",
            evidenceSourceIds: ["source-1", "source-2", "source-3"],
          }),
        ])
      )
    );
    let executes = 0;
    const result = await runAdaptiveResearch({
      identity: { title: "Shadowbound", author: "Jane Doe" },
      initialResearch: {
        identity: { title: "Shadowbound" },
        sources: rich,
        reviewConsensus: {},
        meta: { webSearchCalls: 4, estimatedCostUsd: 0.09, warnings: [] },
      },
      initialAnalysis: { meta: { assessments } },
      options: {
        executeFollowUpJob: async () => {
          executes += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
      },
    });
    assert.equal(executes, 0);
    assert.equal(result.adaptive.stopReason, "target_reached");
  });
});

describe("shared relevance API", () => {
  it("evaluateSourcesForFields returns per-field levels", () => {
    const sources = [
      source("source-1", {
        url: "https://blog.example.com/a",
        summary: "He is her bodyguard.",
      }),
      source("source-2", {
        url: "https://blog.example.com/b",
        summary: "Powerful ruthless wingleader.",
      }),
    ];
    const { byField } = evaluateSourcesForFields({
      sources,
      fields: [BODYGUARD],
    });
    assert.equal(byField[BODYGUARD][0].relevance, "direct");
    assert.ok(["contextual", "none"].includes(byField[BODYGUARD][1].relevance));
  });
});
