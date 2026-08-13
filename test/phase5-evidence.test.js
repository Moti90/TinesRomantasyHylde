import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  isIndustryNoise,
  isPublisherPr,
  filterValidSourceIds,
  normalizeSources,
  normalizeConsensus,
  normalizeResearch,
  buildObservations,
} from "../server/services/webResearch.js";
import { RESEARCH_PROMPT_VERSION } from "../server/services/versions.js";

describe("Fase 5: evidens og konflikter", () => {
  it("bruger research-v14", () => {
    assert.equal(RESEARCH_PROMPT_VERSION, "research-v15");
  });

  it("afviser branchestøj og forlags-PR", () => {
    assert.equal(
      isIndustryNoise(
        "https://www.thebookseller.com/news/rights-sold-big-deal",
        "Rights sold in major deal"
      ),
      true
    );
    assert.equal(
      isPublisherPr(
        "https://www.penguinrandomhouse.com/books/123/foo/",
        "Buy the book"
      ),
      true
    );
  });

  it("fjerner ukendte kilde-id'er fra supportingSourceIds", () => {
    const sources = normalizeSources([
      {
        title: "Protective MMC review",
        url: "https://example-blog.com/review/foo",
        type: "blog",
        batch: "helteprofil",
        summary: "protective bodyguard spice review",
      },
    ]);
    assert.equal(sources.length, 1);
    assert.deepEqual(
      filterValidSourceIds([sources[0].id, "source-999", "ghost"], sources),
      [sources[0].id]
    );
  });

  it("marker konflikter som mixed, bygger observations og låser batches", () => {
    const sources = normalizeSources([
      {
        title: "High spice review",
        url: "https://blog-a.example/review/spice-high",
        type: "blog",
        batch: "romanceprofil",
        summary: "very steamy spice level review",
      },
      {
        title: "Fade to black review",
        url: "https://blog-b.example/review/spice-low",
        type: "blog",
        batch: "romanceprofil",
        summary: "fade to black almost no spice review",
      },
    ]);
    assert.equal(sources.length, 2);

    const cons = normalizeConsensus(
      {
        spice: {
          finding: "Kilder er uenige om spice-niveauet",
          consensus: "strong",
          confidence: "high",
          supportingSourceIds: [sources[0].id],
          conflictingSourceIds: [sources[1].id],
        },
      },
      sources
    );
    assert.equal(cons.spice.consensus, "mixed");
    assert.equal(cons.spice.hasConflict, true);
    assert.notEqual(cons.spice.confidence, "high");

    const research = normalizeResearch(
      {
        sources,
        reviewConsensus: {
          spice: {
            finding: "Kilder er uenige om spice-niveauet",
            consensus: "mixed",
            confidence: "medium",
            supportingSourceIds: [sources[0].id],
            conflictingSourceIds: [sources[1].id],
          },
        },
        facts: {},
      },
      { title: "Foo", author: "Bar" },
      { lockedSources: sources }
    );

    assert.equal(research.sources.length, 2);
    assert.equal(research.sources[0].batch, "romanceprofil");
    assert.ok(research.observations.some((o) => o.hasConflict));
    assert.ok(research.meta.evidence.conflictThemeCount >= 1);
    assert.match(research.meta.warnings.join(" "), /uenige/i);
  });

  it("buildObservations bruger danske labels", () => {
    const obs = buildObservations({
      touchHerAndDie: {
        finding: "MMC er beskyttende",
        consensus: "moderate",
        confidence: "medium",
        supportingSourceIds: ["source-1"],
        conflictingSourceIds: [],
      },
    });
    assert.equal(obs[0].label, "Touch her and die");
    assert.equal(obs[0].hasConflict, false);
  });

  it("UI nævner kildeuenighed", () => {
    const listSource = readFileSync(
      new URL("../public/js/ui/list.js", import.meta.url),
      "utf8"
    );
    assert.match(listSource, /Hvor kilderne er uenige/);
  });
});
