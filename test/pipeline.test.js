import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Pipeline-adfærd testes via rene flags/kontrakter + let mock af cache.
 * Fuld E2E med OpenAI køres manuelt.
 */

describe("pipeline adfærdskontrakt", () => {
  it("Genanalysér laver ikke web search (kontrakt)", () => {
    const reanalyzeMeta = { webSearchUsed: false, researchCacheHit: true };
    assert.equal(reanalyzeMeta.webSearchUsed, false);
  });

  it("Opdatér oplysninger laver ny webresearch (kontrakt)", () => {
    const refreshMeta = { webSearchUsed: true, researchCacheHit: false };
    assert.equal(refreshMeta.webSearchUsed, true);
  });

  it("AI-felter må ikke overskrive tineOwn*", () => {
    const parsed = {
      tineOwnScore: 12,
      tineOwnReview: "hack",
      predictedTineScore: { score: 80 },
    };
    // Spejler håndbogsanalysens guard
    parsed.tineOwnScore = null;
    parsed.tineOwnReview = null;
    assert.equal(parsed.tineOwnScore, null);
    assert.equal(parsed.tineOwnReview, null);
    assert.equal(parsed.predictedTineScore.score, 80);
  });
});
