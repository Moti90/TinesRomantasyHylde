import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALTERNATIVE_LOVE_INTEREST,
  PAIRING_RELATIONS,
  attachSeriesRomanceIdentity,
  emptySeriesRomanceIdentity,
  isAlternativeLoveInterest,
  isAnotherPrimaryPairing,
  isSecondaryPairing,
  legacySeriesIdentityFromRomance,
  normalizeSeriesRomanceIdentity,
  seriesRomanceIdentityFromLegacy,
} from "../server/services/seriesRomanceIdentity.js";
import { assessSeriesIdentityResolution } from "../server/services/adaptiveResearch.js";

const MMC = "Bram";
const FMC = "Elowen";
const ALT = "Aldric";
const OTHER_FMC = "Lysa";
const OTHER_MMC = "Corin";

function resolvedLegacy(over = {}) {
  return {
    mmc: MMC,
    fmc: FMC,
    confidence: "high",
    basis: ["central_pairing"],
    alternatives: [{ name: ALT, role: "early_love_interest" }],
    resolution: {
      resolved: true,
      reason: "series_pairing_confirmed",
    },
    ...over,
  };
}

describe("series romance identity model", () => {
  it("1. eksisterende singular identity kan repræsenteres som single_couple", () => {
    const romance = seriesRomanceIdentityFromLegacy(resolvedLegacy());
    assert.equal(romance.topology, "single_couple");
    assert.equal(romance.pairings.length, 1);
    assert.equal(romance.resolution.resolved, true);
    assert.equal(romance.resolution.coverage, "single_couple");
    const names = romance.pairings[0].members.map((m) => m.name);
    assert.ok(names.includes(MMC));
    assert.ok(names.includes(FMC));
  });

  it("2. legacy single-couple-output forbliver uændret ved roundtrip", () => {
    const legacy = resolvedLegacy();
    const romance = seriesRomanceIdentityFromLegacy(legacy);
    const back = legacySeriesIdentityFromRomance(romance);
    assert.equal(back.mmc, legacy.mmc);
    assert.equal(back.fmc, legacy.fmc);
    assert.equal(back.resolution.resolved, true);
    assert.equal(back.alternatives.length, 1);
    assert.equal(back.alternatives[0].name, ALT);
    assert.equal(back.alternatives[0].role, "early_love_interest");
  });

  it("3. unknown må ikke automatisk blive single_couple", () => {
    const romance = normalizeSeriesRomanceIdentity({
      topology: "unknown",
      pairings: [
        {
          members: [
            { name: FMC, slot: "fmc" },
            { name: MMC, slot: "mmc" },
          ],
          prominence: "primary",
        },
      ],
      resolution: { resolved: false },
    });
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.pairings.length, 1);
    assert.equal(legacySeriesIdentityFromRomance(romance), null);
    const fromUnresolved = seriesRomanceIdentityFromLegacy({
      mmc: MMC,
      fmc: FMC,
      confidence: "low",
      alternatives: [],
      resolution: { resolved: false, reason: "low_confidence" },
    });
    assert.equal(fromUnresolved.topology, "unknown");
    assert.notEqual(fromUnresolved.topology, "single_couple");
  });

  it("4. modellen kan repræsentere 0 pairings", () => {
    const romance = normalizeSeriesRomanceIdentity(emptySeriesRomanceIdentity());
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.pairings.length, 0);
    assert.equal(romance.resolution.coverage, "none");
    assert.equal(legacySeriesIdentityFromRomance(romance), null);
  });

  it("5. modellen kan repræsentere 1 pairing", () => {
    const romance = normalizeSeriesRomanceIdentity({
      topology: "single_couple",
      pairings: [
        {
          members: [
            { name: FMC, slot: "fmc" },
            { name: MMC, slot: "mmc" },
          ],
          prominence: "primary",
        },
      ],
      resolution: { resolved: true, reason: "provided" },
    });
    assert.equal(romance.pairings.length, 1);
    assert.equal(romance.pairings[0].prominence, "primary");
  });

  it("6. modellen kan repræsentere flere pairings", () => {
    const romance = normalizeSeriesRomanceIdentity({
      topology: "rotating_couples",
      pairings: [
        {
          members: [
            { name: FMC, slot: "fmc" },
            { name: MMC, slot: "mmc" },
          ],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          members: [
            { name: OTHER_FMC, slot: "fmc" },
            { name: OTHER_MMC, slot: "mmc" },
          ],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
      ],
      resolution: { resolved: true, reason: "multi_pairing" },
    });
    assert.equal(romance.topology, "rotating_couples");
    assert.equal(romance.pairings.length, 2);
    assert.equal(legacySeriesIdentityFromRomance(romance), null);
  });

  it("7. pairings kan bevare book scope", () => {
    const romance = normalizeSeriesRomanceIdentity({
      topology: "rotating_couples",
      pairings: [
        {
          members: [{ name: FMC }, { name: MMC }],
          bookScopes: [{ bookNumber: 1, title: "Ember One" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
      ],
    });
    assert.equal(romance.pairings[0].bookScopes.length, 1);
    assert.equal(romance.pairings[0].bookScopes[0].bookNumber, 1);
    assert.equal(romance.pairings[0].bookScopes[0].title, "Ember One");
  });

  it("8. pairings kan bevare arc scope", () => {
    const romance = normalizeSeriesRomanceIdentity({
      topology: "ensemble_mixed",
      pairings: [
        {
          members: [{ name: FMC }, { name: MMC }],
          arcScopes: [{ id: "arc-a", label: "First court arc" }],
          prominence: "primary",
        },
      ],
    });
    assert.equal(romance.pairings[0].arcScopes.length, 1);
    assert.equal(romance.pairings[0].arcScopes[0].id, "arc-a");
    assert.equal(romance.pairings[0].arcScopes[0].label, "First court arc");
  });

  it("9. alternative_love_interest og another_primary_pairing er semantisk forskellige", () => {
    const romance = normalizeSeriesRomanceIdentity({
      topology: "rotating_couples",
      pairings: [
        {
          members: [
            { name: FMC, slot: "fmc" },
            { name: MMC, slot: "mmc" },
          ],
          prominence: "primary",
          alternatives: [{ name: ALT, role: "early_love_interest" }],
        },
        {
          members: [
            { name: OTHER_FMC, slot: "fmc" },
            { name: OTHER_MMC, slot: "mmc" },
          ],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          members: [{ name: "Soren" }, { name: "Mira" }],
          prominence: "secondary",
        },
      ],
    });
    const first = romance.pairings[0];
    const otherPrimary = romance.pairings[1];
    const secondary = romance.pairings[2];
    assert.equal(first.alternatives.length, 1);
    assert.equal(isAlternativeLoveInterest(first.alternatives[0]), true);
    assert.equal(isAnotherPrimaryPairing(first.alternatives[0]), false);
    assert.equal(isAnotherPrimaryPairing(otherPrimary), true);
    assert.equal(isAlternativeLoveInterest(otherPrimary), false);
    assert.equal(isSecondaryPairing(secondary), true);
    assert.equal(isAnotherPrimaryPairing(secondary), false);
    assert.equal(
      romance.pairings.some((p) => p.members.some((m) => m.name === ALT)),
      false
    );
  });

  it("10. rækkefølgen af pairings ændrer ikke legacy projection", () => {
    const primary = {
      members: [
        { name: FMC, slot: "fmc" },
        { name: MMC, slot: "mmc" },
      ],
      prominence: "primary",
      confidence: "high",
      alternatives: [{ name: ALT, role: "early_love_interest" }],
    };
    const secondary = {
      members: [{ name: "Mira" }, { name: "Soren" }],
      prominence: "secondary",
    };
    const a = normalizeSeriesRomanceIdentity({
      topology: "single_couple",
      pairings: [primary, secondary],
      resolution: { resolved: true, reason: "series_pairing_confirmed" },
    });
    const b = normalizeSeriesRomanceIdentity({
      topology: "single_couple",
      pairings: [secondary, primary],
      resolution: { resolved: true, reason: "series_pairing_confirmed" },
    });
    const left = legacySeriesIdentityFromRomance(a);
    const right = legacySeriesIdentityFromRomance(b);
    assert.equal(left.mmc, right.mmc);
    assert.equal(left.fmc, right.fmc);
    assert.equal(left.alternatives[0].name, right.alternatives[0].name);
  });

  it("11. eksisterende single-couple fixtures giver samme seriesIdentity som før", () => {
    const assessed = assessSeriesIdentityResolution(
      {
        mmc: MMC,
        fmc: FMC,
        confidence: "high",
        basis: ["central_pairing", "endgame_partner"],
        alternatives: [{ name: ALT, role: "early_love_interest" }],
        mmcEndgame: true,
      },
      {
        identity: {
          title: "The Ember Cycle",
          series: "The Ember Cycle",
          isSeries: true,
        },
      }
    );
    const romance = seriesRomanceIdentityFromLegacy(assessed);
    const projected = legacySeriesIdentityFromRomance(romance);
    assert.equal(assessed.mmc, MMC);
    assert.equal(assessed.fmc, FMC);
    assert.equal(projected.mmc, assessed.mmc);
    assert.equal(projected.fmc, assessed.fmc);
    const frozen = {
      mmc: assessed.mmc,
      fmc: assessed.fmc,
      alternatives: assessed.alternatives.map((a) => ({
        name: a.name,
        role: a.role,
      })),
    };
    const research = { seriesIdentity: assessed };
    attachSeriesRomanceIdentity(research, assessed);
    assert.equal(research.seriesIdentity.mmc, frozen.mmc);
    assert.equal(research.seriesIdentity.fmc, frozen.fmc);
    assert.deepEqual(
      research.seriesIdentity.alternatives.map((a) => ({
        name: a.name,
        role: a.role,
      })),
      frozen.alternatives
    );
    assert.equal(research.seriesRomanceIdentity.topology, "single_couple");
    assert.notEqual(research.seriesRomanceIdentity, research.seriesIdentity);
  });

  it("attach muterer ikke selve seriesIdentity-objektet", () => {
    const identity = resolvedLegacy();
    const research = { seriesIdentity: identity };
    attachSeriesRomanceIdentity(research, identity);
    assert.equal(research.seriesIdentity, identity);
    assert.equal(identity.mmc, MMC);
    assert.equal(identity.alternatives[0].role, "early_love_interest");
  });
});
