import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBJECTIVE_KEYS } from "../server/services/decisionScores.js";
import {
  rebuildResearchFromSources,
  runAdaptiveResearch,
  prepareFollowUpSources,
} from "../server/services/adaptiveResearchLoop.js";
import {
  ADAPTIVE_VERSION,
  SUBJECT_BINDING_VERSION,
} from "../server/services/versions.js";
import {
  PAIRING_RELATIONS,
} from "../server/services/seriesRomanceIdentity.js";
import {
  stampTopologyDiscovery,
  validateRomanceTopology,
} from "../server/services/seriesRomanceDiscovery.js";
import { buildRomanceScope } from "../server/services/seriesRomancePlanning.js";
import {
  buildScopedRetrievalRecord,
} from "../server/services/seriesRomanceRetrieval.js";
import {
  buildIdentityFingerprint,
  buildSubjectBinding,
  bindScopedRetrievalRecord,
  ensureScopedSubjectBindings,
} from "../server/services/seriesRomanceSubjectBinding.js";

const PROTECTIVE = "Beskyttende helt(e) (0-5)";
const BODYGUARD = "Bodyguard-vibe (0-5)";
const THAD = "Touch her and die-vibe (0-5)";

const ALFA = "Alfa";
const BETA = "Beta";
const GAMMA = "Gamma";
const DELTA = "Delta";
const EPSILON = "Epsilon";

const identity = {
  title: "Cycle Alpha",
  author: "Writer One",
  series: "Cycle Alpha",
  firstBook: "Alpha One",
};

function member(name, slot) {
  return { name, role: "romantic_lead", slot };
}

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
  return Object.fromEntries(
    SUBJECTIVE_KEYS.map((field) => [field, assessment()])
  );
}

function readyDiscovery(romance) {
  return stampTopologyDiscovery(romance, {
    resolved: true,
    attemptedAt: "2026-01-01T00:00:00.000Z",
  });
}

function rotatingIdentity() {
  return readyDiscovery(
    validateRomanceTopology({
      topology: "rotating_couples",
      pairings: [
        {
          members: [member(BETA, "fmc"), member(ALFA, "mmc")],
          bookScopes: [{ bookNumber: 1, title: "Alpha One" }],
          arcScopes: [{ id: "arc-a", label: "Dawn Arc" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          alternatives: [{ name: EPSILON, role: "early_love_interest" }],
        },
        {
          members: [member(DELTA, "fmc"), member(GAMMA, "mmc")],
          bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
          arcScopes: [{ id: "arc-b", label: "Dusk Arc" }],
          prominence: "primary",
          relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
        },
        {
          members: [member("Zeta", "fmc"), member("Eta", "mmc")],
          bookScopes: [{ bookNumber: 3, title: "Alpha Three" }],
          prominence: "secondary",
          relation: PAIRING_RELATIONS.SECONDARY,
        },
      ],
    })
  );
}

function scopeFor(pairingIndex = 0) {
  const pairing = rotatingIdentity().pairings[pairingIndex];
  return buildRomanceScope(pairing, "rotating_couples");
}

function scopedJob(over = {}) {
  return {
    id: "followup-protective-r1-1",
    strategy: "hero_protective_dynamic",
    fields: [PROTECTIVE, BODYGUARD, THAD],
    targetFields: [PROTECTIVE, BODYGUARD, THAD],
    batchHint: "helteprofil",
    userPrompt: "Find protective hero evidence.",
    queryHints: ['"Cycle Alpha" protective'],
    retrievalMode: "reader_direct",
    romanceScope: scopeFor(0),
    ...over,
  };
}

function prepared(over = {}) {
  return {
    title: "Review",
    url: "https://reviews.example.com/binding-one",
    type: "blog",
    batch: "helteprofil",
    summary: "Protective dynamic discussed.",
    focus: "hero_protective_dynamic",
    followUpJobId: "followup-protective-r1-1",
    retrievalAttempt: 1,
    retrievalStrategy: "primary",
    ...over,
  };
}

function makeRecord({ summary, title = "Review", url, job } = {}) {
  const j = job || scopedJob();
  return buildScopedRetrievalRecord(
    prepared({
      title,
      url: url || `https://reviews.example.com/${encodeURIComponent(summary.slice(0, 24))}`,
      summary,
    }),
    j,
    1
  );
}

describe("seriesRomanceSubjectBinding fingerprint", () => {
  it("is invariant to pairing array order", () => {
    const a = rotatingIdentity();
    const b = {
      ...a,
      pairings: [...a.pairings].reverse(),
    };
    assert.equal(buildIdentityFingerprint(a), buildIdentityFingerprint(b));
  });

  it("ignores pairing IDs and timestamps/diagnostics", () => {
    const a = rotatingIdentity();
    const b = {
      ...a,
      pairings: a.pairings.map((p, i) => ({
        ...p,
        id: `changed-${i}`,
        basis: ["noise"],
        evidenceUrls: ["https://x.example"],
      })),
      resolution: {
        ...a.resolution,
        reason: "different free text",
      },
      observability: { pairingCount: 99 },
    };
    assert.equal(buildIdentityFingerprint(a), buildIdentityFingerprint(b));
  });

  it("changes when binding-relevant identity changes", () => {
    const a = rotatingIdentity();
    const b = {
      ...a,
      pairings: a.pairings.map((p, i) =>
        i === 0
          ? {
              ...p,
              members: [member(BETA, "fmc"), member("Renamed", "mmc")],
            }
          : p
      ),
    };
    assert.notEqual(buildIdentityFingerprint(a), buildIdentityFingerprint(b));
  });
});

describe("seriesRomanceSubjectBinding detection", () => {
  const romance = rotatingIdentity();

  it("exact requested semantic match → requested_pairing", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} are a romantic pairing with protective chemistry across book 1.`,
    });
    const binding = buildSubjectBinding(record, romance);
    assert.equal(binding.status, "resolved");
    const pairing = binding.bindings.find((b) => b.subjectType === "pairing");
    assert.ok(pairing);
    assert.equal(pairing.relationshipRole, "requested_pairing");
    assert.equal(pairing.relationToRequest, "matches_request");
  });

  it("unique member-set fallback still resolves requested pairing", () => {
    const pairing = romance.pairings[0];
    const staleKeyScope = {
      ...buildRomanceScope(pairing, "rotating_couples"),
      bookScopes: [{ bookNumber: 99, title: "Ghost Book" }],
    };
    // Same members, different books → semantic key differs; member-set unique → match
    const job = scopedJob({ romanceScope: staleKeyScope });
    const record = buildScopedRetrievalRecord(
      prepared({
        summary: `${ALFA} and ${BETA} romantic pairing relationship is protective.`,
        url: "https://reviews.example.com/member-set",
      }),
      job,
      1
    );
    const binding = buildSubjectBinding(record, romance);
    const p = binding.bindings.find((b) => b.subjectType === "pairing");
    assert.ok(p);
    assert.equal(p.relationshipRole, "requested_pairing");
  });

  it("stale/unmatchable requested scope keeps other subjects with not_applicable", () => {
    const foreignScope = buildRomanceScope(
      {
        id: "ghost",
        members: [member("Nova", "fmc"), member("Orion", "mmc")],
        bookScopes: [{ bookNumber: 9, title: "Ghost" }],
        prominence: "primary",
      },
      "rotating_couples"
    );
    // Make executable scope with synthetic names not in identity
    const job = scopedJob({
      romanceScope: {
        pairingId: "ghost",
        memberNames: ["Nova", "Orion"],
        bookScopes: [{ bookNumber: 9, title: "Ghost" }],
        arcScopes: [],
        topology: "rotating_couples",
      },
    });
    const record = buildScopedRetrievalRecord(
      prepared({
        summary: `${GAMMA} and ${DELTA} are a romantic couple in later books.`,
        url: "https://reviews.example.com/stale-scope",
      }),
      job,
      1
    );
    assert.ok(record);
    const binding = buildSubjectBinding(record, romance);
    assert.notEqual(binding.status, "invalid_record");
    const pairing = binding.bindings.find((b) => b.subjectType === "pairing");
    assert.ok(pairing);
    assert.equal(pairing.relationshipRole, "another_primary_pairing");
    assert.equal(pairing.relationToRequest, "not_applicable");
  });

  it("another primary pairing classified correctly", () => {
    const record = makeRecord({
      summary: `${GAMMA} and ${DELTA} romantic pairing has strong protective energy.`,
    });
    const binding = buildSubjectBinding(record, romance);
    const pairing = binding.bindings.find((b) => b.subjectType === "pairing");
    assert.equal(pairing.relationshipRole, "another_primary_pairing");
    assert.equal(pairing.relationToRequest, "different_scope");
  });

  it("secondary pairing classified correctly", () => {
    const record = makeRecord({
      summary: `Zeta and Eta are a romantic pairing on the side.`,
      url: "https://reviews.example.com/secondary",
    });
    const binding = buildSubjectBinding(record, romance);
    const pairing = binding.bindings.find((b) => b.subjectType === "pairing");
    assert.ok(pairing);
    assert.equal(pairing.relationshipRole, "secondary_pairing");
  });

  it("alternative love interest shape", () => {
    const record = makeRecord({
      summary: `${EPSILON} appears as an early love interest before the main couple.`,
      url: "https://reviews.example.com/altli",
    });
    const binding = buildSubjectBinding(record, romance);
    const alt = binding.bindings.find(
      (b) => b.relationshipRole === "alternative_love_interest"
    );
    assert.ok(alt);
    assert.equal(alt.subjectType, "member");
    assert.equal(alt.members[0].name, EPSILON);
    assert.equal(alt.members[0].slot, null);
    assert.ok(alt.semanticPairingKey);
    assert.ok(alt.pairingId);
    assert.equal(alt.relationToRequest, "different_scope");
  });

  it("ALT LI with requested pairing context → partial_match", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing is protective. ${EPSILON} was an early love interest.`,
      url: "https://reviews.example.com/altli-partial",
    });
    const binding = buildSubjectBinding(record, romance);
    const alt = binding.bindings.find(
      (b) => b.relationshipRole === "alternative_love_interest"
    );
    assert.ok(alt);
    assert.equal(alt.relationToRequest, "partial_match");
    assert.equal(binding.status, "mixed");
  });

  it("ALT LI with unmatched requested scope → not_applicable", () => {
    const job = scopedJob({
      romanceScope: {
        pairingId: "ghost",
        memberNames: ["Nova", "Orion"],
        bookScopes: [{ bookNumber: 9, title: "Ghost" }],
        arcScopes: [],
        topology: "rotating_couples",
      },
    });
    const record = buildScopedRetrievalRecord(
      prepared({
        summary: `${EPSILON} appears as an early love interest.`,
        url: "https://reviews.example.com/altli-na",
      }),
      job,
      1
    );
    const binding = buildSubjectBinding(record, romance);
    const alt = binding.bindings.find(
      (b) => b.relationshipRole === "alternative_love_interest"
    );
    assert.ok(alt);
    assert.equal(alt.relationToRequest, "not_applicable");
  });

  it("one-name member binding", () => {
    const record = makeRecord({
      summary: `${ALFA} is fiercely protective in several scenes.`,
      url: "https://reviews.example.com/one-name",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.equal(binding.status, "resolved");
    assert.ok(binding.bindings.every((b) => b.subjectType === "member"));
    assert.equal(
      binding.bindings.some((b) => b.subjectType === "pairing"),
      false
    );
  });

  it("two names without relationship cue → member bindings not pairing", () => {
    const record = makeRecord({
      summary: `${ALFA} trains hard. ${BETA} studies magic separately.`,
      url: "https://reviews.example.com/no-rel",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.equal(
      binding.bindings.some((b) => b.subjectType === "pairing"),
      false
    );
    assert.ok(binding.bindings.some((b) => b.subjectType === "member"));
    assert.equal(binding.status, "resolved");
  });

  it("full pairing with relationship cue", () => {
    const record = makeRecord({
      summary: `Readers love the ${ALFA} and ${BETA} romantic relationship and protective scenes.`,
      url: "https://reviews.example.com/full-pair",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.ok(binding.bindings.some((b) => b.subjectType === "pairing"));
  });

  it("one-member pairing yields member binding only", () => {
    const solo = readyDiscovery(
      validateRomanceTopology({
        topology: "rotating_couples",
        pairings: [
          {
            members: [member(ALFA, "mmc")],
            bookScopes: [{ bookNumber: 1, title: "Alpha One" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
          {
            members: [member(GAMMA, "mmc"), member(DELTA, "fmc")],
            bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
        ],
      })
    );
    const job = scopedJob({
      romanceScope: buildRomanceScope(solo.pairings[0], "rotating_couples"),
    });
    const record = buildScopedRetrievalRecord(
      prepared({
        summary: `${ALFA} romantic relationship is protective.`,
        url: "https://reviews.example.com/one-member-pair",
      }),
      job,
      1
    );
    const binding = buildSubjectBinding(record, solo);
    assert.equal(binding.bindings.some((b) => b.subjectType === "pairing"), false);
    assert.ok(binding.bindings.some((b) => b.subjectType === "member"));
    assert.equal(binding.status, "resolved");
  });

  it("ambiguous requested scope keeps evidence with not_applicable", () => {
    const twin = readyDiscovery(
      validateRomanceTopology({
        topology: "rotating_couples",
        pairings: [
          {
            members: [member(ALFA, "mmc"), member(BETA, "fmc")],
            bookScopes: [{ bookNumber: 1, title: "Alpha One" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
          {
            members: [member(ALFA, "mmc"), member(BETA, "fmc")],
            bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
        ],
      })
    );
    const ambiguousScope = {
      pairingId: "ambiguous",
      memberNames: [ALFA, BETA],
      bookScopes: [],
      arcScopes: [],
      topology: "rotating_couples",
    };
    const job = scopedJob({ romanceScope: ambiguousScope });
    const record = buildScopedRetrievalRecord(
      prepared({
        summary: `${ALFA} and ${BETA} romantic pairing is protective.`,
        url: "https://reviews.example.com/ambig-scope",
      }),
      job,
      1
    );
    const binding = buildSubjectBinding(record, twin);
    assert.notEqual(binding.status, "invalid_record");
    assert.ok(binding.bindings.length >= 1);
    assert.ok(
      binding.bindings.every((b) => b.relationToRequest === "not_applicable")
    );
  });

  it("ambiguous detected identity match", () => {
    const shared = readyDiscovery(
      validateRomanceTopology({
        topology: "rotating_couples",
        pairings: [
          {
            members: [member(ALFA, "mmc"), member(BETA, "fmc")],
            bookScopes: [{ bookNumber: 1, title: "Alpha One" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
          {
            members: [member(ALFA, "mmc"), member(DELTA, "fmc")],
            bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
        ],
      })
    );
    const job = scopedJob({
      romanceScope: buildRomanceScope(shared.pairings[0], "rotating_couples"),
    });
    const record = buildScopedRetrievalRecord(
      prepared({
        summary: `${ALFA} is fiercely protective in several scenes.`,
        url: "https://reviews.example.com/ambig-detect",
      }),
      job,
      1
    );
    const binding = buildSubjectBinding(record, shared);
    assert.equal(binding.status, "ambiguous");
  });

  it("same-pair members without cue are resolved not mixed", () => {
    const record = makeRecord({
      summary: `${ALFA} trains hard. ${BETA} studies magic separately.`,
      url: "https://reviews.example.com/same-pair-not-mixed",
    });
    const binding = buildSubjectBinding(record, romance);
    const members = binding.bindings.filter((b) => b.subjectType === "member");
    assert.ok(members.length >= 2);
    assert.equal(binding.status, "resolved");
  });

  it("deterministic binding ids and ordering", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing shines in Alpha One during the Dawn Arc.`,
      url: "https://reviews.example.com/det-ids",
    });
    const a = buildSubjectBinding(record, romance);
    const b = buildSubjectBinding(record, romance);
    assert.deepEqual(
      a.bindings.map((x) => x.id),
      b.bindings.map((x) => x.id)
    );
    const ids = a.bindings.map((x) => x.id);
    const sorted = [...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    // Ordering is by subjectType/role/key/id — ids themselves remain stable hashes.
    assert.equal(ids.every((id) => /^scoped-binding-[a-f0-9]{24}$/.test(id)), true);
    assert.deepEqual(a.bindings.map((x) => x.id), b.bindings.map((x) => x.id));
    assert.ok(sorted.length >= 1);
  });

  it("explicit book and arc bindings", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing shines in Alpha One during the Dawn Arc.`,
      url: "https://reviews.example.com/book-arc",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.ok(binding.bindings.some((b) => b.subjectType === "book"));
    assert.ok(binding.bindings.some((b) => b.subjectType === "arc"));
  });

  it("explicit series-global binding", () => {
    const record = makeRecord({
      summary: `Across the series the central romantic dynamic stays consistent.`,
      url: "https://reviews.example.com/series-global",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.equal(binding.status, "resolved");
    assert.ok(binding.bindings.some((b) => b.subjectType === "series_global"));
  });

  it("negative: missing names is not book/series-global", () => {
    const record = makeRecord({
      summary: `Some review without any identifiable romance subjects.`,
      url: "https://reviews.example.com/none",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.equal(binding.status, "unresolved");
    assert.equal(binding.bindings.length, 0);
  });

  it("pairing subsumes redundant members; ALT LI not subsumed", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing is protective. ${EPSILON} was an early love interest.`,
      url: "https://reviews.example.com/subsume",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.ok(binding.bindings.some((b) => b.subjectType === "pairing"));
    assert.equal(
      binding.bindings.some(
        (b) =>
          b.subjectType === "member" &&
          b.relationshipRole === "requested_pairing"
      ),
      false
    );
    assert.ok(
      binding.bindings.some(
        (b) => b.relationshipRole === "alternative_love_interest"
      )
    );
    assert.equal(binding.status, "mixed");
  });

  it("pairing + book + arc is resolved", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic couple chemistry in Alpha One and the Dawn Arc.`,
      url: "https://reviews.example.com/ortho",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.equal(binding.status, "resolved");
    const book = binding.bindings.find((b) => b.subjectType === "book");
    const arc = binding.bindings.find((b) => b.subjectType === "arc");
    const pairing = binding.bindings.find((b) => b.subjectType === "pairing");
    assert.ok(book);
    assert.ok(arc);
    assert.ok(pairing);
    assert.equal(book.semanticPairingKey, pairing.semanticPairingKey);
    assert.equal(book.pairingId, pairing.pairingId);
    assert.equal(book.relationshipRole, pairing.relationshipRole);
    assert.equal(book.relationToRequest, pairing.relationToRequest);
    assert.equal(arc.semanticPairingKey, pairing.semanticPairingKey);
  });

  it("pairing + series_global is resolved", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing anchors the story across the series.`,
      url: "https://reviews.example.com/pair-global",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.equal(binding.status, "resolved");
    assert.ok(binding.bindings.some((b) => b.subjectType === "series_global"));
  });

  it("two different pairings → mixed", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing is sweet while ${GAMMA} and ${DELTA} romantic couple is darker.`,
      url: "https://reviews.example.com/mixed",
    });
    const binding = buildSubjectBinding(record, romance);
    assert.equal(binding.status, "mixed");
  });

  it("invalid identity", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing.`,
    });
    const binding = buildSubjectBinding(record, {
      topology: "unknown",
      pairings: [],
      resolution: { resolved: false },
    });
    assert.equal(binding.status, "invalid_identity");
  });

  it("invalid record for malformed requested scope", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing.`,
    });
    record.requestedRomanceScope = { memberNames: [] };
    const binding = buildSubjectBinding(record, romance);
    assert.equal(binding.status, "invalid_record");
  });

  it("does not mutate requested provenance", () => {
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing.`,
    });
    const before = JSON.stringify(record.requestedRomanceScope);
    const bound = bindScopedRetrievalRecord(record, romance);
    assert.equal(JSON.stringify(record.requestedRomanceScope), before);
    assert.equal(bound.scopeStatus, "requested");
    assert.ok(bound.subjectBinding);
  });

  it("relationship false positives stay member-only", () => {
    for (const summary of [
      `${ALFA} and ${BETA} fight together aboard a ship.`,
      `${ALFA} and ${BETA} are training partners.`,
      `${ALFA} trains hard. ${BETA} studies magic. ${GAMMA} and ${DELTA} are a romantic couple.`,
      `${ALFA} and ${BETA} discuss romance novels.`,
      `${ALFA} and ${BETA} recommend a romantic story.`,
      `${ALFA} and ${BETA} discuss ${GAMMA}'s romance.`,
    ]) {
      const record = makeRecord({
        summary,
        url: `https://reviews.example.com/fp-${encodeURIComponent(summary.slice(0, 20))}`,
      });
      const binding = buildSubjectBinding(record, romance);
      const alfaBetaPairing = binding.bindings.find(
        (b) =>
          b.subjectType === "pairing" &&
          (b.members || []).some((m) => m.name === ALFA) &&
          (b.members || []).some((m) => m.name === BETA)
      );
      assert.equal(alfaBetaPairing, undefined, summary);
      assert.ok(
        binding.bindings.some(
          (b) =>
            b.subjectType === "member" &&
            (b.members || []).some((m) => m.name === ALFA || m.name === BETA)
        ),
        summary
      );
    }
  });

  it("book matching requires full title or explicit book context", () => {
    const negatives = [
      "I rated this 1 out of 5.",
      "There was 1 major problem.",
      "Alpha prose was memorable",
    ];
    for (const summary of negatives) {
      const record = makeRecord({
        summary,
        url: `https://reviews.example.com/book-neg-${encodeURIComponent(summary.slice(0, 16))}`,
      });
      const binding = buildSubjectBinding(record, romance);
      assert.equal(
        binding.bindings.some((b) => b.subjectType === "book"),
        false,
        summary
      );
    }

    const titleHit = makeRecord({
      summary: `Protective scenes in Alpha One stand out.`,
      url: "https://reviews.example.com/book-title",
    });
    assert.ok(
      buildSubjectBinding(titleHit, romance).bindings.some(
        (b) => b.subjectType === "book"
      )
    );

    const numberHit = makeRecord({
      summary: `Protective scenes in book 1 stand out.`,
      url: "https://reviews.example.com/book-num",
    });
    assert.ok(
      buildSubjectBinding(numberHit, romance).bindings.some(
        (b) => b.subjectType === "book"
      )
    );
  });

  it("shared-member full pairing suppresses cross-pair spillover", () => {
    const shared = readyDiscovery(
      validateRomanceTopology({
        topology: "rotating_couples",
        pairings: [
          {
            members: [member(ALFA, "mmc"), member(BETA, "fmc")],
            bookScopes: [{ bookNumber: 1, title: "Alpha One" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
          {
            members: [member(ALFA, "mmc"), member(DELTA, "fmc")],
            bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
            prominence: "primary",
            relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
          },
        ],
      })
    );
    const job = scopedJob({
      romanceScope: buildRomanceScope(shared.pairings[0], "rotating_couples"),
    });
    const record = buildScopedRetrievalRecord(
      prepared({
        summary: `${ALFA} and ${BETA} are the central romantic pairing.`,
        url: "https://reviews.example.com/shared-disambig",
      }),
      job,
      1
    );
    const binding = buildSubjectBinding(record, shared);
    assert.equal(binding.status, "resolved");
    const pairings = binding.bindings.filter((b) => b.subjectType === "pairing");
    assert.equal(pairings.length, 1);
    assert.ok(pairings[0].members.some((m) => m.name === ALFA));
    assert.ok(pairings[0].members.some((m) => m.name === BETA));
    assert.equal(
      binding.bindings.some((b) =>
        (b.members || []).some((m) => m.name === DELTA)
      ),
      false
    );
    assert.equal(
      binding.bindings.filter((b) => b.subjectType === "member").length,
      0
    );
  });
});

describe("seriesRomanceSubjectBinding lifecycle", () => {
  it("init-binds unbound sidecar and preserves fresh bindings", () => {
    const romance = rotatingIdentity();
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing is protective.`,
      url: "https://reviews.example.com/init",
    });
    delete record.subjectBinding;
    const ensured = ensureScopedSubjectBindings({ records: [record] }, romance);
    assert.ok(ensured.records[0].subjectBinding);
    assert.equal(ensured.records[0].subjectBinding.version, SUBJECT_BINDING_VERSION);

    const again = ensureScopedSubjectBindings(ensured, romance);
    assert.deepEqual(
      again.records[0].subjectBinding,
      ensured.records[0].subjectBinding
    );

    const inputSnapshot = JSON.stringify(ensured);
    const fresh = ensureScopedSubjectBindings(ensured, romance);
    const nested = fresh.records[0].subjectBinding.bindings[0];
    if (nested.members[0]) nested.members[0].name = "MUTATED";
    if (nested.bookScopes[0]) nested.bookScopes[0].title = "MUTATED";
    if (nested.arcScopes[0]) nested.arcScopes[0].label = "MUTATED";
    nested.signals.push("mutated");
    nested.reasons.push("mutated");
    assert.equal(JSON.stringify(ensured), inputSnapshot);
  });

  it("rebinds when fingerprint changes", () => {
    const romance = rotatingIdentity();
    const record = makeRecord({
      summary: `${ALFA} and ${BETA} romantic pairing.`,
      url: "https://reviews.example.com/rebind",
    });
    const first = bindScopedRetrievalRecord(record, romance);
    const changed = {
      ...romance,
      pairings: romance.pairings.map((p, i) =>
        i === 0
          ? { ...p, members: [member(BETA, "fmc"), member("Renamed", "mmc")] }
          : p
      ),
    };
    const second = ensureScopedSubjectBindings(
      { records: [first] },
      changed
    );
    assert.notEqual(
      second.records[0].subjectBinding.identityFingerprint,
      first.subjectBinding.identityFingerprint
    );
  });

  it("rebinds when binding version is stale", () => {
    const romance = rotatingIdentity();
    const record = bindScopedRetrievalRecord(
      makeRecord({
        summary: `${ALFA} and ${BETA} romantic pairing.`,
        url: "https://reviews.example.com/stale-ver",
      }),
      romance
    );
    record.subjectBinding = {
      ...record.subjectBinding,
      version: "subject-binding-v0",
      bindings: [],
      status: "unresolved",
    };
    const ensured = ensureScopedSubjectBindings({ records: [record] }, romance);
    assert.equal(
      ensured.records[0].subjectBinding.version,
      SUBJECT_BINDING_VERSION
    );
    assert.notEqual(ensured.records[0].subjectBinding.status, "unresolved");
  });

  it("refreshes stale pairingId without changing fingerprint or binding ids", () => {
    const withIds = (pairId) =>
      readyDiscovery(
        validateRomanceTopology({
          topology: "rotating_couples",
          pairings: [
            {
              id: pairId,
              members: [member(BETA, "fmc"), member(ALFA, "mmc")],
              bookScopes: [{ bookNumber: 1, title: "Alpha One" }],
              arcScopes: [{ id: "arc-a", label: "Dawn Arc" }],
              prominence: "primary",
              relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
              alternatives: [{ name: EPSILON, role: "early_love_interest" }],
            },
            {
              id: "pair-other",
              members: [member(DELTA, "fmc"), member(GAMMA, "mmc")],
              bookScopes: [{ bookNumber: 2, title: "Alpha Two" }],
              prominence: "primary",
              relation: PAIRING_RELATIONS.ANOTHER_PRIMARY,
            },
          ],
        })
      );

    const original = withIds("pair-a");
    const renamed = withIds("renamed-a");
    assert.equal(
      buildIdentityFingerprint(original),
      buildIdentityFingerprint(renamed)
    );

    const job = scopedJob({
      romanceScope: buildRomanceScope(original.pairings[0], "rotating_couples"),
    });

    // Single romantic subject → orthogonal book/arc receive pairingId.
    const orthoRecord = bindScopedRetrievalRecord(
      buildScopedRetrievalRecord(
        prepared({
          summary: `${ALFA} and ${BETA} romantic pairing shines in Alpha One during the Dawn Arc.`,
          url: "https://reviews.example.com/pairing-id-refresh-ortho",
        }),
        job,
        1
      ),
      original
    );
    assert.ok(
      orthoRecord.subjectBinding.bindings.some(
        (b) => b.subjectType === "pairing" && b.pairingId === "pair-a"
      )
    );
    assert.ok(
      orthoRecord.subjectBinding.bindings.some(
        (b) => b.subjectType === "book" && b.pairingId === "pair-a"
      )
    );
    assert.ok(
      orthoRecord.subjectBinding.bindings.some(
        (b) => b.subjectType === "arc" && b.pairingId === "pair-a"
      )
    );

    // Mixed romantic subjects (pairing + ALT LI) still refresh parent pairingId.
    const mixedRecord = bindScopedRetrievalRecord(
      buildScopedRetrievalRecord(
        prepared({
          summary: `${ALFA} and ${BETA} romantic pairing is protective. ${EPSILON} was an early love interest.`,
          url: "https://reviews.example.com/pairing-id-refresh-altli",
        }),
        job,
        1
      ),
      original
    );
    assert.ok(
      mixedRecord.subjectBinding.bindings.some(
        (b) =>
          b.relationshipRole === "alternative_love_interest" &&
          b.pairingId === "pair-a"
      )
    );

    const inputSnapshot = JSON.stringify({
      ortho: orthoRecord,
      mixed: mixedRecord,
    });
    const ensured = ensureScopedSubjectBindings(
      { records: [orthoRecord, mixedRecord] },
      renamed
    );
    assert.equal(
      JSON.stringify({ ortho: orthoRecord, mixed: mixedRecord }),
      inputSnapshot
    );

    const [orthoOut, mixedOut] = ensured.records;
    assert.equal(
      orthoOut.subjectBinding.identityFingerprint,
      orthoRecord.subjectBinding.identityFingerprint
    );

    const assertRefreshed = (before, after) => {
      const beforeById = new Map(before.bindings.map((b) => [b.id, b]));
      assert.deepEqual(
        after.bindings.map((b) => b.id).sort(),
        before.bindings.map((b) => b.id).sort()
      );
      for (const b of after.bindings) {
        const prev = beforeById.get(b.id);
        assert.ok(prev);
        assert.equal(b.semanticPairingKey, prev.semanticPairingKey);
        if (prev.pairingId === "pair-a") {
          assert.equal(b.pairingId, "renamed-a");
        }
      }
      assert.equal(
        after.bindings.some((b) => b.pairingId === "pair-a"),
        false
      );
    };

    assertRefreshed(orthoRecord.subjectBinding, orthoOut.subjectBinding);
    assertRefreshed(mixedRecord.subjectBinding, mixedOut.subjectBinding);
    assert.ok(
      mixedOut.subjectBinding.bindings.some(
        (b) =>
          b.relationshipRole === "alternative_love_interest" &&
          b.pairingId === "renamed-a"
      )
    );
    assert.ok(
      orthoOut.subjectBinding.bindings.some(
        (b) => b.subjectType === "book" && b.pairingId === "renamed-a"
      )
    );
  });

  it("binds after merge in loop without touching research.sources", async () => {
    const romance = rotatingIdentity();
    const scopedUrl = "https://reviews.example.com/loop-bind";
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: {
        sources: [],
        seriesRomanceIdentity: romance,
        seriesIdentity: {
          mmc: ALFA,
          fmc: BETA,
          resolution: { resolved: true },
        },
        meta: {},
      },
      initialAnalysis: {
        row: { "Seriens navn": identity.series },
        meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 2,
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [
              {
                title: "Scoped",
                url: scopedUrl,
                type: "blog",
                summary: `${ALFA} and ${BETA} romantic pairing is protective and bodyguard-like.`,
              },
            ],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async () => {
          throw new Error("no synth for scoped-only");
        },
        analyze: async () => ({
          row: { "Seriens navn": identity.series },
          meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
        }),
      },
    });

    assert.ok(result.research.scopedRetrieval.records.length >= 1);
    const rec = result.research.scopedRetrieval.records.find(
      (r) => r.source.url === scopedUrl
    );
    assert.ok(rec?.subjectBinding);
    assert.equal(
      (result.research.sources || []).some((s) => s.url === scopedUrl),
      false
    );
    assert.equal(result.adaptive.additionalWebSearchCalls, 2);
  });

  it("single-couple path stays legacy and unbound by scoped pairing jobs", async () => {
    const single = readyDiscovery(
      validateRomanceTopology({
        topology: "single_couple",
        pairings: [
          {
            members: [member(ALFA, "mmc"), member(BETA, "fmc")],
            bookScopes: [
              { bookNumber: 1, title: "Alpha One" },
              { bookNumber: 2, title: "Alpha Two" },
            ],
            prominence: "primary",
          },
        ],
      })
    );
    const result = await runAdaptiveResearch({
      identity,
      initialResearch: {
        sources: [],
        seriesRomanceIdentity: single,
        seriesIdentity: {
          mmc: ALFA,
          fmc: BETA,
          resolution: { resolved: true },
        },
        meta: {},
      },
      initialAnalysis: {
        row: { "Seriens navn": identity.series },
        meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
      },
      options: {
        maxIdentitySearches: 0,
        maxFollowUpRounds: 1,
        maxAdditionalWebSearchCalls: 2,
        executeFollowUpJob: async ({ job, round }) => ({
          sources: prepareFollowUpSources(
            [
              {
                title: "Legacy",
                url: "https://reviews.example.com/single-couple-legacy",
                type: "blog",
                summary: `${ALFA} and ${BETA} romantic pairing is protective.`,
              },
            ],
            job,
            round
          ),
          webSearchCalls: 1,
          costUsd: 0.01,
        }),
        synthesize: async ({ sources }) => ({
          parsed: {
            identity,
            facts: {},
            ratings: {},
            reviewConsensus: {},
            sources,
          },
          costUsd: 0.001,
        }),
        analyze: async () => ({
          row: { "Seriens navn": identity.series },
          meta: { assessments: weakAssessments(), estimatedCostUsd: 0.02 },
        }),
      },
    });
    assert.equal(result.research.seriesRomanceIdentity.topology, "single_couple");
    assert.equal((result.research.scopedRetrieval?.records || []).length, 0);
    assert.ok(
      (result.research.sources || []).some(
        (s) => s.url === "https://reviews.example.com/single-couple-legacy"
      )
    );
  });

  it("rebuild preserves bindings", async () => {
    const romance = rotatingIdentity();
    const record = bindScopedRetrievalRecord(
      makeRecord({
        summary: `${ALFA} and ${BETA} romantic pairing.`,
        url: "https://reviews.example.com/rebuild-bind",
      }),
      romance
    );
    const rebuilt = await rebuildResearchFromSources({
      identity,
      catalog: {},
      mofibo: {},
      sources: [{ id: "source-1", url: "https://legacy.example/one", type: "blog" }],
      previousResearch: {
        sources: [],
        seriesRomanceIdentity: romance,
        scopedRetrieval: { records: [record] },
        meta: {},
      },
      searchResults: [],
      synthesize: async ({ sources }) => ({
        parsed: {
          identity,
          facts: {},
          ratings: {},
          reviewConsensus: {},
          sources,
        },
        costUsd: 0.001,
      }),
    });
    assert.equal(rebuilt.research.scopedRetrieval.records.length, 1);
    assert.ok(rebuilt.research.scopedRetrieval.records[0].subjectBinding);
    assert.equal(
      rebuilt.research.scopedRetrieval.records[0].subjectBinding.version,
      SUBJECT_BINDING_VERSION
    );
  });
});

describe("Structure 4 regression", () => {
  it("ADAPTIVE_VERSION is adaptive-v13", () => {
    assert.equal(ADAPTIVE_VERSION, "adaptive-v13");
    assert.equal(SUBJECT_BINDING_VERSION, "subject-binding-v1");
  });
});
