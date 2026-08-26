import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  needsLegacyIdentityResolution,
  shouldTriggerIdentitySearch,
} from "../server/services/adaptiveResearch.js";
import { rebuildResearchFromSources, runAdaptiveResearch } from "../server/services/adaptiveResearchLoop.js";
import {
  IDENTITY_JOB_MODES,
  PAIRING_RELATIONS,
  emptyRomanceDiscovery,
  isPreservableRomanceIdentity,
  seriesRomanceIdentityFromLegacy,
} from "../server/services/seriesRomanceIdentity.js";
import {
  mapRomanceEvidence,
  romanceTopologyDiscoveryDecision,
  shouldTriggerRomanceTopologyDiscovery,
  stampTopologyDiscovery,
  validateRomanceTopology,
} from "../server/services/seriesRomanceDiscovery.js";
import { buildRetrievalApproaches } from "../server/services/searchRetrieval.js";
import { IDENTITY_RESOLUTION_VERSION } from "../server/services/versions.js";

const WREN = "Wren";
const KAEL = "Kael";
const SERA = "Sera";
const DORIAN = "Dorian";
const NESSA = "Nessa";
const TORIN = "Torin";

const seriesIdentity = {
  title: "The Glass Cycle",
  author: "A. Writer",
  series: "The Glass Cycle",
  firstBook: "Glass One",
  isSeries: true,
};

const standaloneIdentity = {
  title: "A Standalone Tale",
  author: "A. Writer",
};

function assessment(over = {}) {
  return {
    score: 3,
    confidence: "low",
    basis: "ai_inference",
    evidenceSourceIds: [],
    conflictingSourceIds: [],
    sourceCount: 0,
    sourceBatch: "helteprofil",
    reason: "",
    ...over,
  };
}

function weakAssessments() {
  return Object.fromEntries(SUBJECTIVE_KEYS.map((k) => [k, assessment()]));
}

function analysisWith(assessments) {
  return { meta: { assessments, estimatedCostUsd: 0.02 } };
}

function resolvedLeads(over = {}) {
  return {
    mmc: KAEL,
    fmc: WREN,
    confidence: "high",
    basis: ["central_pairing"],
    alternatives: [],
    resolution: { resolved: true, reason: "series_endgame_supported" },
    ...over,
  };
}

function unresolvedLeads() {
  return {
    mmc: "",
    fmc: WREN,
    confidence: "low",
    alternatives: [{ name: KAEL, role: "candidate_mmc" }],
    resolution: { resolved: false, reason: "missing_lead" },
  };
}

function member(name, slot) {
  return { name, role: "romantic_lead", slot };
}

function rotatingRomance() {
  return stampTopologyDiscovery(
    validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        {
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          members: [member(SERA, "fmc"), member(DORIAN, "mmc")],
          bookScopes: [{ bookNumber: 2, title: "Glass Two" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
      ],
    }),
    { resolved: true, attemptedAt: "2026-01-01T00:00:00.000Z" }
  );
}

function ensembleRomance() {
  return stampTopologyDiscovery(
    validateRomanceTopology({
      topology: "ensemble_mixed",
      pairings: [
        {
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [
            { bookNumber: 1, title: "Glass One" },
            { bookNumber: 2, title: "Glass Two" },
          ],
          prominence: "primary",
        },
        {
          members: [member(NESSA, "fmc"), member(TORIN, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          prominence: "primary",
        },
      ],
    }),
    { resolved: true, attemptedAt: "2026-01-01T00:00:00.000Z" }
  );
}

function singleCoupleRomance() {
  return stampTopologyDiscovery(
    validateRomanceTopology({
      topology: "single_couple",
      pairings: [
        {
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [
            { bookNumber: 1, title: "Glass One" },
            { bookNumber: 2, title: "Glass Two" },
          ],
          prominence: "primary",
        },
      ],
    }),
    { resolved: true, attemptedAt: "2026-01-01T00:00:00.000Z" }
  );
}

function unknownAttemptedRomance() {
  return stampTopologyDiscovery(
    validateRomanceTopology({
      topology: "unknown",
      pairings: [
        {
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Glass One" }],
          prominence: "primary",
        },
      ],
    }),
    { resolved: false, attemptedAt: "2026-01-01T00:00:00.000Z" }
  );
}

function researchWith(over = {}) {
  return {
    identity: { title: seriesIdentity.title, author: seriesIdentity.author },
    sources: over.sources || [
      {
        id: "source-1",
        url: "https://reviews.example.com/glass-stable",
        type: "blog",
        summary:
          "Book 1 through later series: Kael remains the heroine's primary romantic partner. Wren and Kael are the central romantic pairing across the series.",
      },
    ],
    reviewConsensus: {},
    facts: {},
    ratings: {},
    meta: { webSearchCalls: 4, estimatedCostUsd: 0.09, warnings: [] },
    seriesIdentity: over.seriesIdentity || resolvedLeads(),
    identityHint: over.identityHint ?? { fmc: WREN, mmc: KAEL, confidence: "high" },
    seriesRomanceIdentity: over.seriesRomanceIdentity,
    ...over,
  };
}

function rotatingJobResult() {
  return {
    pairing: {
      fmc: WREN,
      mmc: KAEL,
      confidence: "high",
      basis: ["book_primary"],
      alternatives: [],
    },
    romanceIdentity: {
      topology: "rotating_couples",
      pairings: rotatingRomance().pairings,
    },
    sources: [
      {
        title: "Book 2 couple",
        url: "https://guides.example.com/glass/book-two",
        type: "blog",
        summary: `${SERA} and ${TORIN} are the romantic leads in book 2. ${NESSA} also appears.`,
      },
    ],
    findings: [
      {
        url: "https://guides.example.com/glass/book-two",
        title: "Book 2 couple",
        summary: `${SERA} and ${DORIAN} are the book 2 pairing.`,
        type: "blog",
      },
    ],
    webSearchCalls: 1,
    costUsd: 0.02,
  };
}

function identityOnlyExecutor(identityResult) {
  return async ({ job }) => {
    if (job.strategy === "series_identity_resolution") {
      return identityResult;
    }
    return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
  };
}

describe("series romance topology trigger", () => {
  it("legacy resolved + manglende seriesRomanceIdentity → topology_only", () => {
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: null,
    });
    assert.equal(decision.trigger, true);
    assert.equal(decision.reason, "missing_romance_identity");
    assert.equal(
      needsLegacyIdentityResolution(resolvedLeads(), seriesIdentity),
      false
    );
  });

  it("legacy resolved + legacy-afledt seriesRomanceIdentity → topology_only", () => {
    const legacy = seriesRomanceIdentityFromLegacy(resolvedLeads());
    legacy.discovery = emptyRomanceDiscovery({
      source: "legacy_projection",
      attempted: false,
    });
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: legacy,
    });
    assert.equal(decision.trigger, true);
    assert.equal(decision.reason, "legacy_projection_only");
  });

  it("legacy resolved + unknown uden topology-aware attempt → discovery trigges", () => {
    const unknown = validateRomanceTopology({
      topology: "unknown",
      pairings: [
        {
          members: [member(WREN, "fmc"), member(KAEL, "mmc")],
          prominence: "primary",
        },
      ],
    });
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: unknown,
    });
    assert.equal(decision.trigger, true);
    assert.equal(shouldTriggerRomanceTopologyDiscovery({
      identity: seriesIdentity,
      seriesRomanceIdentity: unknown,
    }), true);
  });

  it("legacy resolved + discovered rotating_couples → discovery trigges ikke", () => {
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: rotatingRomance(),
    });
    assert.equal(decision.trigger, false);
    assert.equal(decision.reason, "already_discovered_resolved");
  });

  it("legacy resolved + discovered ensemble_mixed → discovery trigges ikke", () => {
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: ensembleRomance(),
    });
    assert.equal(decision.trigger, false);
  });

  it("legacy resolved + discovered single_couple → discovery trigges ikke", () => {
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: singleCoupleRomance(),
    });
    assert.equal(decision.trigger, false);
  });

  it("non-series analyse → topology discovery trigges ikke", () => {
    const decision = romanceTopologyDiscoveryDecision({
      identity: standaloneIdentity,
      seriesRomanceIdentity: null,
    });
    assert.equal(decision.trigger, false);
    assert.equal(decision.reason, "not_series");
  });

  it("samme unresolved topology-discovery gentages ikke i analyze", () => {
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: unknownAttemptedRomance(),
      allowRetry: false,
    });
    assert.equal(decision.trigger, false);
    assert.equal(decision.reason, "already_attempted_unresolved");
  });

  it("refresh må retry unknown for samme version", () => {
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: unknownAttemptedRomance(),
      allowRetry: true,
    });
    assert.equal(decision.trigger, true);
    assert.equal(decision.reason, "refresh_retry_unknown");
  });

  it("nyere identity-version kan udløse nyt discovery-attempt", () => {
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: unknownAttemptedRomance(),
      identityVersion: "identity-v3",
      allowRetry: false,
    });
    assert.equal(decision.trigger, true);
    assert.equal(decision.reason, "newer_identity_version");
  });

  it("legacy unresolved → legacy_and_topology og eksisterende identity-adfærd", async () => {
    let identityCalls = 0;
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({
        seriesIdentity: unresolvedLeads(),
        sources: [
          {
            id: "source-1",
            summary: "Wren is the heroine. The male lead is unclear.",
            url: "https://blog.example.com/glass-unclear",
            type: "blog",
          },
        ],
        identityHint: null,
        seriesRomanceIdentity: null,
      }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            identityCalls += 1;
            return {
              pairing: {
                fmc: WREN,
                mmc: KAEL,
                confidence: "high",
                basis: ["later-series central pairing"],
                alternatives: [],
              },
              sources: [
                {
                  title: "Later books",
                  url: "https://wiki.example.com/glass/romance",
                  type: "blog",
                  summary:
                    "Later books establish Kael as Wren's central/endgame partner.",
                },
              ],
              webSearchCalls: 1,
              costUsd: 0.02,
            };
          }
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(identityCalls, 1);
    assert.equal(
      result.adaptive.identityResolution.identityJobMode,
      IDENTITY_JOB_MODES.LEGACY_AND_TOPOLOGY
    );
    assert.equal(result.research.seriesIdentity.mmc, KAEL);
    assert.equal(result.research.identityHint.mmc, KAEL);
  });

  it("legacy unresolved og topology mangler → højst ét identity-job", async () => {
    const strategies = [];
    await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({
        seriesIdentity: unresolvedLeads(),
        seriesRomanceIdentity: null,
        identityHint: null,
        sources: [
          {
            id: "source-1",
            summary: "Wren is the heroine.",
            url: "https://blog.example.com/glass-heroine",
            type: "blog",
          },
        ],
      }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxFollowUpRounds: 1,
        executeFollowUpJob: async ({ job }) => {
          strategies.push(job.strategy);
          if (job.strategy === "series_identity_resolution") {
            return rotatingJobResult();
          }
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(
      strategies.filter((s) => s === "series_identity_resolution").length,
      1
    );
  });

  it("maxIdentitySearches = 0 → ingen search", async () => {
    let identityCalls = 0;
    await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxIdentitySearches: 0,
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") identityCalls += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(identityCalls, 0);
  });

  it("utilstrækkeligt search-budget → ingen search", async () => {
    let calls = 0;
    await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxAdditionalWebSearchCalls: 0,
        executeFollowUpJob: async () => {
          calls += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(calls, 0);
  });

  it("utilstrækkeligt cost-budget → ingen search", async () => {
    let calls = 0;
    await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        maxAdditionalCostUsd: 0,
        executeFollowUpJob: async () => {
          calls += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(calls, 0);
  });

  it("topology-only bevarer seriesIdentity og identityHint deep-equal", async () => {
    const hint = { fmc: WREN, mmc: KAEL, confidence: "high" };
    const leads = resolvedLeads();
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({
        seriesIdentity: leads,
        identityHint: hint,
        seriesRomanceIdentity: null,
      }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            return rotatingJobResult();
          }
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(
      result.adaptive.identityResolution.identityJobMode,
      IDENTITY_JOB_MODES.TOPOLOGY_ONLY
    );
    assert.equal(result.research.seriesIdentity.mmc, KAEL);
    assert.equal(result.research.seriesIdentity.fmc, WREN);
    assert.deepEqual(result.research.seriesIdentity.alternatives, []);
    assert.equal(result.research.seriesIdentity.resolution.resolved, true);
    assert.deepEqual(result.research.identityHint, hint);
    assert.equal(
      result.adaptive.identityResolution.after.mmc,
      result.adaptive.identityResolution.before.mmc
    );
    assert.equal(
      result.adaptive.identityResolution.after.fmc,
      result.adaptive.identityResolution.before.fmc
    );
  });

  it("topology-only findings med andre karakterer ændrer ikke legacy MMC/FMC", async () => {
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: identityOnlyExecutor(rotatingJobResult()),
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(result.research.seriesIdentity.mmc, KAEL);
    assert.equal(result.research.seriesIdentity.fmc, WREN);
    assert.equal(
      (result.research.sources || []).some((s) =>
        /Torin|Nessa/.test(`${s.summary || ""} ${s.title || ""}`)
      ),
      false
    );
    assert.ok(result.research.seriesRomanceIdentity?.discoveryEvidence);
  });

  it("topology-only rotating skaber ingen legacy winner projection", async () => {
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: identityOnlyExecutor(rotatingJobResult()),
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(result.research.seriesRomanceIdentity.topology, "rotating_couples");
    assert.equal(result.research.seriesIdentity.mmc, KAEL);
    assert.equal(result.research.seriesIdentity.fmc, WREN);
    assert.equal(
      result.research.seriesRomanceIdentity.discovery.source,
      "topology_discovery"
    );
  });

  it("topology-only evidence ændrer ikke legacy identity ved senere analyze/rebuild", async () => {
    const first = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: identityOnlyExecutor(rotatingJobResult()),
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    let identityCalls = 0;
    const second = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: first.research,
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        mode: "analyze",
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") identityCalls += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(identityCalls, 0);
    assert.equal(second.research.seriesIdentity.mmc, KAEL);
    assert.equal(second.research.seriesIdentity.fmc, WREN);
    assert.equal(second.research.seriesRomanceIdentity.topology, "rotating_couples");
  });

  it("analyze gentager ikke samme unresolved discovery; refresh må", async () => {
    const first = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async () => ({
          pairing: {
            fmc: WREN,
            mmc: KAEL,
            confidence: "low",
            basis: ["between"],
            alternatives: [],
          },
          sources: [],
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(first.research.seriesRomanceIdentity.discovery.attempted, true);
    assert.equal(first.research.seriesRomanceIdentity.discovery.resolved, false);

    let analyzeCalls = 0;
    await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: first.research,
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        mode: "analyze",
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") analyzeCalls += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(analyzeCalls, 0);

    let refreshCalls = 0;
    await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: first.research,
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        mode: "refresh",
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") refreshCalls += 1;
          return rotatingJobResult();
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(refreshCalls, 1);
  });

  it("C.3 field-jobs får ikke identity topology-hints", () => {
    const approaches = buildRetrievalApproaches({
      series: { title: "The Glass Cycle" },
      leadCharacters: resolvedLeads(),
      targetFields: ["Beskyttende helt(e) (0-5)"],
      strategy: "hero_protective_dynamic",
      purpose: "field",
    });
    const blob = JSON.stringify(approaches);
    assert.equal(/romantic structure series/.test(blob), false);
    assert.equal(/each book romantic couple/.test(blob), false);
    assert.match(blob, /protects|keeps .* safe/i);
  });

  it("shouldTriggerIdentitySearch forbliver legacy-gated", () => {
    assert.equal(
      shouldTriggerIdentitySearch(resolvedLeads(), seriesIdentity),
      false
    );
    assert.equal(
      shouldTriggerIdentitySearch(unresolvedLeads(), seriesIdentity),
      true
    );
    assert.equal(IDENTITY_RESOLUTION_VERSION, "identity-v2");
  });

  it("thrown exception giver topology_discovery_failed og bevarer attempt-metadata", async () => {
    const result = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") {
            throw new Error("identity search exploded");
          }
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    const discovery = result.research.seriesRomanceIdentity.discovery;
    assert.equal(discovery.reason, "topology_discovery_failed");
    assert.equal(discovery.attempted, true);
    assert.equal(discovery.resolved, false);
    assert.equal(discovery.source, "topology_discovery");
    assert.equal(discovery.version, "identity-v2");
    assert.ok(discovery.attemptedAt);
  });

  it("legacy projection overskriver ikke attempted topology-discovery unknown", () => {
    const attempted = stampTopologyDiscovery(
      { topology: "unknown", pairings: [] },
      { resolved: false, attemptedAt: "2026-01-01T00:00:00.000Z" }
    );
    assert.equal(isPreservableRomanceIdentity(attempted), true);
    assert.equal(
      romanceTopologyDiscoveryDecision({
        identity: seriesIdentity,
        seriesRomanceIdentity: attempted,
        allowRetry: false,
      }).trigger,
      false
    );
  });

  it("analyze gentager ikke unresolved identity-v2-attempt efter rebuild", async () => {
    const first = await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: researchWith({ seriesRomanceIdentity: null }),
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        executeFollowUpJob: identityOnlyExecutor({
          pairing: { fmc: WREN, mmc: KAEL, confidence: "low", basis: [] },
          sources: [],
          findings: [
            { url: "https://guides.example.com/glass/a", title: "A" },
            { url: "https://guides.example.com/glass/b", title: "B" },
          ],
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    const findingsBefore = [
      ...(first.research.seriesRomanceIdentity.discoveryEvidence?.findings || []),
    ];
    const rebuilt = await rebuildResearchFromSources({
      identity: seriesIdentity,
      catalog: {},
      mofibo: {},
      sources: first.research.sources,
      previousResearch: first.research,
      synthesize: async () => ({ parsed: { sources: first.research.sources } }),
    });
    assert.deepEqual(
      rebuilt.research.seriesRomanceIdentity.discoveryEvidence?.findings,
      findingsBefore
    );
    assert.equal(
      rebuilt.research.seriesRomanceIdentity.discovery.attempted,
      true
    );
    let identityCalls = 0;
    await runAdaptiveResearch({
      identity: seriesIdentity,
      initialResearch: rebuilt.research,
      initialAnalysis: analysisWith(weakAssessments()),
      options: {
        mode: "analyze",
        executeFollowUpJob: async ({ job }) => {
          if (job.strategy === "series_identity_resolution") identityCalls += 1;
          return { sources: [], webSearchCalls: 1, costUsd: 0.01 };
        },
        synthesize: async () => ({ parsed: { sources: [] } }),
        analyze: async () => analysisWith(weakAssessments()),
      },
    });
    assert.equal(identityCalls, 0);
  });

  it("topology-only evidence refs overlever rebuild", async () => {
    const mapped = mapRomanceEvidence(
      {
        topology: "unknown",
        pairings: [
          {
            members: [member(WREN, "fmc"), member(KAEL, "mmc")],
            evidenceUrls: ["https://guides.example.com/glass/ref"],
          },
        ],
      },
      {
        findings: [{ url: "https://guides.example.com/glass/ref", title: "Ref" }],
        researchSources: [],
      }
    );
    const research = researchWith({
      seriesRomanceIdentity: stampTopologyDiscovery(mapped, {
        resolved: false,
        discoveryEvidence: mapped.discoveryEvidence,
      }),
    });
    const rebuilt = await rebuildResearchFromSources({
      identity: seriesIdentity,
      catalog: {},
      mofibo: {},
      sources: research.sources,
      previousResearch: research,
      synthesize: async () => ({ parsed: { sources: research.sources } }),
    });
    assert.deepEqual(
      rebuilt.research.seriesRomanceIdentity.pairings[0].evidenceRefs,
      mapped.pairings[0].evidenceRefs
    );
    assert.deepEqual(
      rebuilt.research.seriesRomanceIdentity.discoveryEvidence.findings,
      mapped.discoveryEvidence.findings
    );
  });

  it("nyere identity-version må fortsat forsøge efter bevaret attempt", () => {
    const attempted = stampTopologyDiscovery(
      { topology: "unknown", pairings: [] },
      { resolved: false, version: "identity-v2" }
    );
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: attempted,
      identityVersion: "identity-v3",
      allowRetry: false,
    });
    assert.equal(decision.trigger, true);
    assert.equal(decision.reason, "newer_identity_version");
  });

  it("refresh må fortsat forsøge efter bevaret unknown attempt", () => {
    const attempted = stampTopologyDiscovery(
      { topology: "unknown", pairings: [] },
      { resolved: false }
    );
    const decision = romanceTopologyDiscoveryDecision({
      identity: seriesIdentity,
      seriesRomanceIdentity: attempted,
      allowRetry: true,
    });
    assert.equal(decision.trigger, true);
    assert.equal(decision.reason, "refresh_retry_unknown");
  });
});
