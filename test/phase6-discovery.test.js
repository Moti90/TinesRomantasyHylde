import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import {
  TEASER_SCHEMA_VERSION,
  buildFoundIn,
  deriveEvidenceBasis,
  evidenceBasisLabel,
  finalizeTeaser,
  isTeaserCacheFresh,
} from "../server/services/teaserTransparency.js";
import { DISCOVERY_PROMPT_VERSION } from "../server/services/versions.js";

describe("Fase 6: discovery-transparens", () => {
  it("bruger discovery-v2 og teaser schema v3", () => {
    assert.equal(DISCOVERY_PROMPT_VERSION, "discovery-v2");
    assert.equal(TEASER_SCHEMA_VERSION, 3);
  });

  it("bygger Fundet her fra kildesignaler", () => {
    const found = buildFoundIn([
      { signal: "beskyttende MMC", context: "if you liked ACOTAR" },
      { signal: "beskyttende MMC", context: "if you liked ACOTAR" },
      { signal: "slow burn", context: null },
    ]);
    assert.deepEqual(found, [
      "beskyttende MMC · if you liked ACOTAR",
      "slow burn",
    ]);
  });

  it("udleder evidensniveau", () => {
    assert.equal(deriveEvidenceBasis([{ a: 1 }, { b: 2 }, { c: 3 }], [{}, {}]), "kildebaseret");
    assert.equal(deriveEvidenceBasis([{ a: 1 }], [{}]), "delvist");
    assert.equal(deriveEvidenceBasis([], []), "tyndt");
    assert.equal(evidenceBasisLabel("tyndt"), "Tyndt kildegrundlag");
  });

  it("finalizeTeaser sætter danske transparensfelter", () => {
    const teaser = finalizeTeaser(
      {
        blurb: "En kort teaser.",
        vibe: "beskyttende MMC",
        whyMatch: "Passer til Tines smag",
        matchedParams: [
          { param: "Beskyttende helt", evidence: "nævnt i kilde" },
        ],
        uncertainParams: ["Spice"],
        penaltyHits: ["Ufærdig serie"],
        caution: "Serien er ikke færdig",
      },
      [
        { signal: "protective", context: "reddit thread" },
        { signal: "protective", context: "blog" },
        { signal: "romance", context: "review" },
      ],
      [{ name: "ACOTAR", tineScore: 95 }]
    );
    assert.equal(teaser.schemaVersion, 3);
    assert.equal(teaser.evidenceBasis, "delvist");
    assert.equal(teaser.evidenceLabel, "Delvist bekræftet");
    assert.ok(teaser.foundIn.length >= 1);
    assert.equal(teaser.matchedParams[0].param, "Beskyttende helt");
    assert.equal(teaser.references[0].name, "ACOTAR");
  });

  it("afviser gamle teaser-caches under schema v3", () => {
    assert.equal(
      isTeaserCacheFresh({ schemaVersion: 2, blurb: "gammel" }),
      false
    );
    assert.equal(
      isTeaserCacheFresh({ schemaVersion: 3, blurb: "ny" }),
      true
    );
  });

  it("UI bruger Fase 6-labels", () => {
    const ui = readFileSync(
      new URL("../public/js/ui/discovery.js", import.meta.url),
      "utf8"
    );
    assert.match(ui, /Bekræftet match/);
    assert.match(ui, /Usikkert \/ ikke bekræftet/);
    assert.match(ui, /Trækker ned \/ risiko/);
    assert.match(ui, /Fundet her/);
    assert.match(ui, /schemaVersion\) < 3/);
  });
});
