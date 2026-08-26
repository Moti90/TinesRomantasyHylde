import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PAIRING_RELATIONS,
  attachSeriesRomanceIdentity,
  isAnotherPrimaryPairing,
  isAlternativeLoveInterest,
  isPreservableRomanceIdentity,
  legacySeriesIdentityFromRomance,
  normalizeSeriesRomanceIdentity,
  seriesRomanceIdentityFromLegacy,
} from "../server/services/seriesRomanceIdentity.js";
import {
  attachDiscoveredRomanceIdentity,
  classifyRomanceTopology,
  mapRomanceEvidence,
  pickDiscoveryReason,
  romanceIdentityFromStructuredOutput,
  stampTopologyDiscovery,
  validateRomanceTopology,
} from "../server/services/seriesRomanceDiscovery.js";
import { canonicalizeUrl, tryParseFocusedSearchText } from "../server/services/webResearch.js";

const WREN = "Wren";
const KAEL = "Kael";
const SERA = "Sera";
const DORIAN = "Dorian";
const NESSA = "Nessa";
const TORIN = "Torin";

function member(name, slot) {
  return { name, role: "romantic_lead", slot };
}

function primaryPairing({ members, bookScopes = [], arcScopes = [], relation = null, basis = [], alternatives = [] }) {
  return {
    members,
    bookScopes,
    arcScopes,
    prominence: "primary",
    relation,
    confidence: "high",
    basis,
    alternatives,
  };
}

function rotatingDraft() {
  return {
    topology: "rotating_couples",
    pairings: [
      primaryPairing({
        members: [member(WREN, "fmc"), member(KAEL, "mmc")],
        bookScopes: [{ bookNumber: 1, title: "Glass One" }],
        relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        basis: ["book_primary"],
      }),
      primaryPairing({
        members: [member(SERA, "fmc"), member(DORIAN, "mmc")],
        bookScopes: [{ bookNumber: 2, title: "Glass Two" }],
        relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        basis: ["book_primary"],
      }),
    ],
  };
}

describe("series romance discovery", () => {
  it("1. eksisterende single-couple input normaliseres som før", () => {
    const legacy = {
      mmc: KAEL,
      fmc: WREN,
      confidence: "high",
      basis: ["central_pairing"],
      alternatives: [{ name: "Rook", role: "early_love_interest" }],
      resolution: { resolved: true, reason: "series_pairing_confirmed" },
    };
    const romance = seriesRomanceIdentityFromLegacy(legacy);
    assert.equal(romance.topology, "single_couple");
    assert.equal(romance.pairings.length, 1);
    const back = legacySeriesIdentityFromRomance(romance);
    assert.equal(back.mmc, KAEL);
    assert.equal(back.fmc, WREN);
    assert.equal(back.alternatives[0].role, "early_love_interest");
  });

  it("2. én resolved primary pairing med series-level evidens → single_couple", () => {
    const romance = validateRomanceTopology({
      topology: "unknown",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [
            { bookNumber: 1, title: "Glass One" },
            { bookNumber: 2, title: "Glass Two" },
          ],
          basis: ["later-series central pairing", "endgame"],
        }),
      ],
    });
    assert.equal(romance.topology, "single_couple");
    assert.equal(romance.resolution.resolved, true);
    assert.equal(romance.observability.legacyIdentityRepresentativeOfSeries, true);
  });

  it("3. én fundet pairing uden tilstrækkelig topology-evidens → unknown", () => {
    const romance = validateRomanceTopology({
      topology: "single_couple",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          basis: ["between"],
        }),
      ],
    });
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.resolution.resolved, false);
    assert.match(romance.resolution.reason, /insufficient_series_scope/);
    assert.equal(romance.pairings.length, 1);
  });

  it("4. flere legitime primary pairings med separate bookScopes → rotating_couples", () => {
    const romance = validateRomanceTopology(rotatingDraft());
    assert.equal(romance.topology, "rotating_couples");
    assert.equal(romance.resolution.resolved, true);
    assert.equal(romance.pairings.length, 2);
    assert.equal(romance.observability.legacyIdentityRepresentativeOfSeries, false);
  });

  it("5. flere legitime pairings udløser ikke automatisk ambiguous candidates", () => {
    const romance = validateRomanceTopology(rotatingDraft());
    assert.equal(romance.topology, "rotating_couples");
    assert.equal(
      /ambiguous_candidates|pairing_shift_unresolved/.test(
        romance.resolution.reason
      ),
      false
    );
  });

  it("6. reel love triangle bliver ikke fejlagtigt rotating", () => {
    const romance = validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
        }),
        primaryPairing({
          members: [member(WREN, "fmc"), member(DORIAN, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
        }),
      ],
    });
    assert.notEqual(romance.topology, "rotating_couples");
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.resolution.resolved, false);
    assert.equal(romance.pairings.length, 2);
  });

  it("7. partner-switch bliver ikke automatisk rotating per book", () => {
    const romance = validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          basis: ["early relationship"],
        }),
        primaryPairing({
          members: [member(WREN, "fmc"), member(DORIAN, "mmc")],
          bookScopes: [{ bookNumber: 2, title: "Glass Two" }],
          basis: ["replaces former partner"],
        }),
      ],
    });
    assert.notEqual(romance.topology, "rotating_couples");
    assert.equal(romance.topology, "unknown");
    assert.match(romance.resolution.reason, /partner_switch_not_rotating/);
  });

  it("8. ensemble med overlappende legitime pairings kan blive ensemble_mixed", () => {
    const romance = validateRomanceTopology({
      topology: "unknown",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [
            { bookNumber: 1, title: "Glass One" },
            { bookNumber: 2, title: "Glass Two" },
          ],
        }),
        primaryPairing({
          members: [member(NESSA, "fmc"), member(TORIN, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
        }),
      ],
    });
    assert.equal(romance.topology, "ensemble_mixed");
    assert.equal(romance.resolution.resolved, true);
  });

  it("9. utilstrækkelig evidens → unknown", () => {
    const romance = validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
        }),
        primaryPairing({
          members: [member(SERA, "fmc"), member(DORIAN, "mmc")],
        }),
      ],
    });
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.resolution.resolved, false);
    assert.equal(romance.pairings.length, 2);
  });

  it("10. structured output med flere pairings parser tabsfrit", () => {
    const parsed = tryParseFocusedSearchText(
      JSON.stringify({
        topology: "rotating_couples",
        pairings: rotatingDraft().pairings,
        pairing: {
          fmc: WREN,
          mmc: KAEL,
          confidence: "high",
          basis: ["book_primary"],
          alternatives: [],
        },
        findings: [
          {
            url: "https://guides.example.com/glass/romance",
            title: "Romance guide",
            summary: "Each book follows a different couple.",
            type: "blog",
          },
        ],
      }),
      { purpose: "identity" }
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.pairing.mmc, KAEL);
    assert.equal(parsed.romanceIdentity.pairings.length, 2);
    assert.equal(parsed.romanceIdentity.pairings[0].bookScopes[0].bookNumber, 1);
    assert.equal(parsed.romanceIdentity.pairings[1].bookScopes[0].bookNumber, 2);
  });

  it("11. gammelt singular structured output parser fortsat", () => {
    const parsed = tryParseFocusedSearchText(
      JSON.stringify({
        pairing: {
          fmc: WREN,
          mmc: KAEL,
          confidence: "high",
          basis: ["later-series central pairing"],
          alternatives: [{ name: "Rook", role: "early_love_interest" }],
        },
        findings: [
          {
            url: "https://wiki.example.com/glass/pairing",
            title: "Pairing",
            summary: "Later books establish Kael as endgame.",
            type: "blog",
          },
        ],
      }),
      { purpose: "identity" }
    );
    assert.equal(parsed.ok, true);
    assert.equal(parsed.pairing.fmc, WREN);
    assert.equal(parsed.pairing.mmc, KAEL);
    assert.equal(parsed.pairing.alternatives[0].name, "Rook");
    assert.equal(parsed.romanceIdentity.pairings.length, 1);
  });

  it("12. rotating/ensemble skaber ingen NY legacy winner projection", () => {
    const rotating = validateRomanceTopology(rotatingDraft());
    const ensemble = validateRomanceTopology({
      topology: "ensemble_mixed",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
        }),
        primaryPairing({
          members: [member(NESSA, "fmc"), member(TORIN, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
        }),
      ],
    });
    const fallback = { mmc: "OldMmc", fmc: "OldFmc" };
    assert.equal(legacySeriesIdentityFromRomance(rotating, fallback), fallback);
    assert.equal(legacySeriesIdentityFromRomance(ensemble), null);
  });

  it("13. eksisterende legacy seriesIdentity forbliver uændret ved rotating discovery", () => {
    const seriesIdentity = {
      mmc: KAEL,
      fmc: WREN,
      confidence: "medium",
      alternatives: [],
      resolution: { resolved: false, reason: "ambiguous_candidates" },
    };
    const research = { seriesIdentity };
    const discovered = validateRomanceTopology(rotatingDraft());
    attachDiscoveredRomanceIdentity(research, discovered);
    assert.equal(research.seriesIdentity, seriesIdentity);
    assert.equal(research.seriesIdentity.mmc, KAEL);
    assert.equal(research.seriesIdentity.resolution.reason, "ambiguous_candidates");
    assert.equal(research.seriesRomanceIdentity.topology, "rotating_couples");
  });

  it("14. pairing/book scope bevares gennem normalization", () => {
    const romance = validateRomanceTopology(rotatingDraft());
    assert.equal(romance.pairings[0].bookScopes[0].bookNumber, 1);
    assert.equal(romance.pairings[0].bookScopes[0].title, "Glass One");
    assert.equal(romance.pairings[1].bookScopes[0].bookNumber, 2);
  });

  it("15. pairing/arc scope bevares", () => {
    const romance = validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          arcScopes: [{ id: "arc-a", label: "First court" }],
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        }),
        primaryPairing({
          members: [member(SERA, "fmc"), member(DORIAN, "mmc")],
          arcScopes: [{ id: "arc-b", label: "Second court" }],
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        }),
      ],
    });
    assert.equal(romance.topology, "rotating_couples");
    assert.equal(romance.pairings[0].arcScopes[0].id, "arc-a");
    assert.equal(romance.pairings[1].arcScopes[0].label, "Second court");
  });

  it("16. pairing-rækkefølge ændrer ikke topology-resultatet", () => {
    const a = rotatingDraft();
    const b = {
      topology: "rotating_couples",
      pairings: [...a.pairings].reverse(),
    };
    const left = classifyRomanceTopology(
      validateRomanceTopology(a).pairings
    );
    const right = classifyRomanceTopology(
      validateRomanceTopology(b).pairings
    );
    assert.equal(left.topology, right.topology);
    assert.equal(left.reason, right.reason);
    assert.equal(validateRomanceTopology(a).topology, "rotating_couples");
    assert.equal(validateRomanceTopology(b).topology, "rotating_couples");
  });

  it("17. richer seriesRomanceIdentity overlever rebuild/reanalyse tabsfrit", () => {
    const discovered = validateRomanceTopology(rotatingDraft());
    const research = {
      seriesIdentity: {
        mmc: KAEL,
        fmc: WREN,
        resolution: { resolved: true, reason: "series_endgame_supported" },
      },
      seriesRomanceIdentity: discovered,
    };
    attachSeriesRomanceIdentity(research, {
      mmc: "Other",
      fmc: "OtherFmc",
      resolution: { resolved: true, reason: "legacy_single_couple" },
    });
    assert.equal(research.seriesRomanceIdentity.topology, "rotating_couples");
    assert.equal(research.seriesRomanceIdentity.pairings.length, 2);
    assert.equal(research.seriesRomanceIdentity.pairings[0].bookScopes[0].bookNumber, 1);
    assert.equal(research.seriesIdentity.mmc, KAEL);
  });

  it("another_primary_pairing kræver scope og er ikke alternative_love_interest", () => {
    const unscoped = validateRomanceTopology({
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          basis: ["later-series central pairing"],
        }),
        primaryPairing({
          members: [member(SERA, "fmc"), member(DORIAN, "mmc")],
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        }),
      ],
    });
    assert.equal(isAnotherPrimaryPairing(unscoped.pairings[1]), false);
    const scoped = validateRomanceTopology(rotatingDraft());
    assert.equal(isAnotherPrimaryPairing(scoped.pairings[1]), true);
    assert.equal(isAlternativeLoveInterest(scoped.pairings[1]), false);
    const triangleAlt = normalizeSeriesRomanceIdentity({
      topology: "unknown",
      pairings: [
        {
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          alternatives: [{ name: DORIAN, role: "early_love_interest" }],
        },
      ],
    });
    assert.equal(isAlternativeLoveInterest(triangleAlt.pairings[0].alternatives[0]), true);
    assert.equal(isAnotherPrimaryPairing(triangleAlt.pairings[0].alternatives[0]), false);
  });

  it("evidenceUrls/finding-indeks mappes til namespacede refs og opfinder ingen ids", () => {
    const draft = validateRomanceTopology({
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [
            { bookNumber: 1, title: "Glass One" },
            { bookNumber: 2, title: "Glass Two" },
          ],
          basis: ["later-series central pairing"],
        }),
      ],
    });
    draft.pairings[0].evidenceUrls = ["https://guides.example.com/glass/romance"];
    draft.pairings[0].evidenceFindingIndexes = [0];
    draft.pairings[0].evidenceSourceIds = ["pairing-1"];
    const mapped = mapRomanceEvidence(draft, {
      findings: [
        { url: "https://guides.example.com/glass/romance", title: "Guide" },
      ],
      sources: [
        {
          id: "source-glass-1",
          url: "https://guides.example.com/glass/romance",
        },
      ],
    });
    assert.deepEqual(mapped.pairings[0].evidenceSourceIds, []);
    assert.deepEqual(mapped.pairings[0].evidenceRefs, [
      { namespace: "research_sources", id: "source-glass-1" },
      {
        namespace: "discovery_findings",
        index: 0,
        url: "https://guides.example.com/glass/romance",
      },
    ]);
    const empty = mapRomanceEvidence(draft, {
      findings: [{ url: "https://other.example.com/x" }],
      sources: [{ id: "source-other", url: "https://other.example.com/x" }],
    });
    assert.equal(empty.pairings[0].evidenceSourceIds.includes("pairing-1"), false);
    assert.equal(
      empty.pairings[0].evidenceRefs.some((r) => r.id === "pairing-1"),
      false
    );
  });

  it("claimed topology nedgraderes når evidensen ikke matcher", () => {
    const romance = validateRomanceTopology({
      topology: "single_couple",
      pairings: rotatingDraft().pairings,
    });
    assert.equal(romance.topology, "rotating_couples");
    const rejected = validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          basis: ["between"],
        }),
      ],
    });
    assert.equal(rejected.topology, "unknown");
    assert.match(rejected.resolution.reason, /claimed_rotating_couples_rejected/);
  });

  it("én pairing + ét bookScope + basis later_books → unknown", () => {
    const romance = validateRomanceTopology({
      topology: "single_couple",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          basis: ["later_books", "endgame"],
        }),
      ],
    });
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.resolution.resolved, false);
    assert.equal(romance.pairings.length, 1);
    assert.match(romance.resolution.reason, /insufficient_series_scope/);
  });

  it("én pairing + basis central_pairing uden scopes/evidence → unknown", () => {
    const romance = validateRomanceTopology({
      topology: "single_couple",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          basis: ["central_pairing"],
        }),
      ],
    });
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.resolution.resolved, false);
    assert.equal(romance.pairings.length, 1);
    assert.match(romance.resolution.reason, /insufficient_series_scope/);
  });

  it("samme pairing på tværs af flere bookScopes → single_couple", () => {
    const romance = validateRomanceTopology({
      topology: "unknown",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [
            { bookNumber: 1, title: "Glass One" },
            { bookNumber: 3, title: "Glass Three" },
          ],
        }),
      ],
    });
    assert.equal(romance.topology, "single_couple");
    assert.equal(romance.resolution.resolved, true);
    assert.equal(romance.pairings.length, 1);
  });

  it("modelgenereret evidence-reference uden verificerbar mapping resolver ikke single_couple", () => {
    const romance = validateRomanceTopology({
      topology: "single_couple",
      pairings: [
        {
          ...primaryPairing({
            members: [member(WREN, "fmc"), member(KAEL, "mmc")],
            bookScopes: [{ bookNumber: 1, title: "Glass One" }],
            basis: ["later-series central pairing"],
          }),
          evidenceUrls: ["https://model.example.com/invented-later-books"],
          evidenceFindingIndexes: [0],
          evidenceSourceIds: ["source-invented-1"],
        },
      ],
    });
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.resolution.resolved, false);
    assert.equal(romance.pairings.length, 1);
    const mapped = mapRomanceEvidence(romance, {
      findings: [{ url: "https://other.example.com/unrelated" }],
      sources: [{ id: "source-real", url: "https://other.example.com/unrelated" }],
    });
    assert.equal(mapped.topology, "unknown");
    assert.equal(mapped.resolution.resolved, false);
    assert.deepEqual(mapped.pairings[0].evidenceSourceIds, []);
    assert.equal(
      mapped.pairings[0].evidenceRefs.some((r) => r.id === "source-invented-1"),
      false
    );
    assert.equal(mapped.pairings.length, 1);
  });

  it("ét arcScope alene resolver ikke single_couple", () => {
    const romance = validateRomanceTopology({
      topology: "single_couple",
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          arcScopes: [{ id: "series", label: "full series arc" }],
          basis: ["endgame"],
        }),
      ],
    });
    assert.equal(romance.topology, "unknown");
    assert.equal(romance.resolution.resolved, false);
    assert.equal(romance.pairings[0].arcScopes[0].id, "series");
  });

  it("modelopfundet evidenceSourceId overlever ikke uden deterministisk mapping", () => {
    const romance = validateRomanceTopology({
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
        }),
      ],
    });
    romance.pairings[0].evidenceSourceIds = ["source-invented-1"];
    romance.pairings[0].evidenceUrls = [];
    const mapped = mapRomanceEvidence(romance, {
      findings: [],
      sources: [{ id: "source-real", url: "https://guides.example.com/glass/real" }],
    });
    assert.deepEqual(mapped.pairings[0].evidenceSourceIds, []);
    assert.deepEqual(mapped.pairings[0].evidenceRefs, []);
    assert.equal(mapped.pairings[0].members[0].name, WREN);
  });

  it("matching URL mod research.sources bliver research_sources-namespace, ikke bart ID", () => {
    const romance = validateRomanceTopology({
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
        }),
      ],
    });
    romance.pairings[0].evidenceUrls = ["https://guides.example.com/glass/match"];
    const mapped = mapRomanceEvidence(romance, {
      findings: [],
      sources: [
        { id: "source-4", url: "https://guides.example.com/glass/match" },
      ],
    });
    assert.deepEqual(mapped.pairings[0].evidenceSourceIds, []);
    assert.deepEqual(mapped.pairings[0].evidenceRefs, [
      { namespace: "research_sources", id: "source-4" },
    ]);
  });

  it("canonicaliserede URL-varianter producerer samme evidence-reference", () => {
    const romance = validateRomanceTopology({
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
        }),
      ],
    });
    romance.pairings[0].evidenceUrls = [
      "https://www.goodreads.com/book/show/12345-glass?utm_source=share",
    ];
    romance.pairings[0].evidenceFindingIndexes = [0];
    const mapped = mapRomanceEvidence(romance, {
      findings: [
        { url: "https://goodreads.com/book/show/12345", title: "GR" },
        { url: "https://www.goodreads.com/book/show/12345-glass", title: "dup" },
      ],
      sources: [],
    });
    const canon = canonicalizeUrl(
      "https://www.goodreads.com/book/show/12345-glass?utm_source=share"
    );
    assert.equal(mapped.discoveryEvidence.findings.length, 1);
    assert.deepEqual(mapped.pairings[0].evidenceFindingIndexes, [0]);
    assert.deepEqual(mapped.pairings[0].evidenceRefs, [
      { namespace: "discovery_findings", index: 0, url: canon },
    ]);
    assert.deepEqual(mapped.pairings[0].evidenceUrls, [canon]);
  });

  it("deduplikerede findings mapper index til det endeligt gemte array", () => {
    const romance = validateRomanceTopology({
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
        }),
      ],
    });
    romance.pairings[0].evidenceFindingIndexes = [1];
    const mapped = mapRomanceEvidence(romance, {
      findings: [
        { url: "https://guides.example.com/glass/one", title: "One" },
        { url: "https://guides.example.com/glass/two", title: "Two" },
        { url: "https://guides.example.com/glass/one", title: "One dup" },
      ],
    });
    assert.equal(mapped.discoveryEvidence.findings.length, 2);
    assert.deepEqual(mapped.pairings[0].evidenceFindingIndexes, [1]);
    assert.equal(
      mapped.pairings[0].evidenceRefs[0].index,
      1
    );
    assert.equal(
      mapped.discoveryEvidence.findings[1].url,
      "https://guides.example.com/glass/two"
    );
  });

  it("ugyldig evidence-reference droppes uden at droppe pairingen", () => {
    const romance = validateRomanceTopology({
      pairings: [
        primaryPairing({
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
        }),
      ],
    });
    romance.pairings[0].evidenceSourceIds = ["no-such-source"];
    romance.pairings[0].evidenceFindingIndexes = [99];
    romance.pairings[0].evidenceUrls = [
      "https://guides.example.com/glass/kept",
    ];
    const mapped = mapRomanceEvidence(romance, {
      findings: [{ url: "https://guides.example.com/glass/kept", title: "Kept" }],
      sources: [],
    });
    assert.equal(mapped.pairings.length, 1);
    assert.equal(mapped.pairings[0].members[0].name, WREN);
    assert.deepEqual(mapped.pairings[0].evidenceSourceIds, []);
    assert.equal(
      mapped.pairings[0].evidenceRefs.some((r) => r.id === "no-such-source"),
      false
    );
    assert.equal(mapped.pairings[0].evidenceRefs[0].namespace, "discovery_findings");
    assert.deepEqual(mapped.pairings[0].evidenceFindingIndexes, [0]);
  });

  it("execution-failure reason vinder over generisk validator reason", () => {
    assert.equal(
      pickDiscoveryReason("unspecified", "topology_discovery_failed"),
      "topology_discovery_failed"
    );
    const stamped = stampTopologyDiscovery(
      {
        topology: "unknown",
        pairings: [],
        resolution: { resolved: false, reason: "unspecified" },
        discovery: {
          source: "topology_discovery",
          attempted: true,
          resolved: false,
          reason: "topology_discovery_failed",
          version: "identity-v2",
          attemptedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      { reason: "unspecified" }
    );
    assert.equal(stamped.discovery.reason, "topology_discovery_failed");
    assert.equal(stamped.discovery.attempted, true);
    assert.equal(stamped.discovery.resolved, false);
    assert.equal(stamped.discovery.source, "topology_discovery");
  });

  it("attempted topology-discovery unknown uden scopes bevares mod legacy projection", () => {
    const attempted = stampTopologyDiscovery(
      { topology: "unknown", pairings: [] },
      { resolved: false, reason: "insufficient_topology_evidence" }
    );
    assert.equal(isPreservableRomanceIdentity(attempted), true);
    const research = {
      seriesIdentity: {
        mmc: KAEL,
        fmc: WREN,
        resolution: { resolved: true },
      },
      seriesRomanceIdentity: attempted,
    };
    attachSeriesRomanceIdentity(research, research.seriesIdentity);
    assert.equal(research.seriesRomanceIdentity.discovery.source, "topology_discovery");
    assert.equal(research.seriesRomanceIdentity.discovery.attempted, true);
    assert.equal(research.seriesRomanceIdentity.topology, "unknown");
    assert.equal(research.seriesRomanceIdentity.pairings.length, 0);
  });
});
