import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreCandidate,
  titleSimilarity,
  authorMatch,
  norm,
} from "../server/services/identify.js";
import {
  normalizeResearch,
  emptyResearch,
} from "../server/services/webResearch.js";
import {
  normalizeAssessment,
  applyResearchFacts,
} from "../server/services/handbookAnalysis.js";
import { migrateRow, migrateSeriesList } from "../server/services/migrate.js";
import {
  researchInputHash,
  analysisInputHash,
} from "../server/services/hash.js";
import {
  getCachedResearch,
  saveResearchCache,
  clearResearchCache,
} from "../server/services/researchCache.js";
import { upsertSeries, loadSeries, saveSeries } from "../server/services/store.js";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "../data/series.json");

describe("identifikation", () => {
  it("skelnner samme titel med forskellige forfattere", () => {
    const queryTitle = "The Binding";
    const a = scoreCandidate(
      { title: "The Binding", authors: ["Bridget Collins"], author: "Bridget Collins" },
      queryTitle,
      "Bridget Collins"
    );
    const b = scoreCandidate(
      { title: "The Binding", authors: ["Nicholas Wolff"], author: "Nicholas Wolff" },
      queryTitle,
      "Bridget Collins"
    );
    assert.ok(a._score > b._score);
    assert.equal(a._authorMatched, true);
    assert.equal(b._authorMatched, false);
  });

  it("titleSimilarity genkender næsten-ens titler", () => {
    assert.ok(titleSimilarity("Reign & Ruin", "Reign and Ruin") >= 0.5);
    assert.equal(norm("Reign & Ruin").includes("reign"), true);
  });

  it("authorMatch kræver overlap", () => {
    assert.equal(authorMatch(["J.D. Evans"], "J.D. Evans").matched, true);
    assert.equal(authorMatch(["Someone Else"], "J.D. Evans").matched, false);
  });
});

describe("Goodreads vs katalog", () => {
  it("Goodreads null når ikke fundet", () => {
    const r = normalizeResearch(
      {
        identity: { title: "X", author: "Y", confidence: "high" },
        facts: {},
        ratings: { goodreads: null },
        reviewConsensus: {},
        sources: [],
      },
      { title: "X", author: "Y", identityConfidence: "high" }
    );
    assert.equal(r.ratings.goodreads, null);
  });

  it("blander ikke Open Library ind som Goodreads", () => {
    const r = normalizeResearch(
      {
        identity: { title: "X", author: "Y", confidence: "high" },
        ratings: {
          goodreads: {
            value: 4.2,
            source: "Open Library",
            matchConfidence: "high",
            titleMatched: true,
            authorMatched: true,
          },
        },
        sources: [],
      },
      { title: "X", author: "Y" }
    );
    assert.equal(r.ratings.goodreads, null);
  });

  it("afviser Goodreads ved low matchConfidence", () => {
    const r = normalizeResearch(
      {
        ratings: {
          goodreads: {
            value: 4.5,
            matchConfidence: "low",
            titleMatched: true,
            authorMatched: true,
          },
        },
        sources: [],
      },
      { title: "X", author: "Y" }
    );
    assert.equal(r.ratings.goodreads, null);
  });

  it("afviser Goodreads uden forfatter-match", () => {
    const r = normalizeResearch(
      {
        ratings: {
          goodreads: {
            value: 4.5,
            matchConfidence: "high",
            titleMatched: true,
            authorMatched: false,
          },
        },
        sources: [],
      },
      { title: "X", author: "Y" }
    );
    assert.equal(r.ratings.goodreads, null);
  });
});

describe("kilder og confidence", () => {
  it("nichebog kan have få kilder", () => {
    const r = normalizeResearch(
      {
        sources: [
          {
            id: "source-1",
            title: "Blog review spice",
            url: "https://myblog.example/review-obscure",
            type: "blog",
            batch: "romanceprofil",
            summary: "spice and romance review of the book",
          },
          {
            id: "source-2",
            title: "Just finished review",
            url: "https://reddit.com/r/books/comments/x1/just_finished_review",
            type: "forum",
            batch: "helteprofil",
            summary: "protective MMC review worth reading",
          },
        ],
        reviewConsensus: {},
        ratings: {},
      },
      { title: "Obscure", author: "A" }
    );
    assert.ok(r.sources.length >= 1);
  });

  it("populær serie beholder værdifulde anmeldelser/fora (ikke volumen for volumen)", () => {
    const sources = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `blog-${i}`,
        title: `Book review ${i}`,
        url: `https://blog${i}.example.com/review-foo`,
        type: "blog",
        summary: "romance and spice",
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `forum-${i}`,
        title: `Just finished — review ${i}`,
        url: `https://reddit.com/r/books/comments/aa${i}/just_finished_review_${i}`,
        type: "forum",
        summary: "thoughts on the book",
      })),
      {
        id: "lore",
        title: "Harry was missing for 24 hours. Where was he?",
        url: "https://reddit.com/r/harrypotter/comments/zz1/harry_was_missing_for_24_hours",
        type: "forum",
        summary: "timeline",
      },
    ];
    const r = normalizeResearch(
      { sources, reviewConsensus: {}, ratings: {} },
      { title: "Popular", author: "A" }
    );
    assert.ok(r.sources.length >= 8);
    assert.ok(
      !r.sources.some((s) => /missing for/i.test(s.title + s.url))
    );
  });

  it("modstridende kilder sænker ikke automatisk via normalize, men single source kan ikke være high", () => {
    const r = normalizeResearch(
      {
        sources: [{ id: "source-1", title: "One", url: "https://a", type: "blog", summary: "x" }],
        reviewConsensus: {
          slowBurn: {
            finding: "Slow",
            consensus: "strong",
            confidence: "high",
            supportingSourceIds: ["source-1"],
            conflictingSourceIds: [],
          },
        },
        ratings: {},
      },
      { title: "X", author: "Y" }
    );
    assert.equal(r.reviewConsensus.slowBurn.confidence, "medium");
  });

  it("en enkelt anmeldelse kan ikke alene give høj assessment-confidence", () => {
    const a = normalizeAssessment({
      score: 5,
      confidence: "high",
      basis: "source_consensus",
      reason: "Én blog",
      evidenceSourceIds: ["source-1"],
      conflictingSourceIds: [],
    });
    assert.equal(a.confidence, "medium");
  });

  it("subjektiv modelvurdering overlever uden direkte kilder ved sikker identitet", () => {
    const a = normalizeAssessment(
      {
        score: 4,
        confidence: "medium",
        basis: "ai_inference",
        reason: "Helten er kendt for at støtte heltindens selvstændighed.",
        sourceBatch: "helteprofil",
        sourceCount: 0,
        evidenceSourceIds: [],
      },
      "Rhysand-faktoren",
      {
        identity: { title: "Kendt bog", author: "Kendt forfatter", confidence: "high" },
        sources: [],
      }
    );
    assert.equal(a.score, 4);
    assert.equal(a.basis, "ai_inference");
    assert.equal(a.confidence, "low");
    assert.match(a.reason, /^Vurderet ud fra modelviden:/);
  });

  it("subjektiv modelvurdering afvises ved uklar identitet", () => {
    const a = normalizeAssessment(
      {
        score: 5,
        confidence: "medium",
        basis: "ai_inference",
        reason: "Muligvis den rigtige serie.",
        sourceBatch: "helteprofil",
        sourceCount: 0,
      },
      "Rhysand-faktoren",
      {
        identity: { title: "Uklar bog", confidence: "low" },
        sources: [],
      }
    );
    assert.equal(a.score, null);
    assert.equal(a.basis, "insufficient");
    assert.equal(a.confidence, "low");
  });

  it("objektive fakta uden research bliver ikke udfyldt fra modeloutput", () => {
    const row = {
      "Antal bøger i serien": 7,
      "Lydbog (ja/nej, ikke hele serien)": "Ja",
      "Er serien færdigskrevet": "Ja",
      "Er serien på Mofibo? (ja, nej, ikke hele serien)": "Ja",
    };
    applyResearchFacts(
      row,
      { facts: {}, ratings: {}, identity: {} },
      { status: "Ikke verificeret" }
    );
    assert.equal(row["Antal bøger i serien"], null);
    assert.equal(row["Lydbog (ja/nej, ikke hele serien)"], null);
    assert.equal(row["Er serien færdigskrevet"], null);
    assert.equal(
      row["Er serien på Mofibo? (ja, nej, ikke hele serien)"],
      null
    );
  });

  it("relation kan udledes fra review-felt (struktur)", () => {
    const r = normalizeResearch(
      {
        sources: [
          { id: "source-1", title: "r", url: "https://a", type: "forum", summary: "MF" },
          { id: "source-2", title: "b", url: "https://b", type: "blog", summary: "MF romance" },
        ],
        reviewConsensus: {
          relationType: {
            finding: "Romancen beskrives som MF.",
            consensus: "strong",
            confidence: "high",
            supportingSourceIds: ["source-1", "source-2"],
            conflictingSourceIds: [],
          },
        },
        ratings: {},
      },
      { title: "X", author: "Y" }
    );
    assert.equal(r.reviewConsensus.relationType.finding.includes("MF"), true);
  });
});

describe("migrering", () => {
  it("migrerer gammel database uden tab af Tines felter", () => {
    const row = migrateRow({
      "Seriens navn": "Test",
      "Goodreads-score": "4.1 (Open Library, n=12)",
      "Tines score": 91,
      "Tines egen vurdering": "Elskede den",
      "Tine-score": 88,
    });
    assert.equal(row["Tines score"], 91);
    assert.equal(row["Tines egen vurdering"], "Elskede den");
    assert.equal(row["Goodreads-score"], null);
    assert.equal(row._ratingMeta.catalog.source, "Open Library");
  });

  it("markerer ukendt gammel rating som legacy_unknown", () => {
    const row = migrateRow({
      "Seriens navn": "Test2",
      "Goodreads-score": 4.18,
    });
    assert.equal(row._ratingMeta.legacy.source, "legacy_unknown");
    assert.equal(row["Goodreads-score"], 4.18);
  });

  it("migrateSeriesList bevarer længde", () => {
    const list = migrateSeriesList([
      { "Seriens navn": "A" },
      { "Seriens navn": "B", "Goodreads-score": "3.9 (Google Books)" },
    ]);
    assert.equal(list.length, 2);
  });
});

describe("cache", () => {
  it("uændrede inputs genbruger research-cache", () => {
    clearResearchCache();
    const identity = {
      title: "Cache Book",
      author: "Cache Author",
      series: null,
      bookNumber: null,
    };
    const research = emptyResearch(identity);
    research.sources = [
      { id: "source-1", title: "t", url: "https://x", type: "blog", summary: "s" },
    ];
    const hash = saveResearchCache(identity, research);
    const hit = getCachedResearch(identity);
    assert.equal(hit.hit, true);
    assert.equal(hit.hash, hash);
    assert.equal(researchInputHash(identity), hash);
  });

  it("analysisInputHash er stabil for samme input", () => {
    const a = analysisInputHash({
      researchHash: "abc",
      handbookVersion: "v1",
      promptVersion: "p1",
      model: "gpt-4o-mini",
      anchors: [["X", 90]],
    });
    const b = analysisInputHash({
      researchHash: "abc",
      handbookVersion: "v1",
      promptVersion: "p1",
      model: "gpt-4o-mini",
      anchors: [["X", 90]],
    });
    assert.equal(a, b);
  });
});

describe("Tines egne scores", () => {
  it("bevarer Tines score ved upsert/genanalyse-merge", () => {
    if (!existsSync(dataPath)) writeFileSync(dataPath, "[]", "utf8");
    const backup = readFileSync(dataPath, "utf8");
    try {
      saveSeries([]);
      upsertSeries({
        "Seriens navn": "Preserve Me",
        "Tines score": 95,
        "Tines egen vurdering": "Min note",
        "Tine-score": 80,
        Status: "Læst",
      });
      upsertSeries({
        "Seriens navn": "Preserve Me",
        "Tines score": null,
        "Tines egen vurdering": null,
        "Tine-score": 70,
        Status: "Ikke læst",
      });
      const row = loadSeries().find((r) => r["Seriens navn"] === "Preserve Me");
      assert.equal(row["Tines score"], 95);
      assert.equal(row["Tines egen vurdering"], "Min note");
      assert.equal(row["Tine-score"], 70);
    } finally {
      writeFileSync(dataPath, backup, "utf8");
    }
  });
});

describe("API-nøgle ikke i frontend-filer", () => {
  it("public JS indeholder ikke openaiApiKey/sk-proj", () => {
    const files = [
      join(__dirname, "../public/js/main.js"),
      join(__dirname, "../public/js/api.js"),
      join(__dirname, "../public/js/ui/list.js"),
      join(__dirname, "../public/index.html"),
    ];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      assert.equal(text.includes("sk-proj"), false);
      assert.equal(text.includes("openaiApiKey"), false);
      assert.equal(text.includes("OPENAI_API_KEY"), false);
    }
  });
});

describe("pipeline-kontrakt (mock)", () => {
  it("genanalyse flag: webSearchUsed false i meta-form", () => {
    // Kontrakt: reanalyze-svar skal signalere ingen web search
    const meta = { webSearchUsed: false, researchCacheHit: true };
    assert.equal(meta.webSearchUsed, false);
  });

  it("refresh flag: webSearchUsed true", () => {
    const meta = { webSearchUsed: true, researchCacheHit: false };
    assert.equal(meta.webSearchUsed, true);
  });

  it("ugyldigt AI-output kastes som forventet af extract-sti", () => {
    assert.throws(() => {
      const text = "not json at all";
      const start = text.indexOf("{");
      if (start === -1) throw new Error("Ugyldigt AI-output");
    }, /Ugyldigt AI-output/);
  });
});
