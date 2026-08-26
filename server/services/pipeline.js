import { identifyBook } from "./identify.js";
import { researchSeries } from "./research.js";
import { checkMofibo } from "./mofibo.js";
import { runWebResearch, inferLeadCharactersFromResearch } from "./webResearch.js";
import { runHandbookAnalysis } from "./handbookAnalysis.js";
import { applyDecisionScoresToRow } from "./decisionScoreSync.js";
import {
  getCachedResearch,
  saveResearchCache,
} from "./researchCache.js";
import { runAdaptiveResearch, shouldRunAdaptiveResearch } from "./adaptiveResearchLoop.js";
import { loadSeries, upsertSeries } from "./store.js";
import { sanitizeGoodreadsScore } from "./goodreads.js";
import {
  applyReferenceScores,
  getReferenceForSeries,
  isReferenceUnlocked,
} from "./scoreReference.js";

const PRESERVE_KEYS = ["Tines score", "Tines egen vurdering", "Status"];

function mergePreserve(existing, row, { preserveGoodreads = true } = {}) {
  if (!existing) {
    row["Goodreads-score"] = sanitizeGoodreadsScore(row["Goodreads-score"]);
    return applyReferenceScores(row);
  }
  const next = { ...row };
  for (const key of PRESERVE_KEYS) {
    if (existing[key] !== undefined && existing[key] !== null && existing[key] !== "") {
      next[key] = existing[key];
    }
  }
  next["Tines score"] = existing["Tines score"] ?? null;
  next["Tines egen vurdering"] = existing["Tines egen vurdering"] ?? null;
  if (existing.Status) next.Status = existing.Status;

  if (preserveGoodreads) {
    // Genanalyse: behold eksisterende (renset) — overskriv aldrig med OL/GB
    next["Goodreads-score"] = sanitizeGoodreadsScore(
      existing["Goodreads-score"]
    );
    if (existing._ratingMeta) next._ratingMeta = existing._ratingMeta;
  } else {
    // Ny research: brug ny verificeret værdi, ellers behold gammel renset
    const incoming = sanitizeGoodreadsScore(row["Goodreads-score"]);
    next["Goodreads-score"] =
      incoming ?? sanitizeGoodreadsScore(existing["Goodreads-score"]);
  }

  const seriesName = next["Seriens navn"] || existing["Seriens navn"];
  // Bevidst ulåste serier (fx Redemption-test) må AI overskrive
  if (isReferenceUnlocked(seriesName)) {
    next._scoreReference = {
      locked: false,
      source: "unlocked",
      reason: "explicit_test_unlock",
    };
    return next;
  }
  // Excel-reference: scoringsfelter låses (Mages 99 må ikke blive 79 igen)
  if (getReferenceForSeries(seriesName)) {
    return applyReferenceScores(next);
  }
  if (existing._scoreReference?.locked) {
    next._scoreReference = existing._scoreReference;
  }
  return next;
}

function attachMeta(row, { research, analysisMeta, identity, usage }) {
  return {
    ...row,
    _identity: identity || research?.identity || null,
    _research: research || null,
    _analysisMeta: analysisMeta || null,
    _usage: usage || null,
  };
}

function findExisting(name) {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return (
    loadSeries().find(
      (r) => (r["Seriens navn"] || "").trim().toLowerCase() === key
    ) || null
  );
}

/**
 * Fuldt analyseflow for ny titel.
 * @param {{ query: string, author?: string, link?: string, status?: string, selectedIdentity?: object, onProgress?: fn }} opts
 */
export async function analyzeNewSeries(opts) {
  const {
    query,
    author = "",
    link = "",
    status = "Ikke læst",
    selectedIdentity = null,
    onProgress = () => {},
  } = opts;

  const progress = (step, label) => {
    try {
      onProgress({ step, label });
    } catch {
      /* ignore */
    }
  };

  progress("identify", "Identificerer bog eller serie");

  let identityResult;
  if (selectedIdentity?.title) {
    identityResult = {
      status: "identified",
      identity: {
        ...selectedIdentity,
        identityConfidence:
          selectedIdentity.identityConfidence ||
          selectedIdentity.confidence ||
          "high",
      },
    };
  } else {
    identityResult = await identifyBook({ query, author });
  }

  if (identityResult.status === "ambiguous") {
    return {
      needsChoice: true,
      candidates: identityResult.candidates,
      userMessage: "Flere bøger matcher. Vælg den rigtige.",
    };
  }

  const identity = identityResult.identity;
  const searchQuery =
    [identity.title, identity.author].filter(Boolean).join(" ") || query;

  progress("catalog", "Søger efter oplysninger og anmeldelser");
  const catalog = await researchSeries(searchQuery);
  let mofibo;
  if (link.toLowerCase().includes("mofibo.com")) {
    mofibo = { status: "Ja", link, source: "user-link" };
  } else {
    mofibo = await checkMofibo(identity.title || query);
  }

  progress("research", "Sammenholder kilder");
  let research;
  let researchCacheHit = false;
  const cached = getCachedResearch(identity);
  if (cached.hit && cached.research) {
    research = cached.research;
    researchCacheHit = true;
    console.log(`Research-cache HIT (${cached.hash})`);
  } else {
    const { research: fresh } = await runWebResearch({
      identity,
      catalog,
      mofibo,
    });
    research = fresh;
    saveResearchCache(identity, research);
  }

  progress("analyze", "Vurderer efter Tines håndbog");
  let analysis = await runHandbookAnalysis({
    research,
    catalog,
    mofibo,
    query: searchQuery,
    updateGoodreads: true,
  });

  if (shouldRunAdaptiveResearch({ researchCacheHit, mode: "analyze" })) {
    progress("research", "Søger efter manglende evidens");
    try {
      const adapted = await runAdaptiveResearch({
        identity,
        initialResearch: research,
        initialAnalysis: analysis,
        catalog,
        mofibo,
        options: { mode: "analyze" },
      });
      research = adapted.research;
      analysis = adapted.analysis;
      saveResearchCache(identity, research);
    } catch (err) {
      console.warn("Adaptive research skipped:", err.message);
    }
  }

  progress("save", "Gemmer analysen");
  let row = analysis.row;
  row.Status = status;
  if (link.toLowerCase().includes("mofibo.com")) {
    row["Er serien på Mofibo? (ja, nej, ikke hele serien)"] = "Ja";
  }

  const existing = findExisting(row["Seriens navn"]);
  row = mergePreserve(existing, row, { preserveGoodreads: false });
  row = applyDecisionScoresToRow(row, analysis.meta).row;

  const usage = {
    researchCacheHit,
    webSearchCalls: researchCacheHit ? 0 : research?.meta?.webSearchCalls || 0,
    researchTokens: {
      in: research?.meta?.inputTokens || 0,
      out: research?.meta?.outputTokens || 0,
    },
    analysisTokens: {
      in: analysis.meta?.inputTokens || 0,
      out: analysis.meta?.outputTokens || 0,
    },
    estimatedCostUsd:
      (researchCacheHit ? 0 : research?.meta?.estimatedCostUsd || 0) +
      (analysis.meta?.estimatedCostUsd || 0),
  };

  if (analysis.meta) {
    analysis.meta.researchCacheHit = researchCacheHit;
  }

  const full = attachMeta(row, {
    research,
    analysisMeta: analysis.meta,
    identity,
    usage,
  });

  const series = upsertSeries(full);
  const userMessage =
    analysis.meta?.userMessage ||
    research?.meta?.warnings?.find((w) => String(w).includes("tyndere")) ||
    (research?.meta?.partial
      ? "Analysen blev gennemført, men nogle oplysninger kunne ikke verificeres."
      : null);

  return {
    needsChoice: false,
    row: full,
    series,
    meta: {
      fallback: Boolean(analysis.fallback),
      userMessage,
      researchCacheHit,
      usage,
      foundation: analysis.meta?.foundation || null,
    },
  };
}

/**
 * Genanalysér: genbrug research, kun håndbogsanalyse.
 */
export async function reanalyzeSeries(name, { forceAnalysis = false } = {}) {
  const existing = findExisting(name);
  if (!existing) throw new Error("Serie ikke fundet");

  const identity =
    existing._identity ||
    existing._research?.identity || {
      title: existing["Første bog/titel"] || existing["Seriens navn"],
      author: existing.Forfatter || null,
      series: existing["Seriens navn"] || null,
      bookNumber: null,
      identityConfidence: "medium",
    };

  let research = existing._research || null;
  let researchCacheHit = true;

  if (!research) {
    const cached = getCachedResearch(identity);
    if (cached.hit) {
      research = cached.research;
    } else {
      // Ingen gemt research → hent katalog + web (engang)
      researchCacheHit = false;
      const catalog = await researchSeries(
        [identity.title, identity.author].filter(Boolean).join(" ")
      );
      const mofibo = await checkMofibo(identity.title || name);
      const { research: fresh } = await runWebResearch({
        identity,
        catalog,
        mofibo,
      });
      research = fresh;
      saveResearchCache(identity, research);
    }
  }

  const catalog = await researchSeries(
    [identity.title, identity.author].filter(Boolean).join(" ")
  );
  const mofibo = await checkMofibo(identity.title || name);

  const analysis = await runHandbookAnalysis({
    research,
    catalog,
    mofibo,
    query: name,
    existingAnalysisHash: existing._analysisMeta?.analysisHash,
    force: forceAnalysis,
    existingRow: existing,
    updateGoodreads: false,
  });

  if (analysis.reused && existing) {
    return {
      row: existing,
      series: loadSeries(),
      meta: {
        reused: true,
        userMessage: "Ingen ændringer i grundlaget — eksisterende analyse genbrugt.",
        researchCacheHit: true,
        webSearchUsed: false,
      },
    };
  }

  let row = mergePreserve(existing, analysis.row, { preserveGoodreads: true });
  row["Seriens navn"] = existing["Seriens navn"] || row["Seriens navn"];
  row["Goodreads-score"] = sanitizeGoodreadsScore(existing["Goodreads-score"]);
  row = applyDecisionScoresToRow(row, analysis.meta).row;

  const full = attachMeta(row, {
    research,
    analysisMeta: {
      ...analysis.meta,
      researchCacheHit,
      webSearchUsed: false,
    },
    identity,
    usage: {
      researchCacheHit,
      webSearchCalls: 0,
      webSearchUsed: false,
    },
  });

  const series = upsertSeries(full);
  return {
    row: full,
    series,
    meta: {
      fallback: Boolean(analysis.fallback),
      userMessage: analysis.meta?.userMessage || null,
      researchCacheHit,
      webSearchUsed: false,
      foundation: analysis.meta?.foundation || null,
    },
  };
}

/**
 * Opdatér oplysninger: ny webresearch + analyse.
 */
export async function refreshSeriesResearch(name) {
  const existing = findExisting(name);
  if (!existing) throw new Error("Serie ikke fundet");

  const identity = {
    ...(existing._identity ||
      existing._research?.identity || {
        title: existing["Første bog/titel"] || existing["Seriens navn"],
        author: existing.Forfatter || null,
        series: existing["Seriens navn"] || null,
        bookNumber: null,
        identityConfidence: "medium",
      }),
  };

  const inferred = inferLeadCharactersFromResearch(existing._research);
  if (inferred.mmc && !identity.mmc) identity.mmc = inferred.mmc;
  if (inferred.fmc && !identity.fmc) identity.fmc = inferred.fmc;

  const searchQuery = [identity.title, identity.author]
    .filter(Boolean)
    .join(" ");
  const catalog = await researchSeries(searchQuery);
  const mofibo = await checkMofibo(identity.title || name);

  const { research: fresh } = await runWebResearch({ identity, catalog, mofibo });
  let research = fresh;
  saveResearchCache(identity, research);

  let analysis = await runHandbookAnalysis({
    research,
    catalog,
    mofibo,
    query: searchQuery,
    force: true,
    existingRow: existing,
    updateGoodreads: true,
  });

  if (shouldRunAdaptiveResearch({ researchCacheHit: false, mode: "refresh" })) {
    try {
      const adapted = await runAdaptiveResearch({
        identity,
        initialResearch: research,
        initialAnalysis: analysis,
        catalog,
        mofibo,
        options: { mode: "refresh" },
      });
      research = adapted.research;
      analysis = adapted.analysis;
      saveResearchCache(identity, research);
    } catch (err) {
      console.warn("Adaptive research skipped:", err.message);
    }
  }

  let row = mergePreserve(existing, analysis.row, { preserveGoodreads: false });
  row["Seriens navn"] = existing["Seriens navn"] || row["Seriens navn"];
  row = applyDecisionScoresToRow(row, analysis.meta).row;

  const full = attachMeta(row, {
    research,
    analysisMeta: {
      ...analysis.meta,
      researchCacheHit: false,
      webSearchUsed: true,
    },
    identity,
    usage: {
      researchCacheHit: false,
      webSearchCalls: research?.meta?.webSearchCalls || 0,
      webSearchUsed: true,
    },
  });

  const series = upsertSeries(full);
  return {
    row: full,
    series,
    meta: {
      fallback: Boolean(analysis.fallback),
      userMessage:
        analysis.meta?.userMessage ||
        research?.meta?.warnings?.find((w) => String(w).includes("tyndere")) ||
        (research?.meta?.partial
          ? "Analysen blev gennemført, men nogle oplysninger kunne ikke verificeres."
          : "Oplysninger opdateret."),
      researchCacheHit: false,
      webSearchUsed: true,
      foundation: analysis.meta?.foundation || null,
    },
  };
}
