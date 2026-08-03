import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchPlan,
  classifySourceType,
  normalizeSources,
  normalizeConsensus,
  normalizeResearch,
  summarizeSourceFoundation,
  extractRawSearchUrls,
  canonicalizeUrl,
  isIndustryNoise,
  selectValuableSources,
  looksLikeReaderDiscussion,
  inferLeadCharactersFromResearch,
} from "../server/services/webResearch.js";
import { estimateTineScoreFromVibes } from "../server/services/handbookAnalysis.js";

describe("systematisk søgeplan", () => {
  it("har 4 batches: helteprofil, romanceprofil, plotkarakter, helhed", () => {
    const plan = buildSearchPlan({
      title: "Fourth Wing",
      author: "Rebecca Yarros",
      series: "The Empyrean",
    });
    const ids = plan.map((p) => p.id);
    assert.deepEqual(ids, [
      "helteprofil",
      "romanceprofil",
      "plotkarakter",
      "helhed",
    ]);
    assert.ok(plan.every((p) => p.userPrompt && p.batch));
    assert.equal(plan[0].query, "");
    assert.equal(plan[1].query, "");
    assert.equal(plan[2].query, "");
    assert.equal(plan[3].query, "");
    assert.ok(plan[0].userPrompt.includes("Fourth Wing"));
    assert.ok(plan[0].userPrompt.includes("Rebecca Yarros"));
    assert.ok(plan[0].userPrompt.toLowerCase().includes("personlighed"));
    assert.ok(plan[1].userPrompt.toLowerCase().includes("spice"));
    assert.ok(plan[2].userPrompt.toLowerCase().includes("plot"));
    assert.ok(plan[3].userPrompt.toLowerCase().includes("hangover"));
  });

  it("bruger karakter-navne når identity har dem", () => {
    const plan = buildSearchPlan({
      title: "Iron Flame",
      author: "Rebecca Yarros",
      mmc: "Xaden Riorson",
      fmc: "Violet",
    });
    assert.ok(plan[0].userPrompt.includes("Xaden Riorson"));
    assert.ok(plan[0].userPrompt.includes("Violet"));
    assert.ok(plan[1].userPrompt.includes("Violet"));
    assert.ok(plan[1].userPrompt.includes("Xaden"));
  });

  it("er stabil for samme identity", () => {
    const a = buildSearchPlan({ title: "Reign & Ruin", author: "J.D. Evans" });
    const b = buildSearchPlan({ title: "Reign & Ruin", author: "J.D. Evans" });
    assert.deepEqual(a, b);
  });
});

describe("inferLeadCharactersFromResearch", () => {
  it("finder navne i 'mellem X og Y'", () => {
    const inferred = inferLeadCharactersFromResearch({
      sources: [
        {
          summary:
            "Anca fremhæver komplekse karakterdynamikker, især mellem Violet og Xaden.",
        },
      ],
    });
    assert.equal(inferred.fmc, "Violet");
    assert.equal(inferred.mmc, "Xaden");
  });
});

describe("kilde-tiers", () => {
  it("klassificerer professionelle hosts", () => {
    assert.equal(
      classifySourceType(
        "https://www.kirkusreviews.com/book-reviews/foo",
        "Kirkus review",
        "blog"
      ),
      "professional"
    );
  });

  it("stoler ikke på model-labels over URL", () => {
    assert.equal(
      classifySourceType(
        "https://books.google.com/books?id=x",
        "Harry Potter",
        "official"
      ),
      "catalog"
    );
    assert.equal(
      classifySourceType(
        "https://www.reddit.com/r/books/comments/1",
        "thread",
        "blog"
      ),
      "forum"
    );
  });

  it("prioriterer helteprofil-batch og dropper lore", () => {
    const sources = selectValuableSources([
      {
        title: "Gush: ultimate touch-her-and-die MMC",
        url: "https://www.reddit.com/r/fantasyromance/comments/aa1/just_finished_review_thad/",
        type: "forum",
        batch: "helteprofil",
        summary: "protective MMC touch her and die bodyguard vibe review",
      },
      {
        title: "Harry was missing for 24 hours. Where was he?",
        url: "https://reddit.com/r/harrypotter/comments/zz1/harry_was_missing_for_24_hours",
        type: "forum",
        batch: "helteprofil",
        summary: "timeline speculation",
      },
      {
        title: "Spice rating open door",
        url: "https://spiceblog.example/review-foo",
        type: "blog",
        batch: "romanceprofil",
        summary: "spice rating steam open door romance is A-plot",
      },
    ]);
    assert.ok(sources.some((s) => s.batch === "helteprofil"));
    assert.ok(sources.some((s) => s.batch === "romanceprofil"));
    assert.ok(!sources.some((s) => /missing for/i.test(s.title)));
    const f = summarizeSourceFoundation(sources);
    assert.ok(f.helteprofil >= 1);
    assert.ok(f.romanceprofil >= 1);
  });

  it("bevarer samme URL i flere batches (plotkarakter stjæles ikke)", () => {
    const url = "https://www.goodreads.com/book/show/12345-burn-for-me";
    const sources = selectValuableSources([
      {
        title: "Burn for Me",
        url,
        type: "goodreads",
        batch: "helteprofil",
        summary: "Mad Rogan is protective of Nevada bodyguard vibe review",
      },
      {
        title: "Burn for Me plot",
        url,
        type: "goodreads",
        batch: "plotkarakter",
        summary: "worldbuilding character development pacing plot review",
      },
      {
        title: "Burn for Me series",
        url,
        type: "goodreads",
        batch: "helhed",
        summary: "book hangover binge worth it series review",
      },
    ]);
    assert.ok(sources.some((s) => s.batch === "helteprofil"));
    assert.ok(sources.some((s) => s.batch === "plotkarakter"));
    assert.ok(sources.some((s) => s.batch === "helhed"));
  });

  it("afviser Reddit-lore der ikke er anmeldelser", () => {
    assert.equal(
      looksLikeReaderDiscussion(
        "https://fr.reddit.com/r/harrypotter/comments/1hx7tba/harry_was_missing_for_24_hours_before_he_was/",
        "Harry was missing for 24 hours before he was dropped off. Where was he?",
        "timeline"
      ),
      false
    );
  });

  it("forum alene kan ikke give high confidence", () => {
    const sources = normalizeSources([
      {
        title: "Just finished — review",
        url: "https://reddit.com/r/books/comments/1/just_finished_review",
        type: "forum",
        batch: "helteprofil",
        summary: "protective MMC spice review",
      },
    ]);
    assert.equal(sources.length, 1);
    const cons = normalizeConsensus(
      {
        spice: {
          finding: "Spice nævnes",
          consensus: "strong",
          confidence: "high",
          supportingSourceIds: [sources[0].id],
          conflictingSourceIds: [],
        },
      },
      sources
    );
    assert.equal(cons.spice.confidence, "medium");
  });

  it("henter rå URL'er fra web_search_call.action.sources", () => {
    const urls = extractRawSearchUrls({
      output: [
        {
          type: "web_search_call",
          action: {
            type: "search",
            sources: [{ type: "url", url: "https://reddit.com/r/books/1" }],
          },
        },
      ],
    });
    assert.equal(urls.length, 1);
  });

  it("canonicalize stripper utm på Goodreads", () => {
    assert.equal(
      canonicalizeUrl(
        "https://www.goodreads.com/book/show/49813-harry?utm_source=openai"
      ),
      "https://goodreads.com/book/show/49813"
    );
    assert.ok(
      isIndustryNoise(
        "https://www.publishersweekly.com/pw/print/19990111/29565-letter-from-london.html",
        "Letter from London"
      )
    );
  });
});

describe("partial ved få anmeldelser", () => {
  it("sætter partial + advarsel når review-like < 2", () => {
    const research = normalizeResearch(
      {
        sources: [
          {
            title: "Wiki",
            url: "https://en.wikipedia.org/wiki/Foo",
            type: "wikipedia",
            summary: "facts",
          },
        ],
        reviewConsensus: {},
        facts: {},
      },
      { title: "Foo", author: "Bar" }
    );
    assert.equal(research.meta.partial, true);
  });
});

describe("Tine-score diskrimination", () => {
  it("romantasy-match scorer højere end lav-romance fantasy", () => {
    const low = estimateTineScoreFromVibes({
      "Episk plot (0-5)": 5,
      "Worldbuilding (0-5)": 5,
      "Kvindelig udvikling (0-5)": 3,
      "Karakterudvikling (0-5)": 4,
      "Beskyttende helt(e) (0-5)": 2,
      "Bodyguard-vibe (0-5)": 1,
      "Touch her and die-vibe (0-5)": 1,
      "Rhysand-faktoren": 2,
      "Book hangover (0-5)": 4,
      "Spice/erotik kvalitet (0-5)": 0,
      "Romance i fokus (0-100%)": 15,
    });
    const high = estimateTineScoreFromVibes({
      "Episk plot (0-5)": 5,
      "Worldbuilding (0-5)": 4,
      "Kvindelig udvikling (0-5)": 5,
      "Karakterudvikling (0-5)": 5,
      "Beskyttende helt(e) (0-5)": 5,
      "Bodyguard-vibe (0-5)": 5,
      "Touch her and die-vibe (0-5)": 5,
      "Rhysand-faktoren": 5,
      "Book hangover (0-5)": 4,
      "Spice/erotik kvalitet (0-5)": 4,
      "Romance i fokus (0-100%)": 90,
    });
    assert.ok(low != null && high != null);
    assert.ok(high - low >= 10, `expected gap >=10, got ${high}-${low}`);
  });
});
