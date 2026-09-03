/** Fastlåste versioner til cache/stabilitet — bump kun ved bevidste promptændringer. */
export const HANDBOOK_VERSION = "handbook-v3";
export const RESEARCH_PROMPT_VERSION = "research-v15";
export const ANALYSIS_PROMPT_VERSION = "analysis-v16";
export const SEARCH_PLAN_VERSION = "batch-v5";
export const DISCOVERY_PROMPT_VERSION = "discovery-v2";

/** Adaptive research intelligence (Bid 1+). Bump when coverage/planner semantics change.
 * Bid 2 should include this in research/cache invalidation when the loop goes live.
 * adaptive-v7: subject-aware field evidence + normalized identity confirmation.
 * adaptive-v8: diversified retrieval approaches + one low-yield web_search fallback per focused job.
 * adaptive-v9: field-aware source quality (role × field class) for coverage eligibility.
 * adaptive-v10: source-mix-aware planner/retrieval (reader/scene/diversity modes).
 * adaptive-v11: series romance scope scheduling metadata (Structure 3.1).
 * adaptive-v12: scoped retrieval execution, sidecar storage (Structure 3.2).
 * adaptive-v13: pairing-aware subject binding on scoped retrieval (Structure 4).
 */
export const ADAPTIVE_VERSION = "adaptive-v13";

/** Structure 4 subject binding semantics for scopedRetrieval.records. */
export const SUBJECT_BINDING_VERSION = "subject-binding-v1";

/** Identity-search schema/prompt (Series Romance Structure 2). Not in research cache hash. */
export const IDENTITY_RESOLUTION_VERSION = "identity-v2";

/** One targeted series-identity search before field follow-ups. */
export const ADAPTIVE_MAX_IDENTITY_SEARCHES = Number(
  process.env.ADAPTIVE_MAX_IDENTITY_SEARCHES || 1
);

export const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-4o";
export const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-4o-mini";
export const DISCOVERY_MODEL =
  process.env.OPENAI_DISCOVERY_MODEL || "gpt-4o-mini";

/** Midlertidigt 7 dage under batch-v1-validering (før 60). */
export const RESEARCH_CACHE_DAYS = Number(process.env.RESEARCH_CACHE_DAYS || 7);
export const GOODREADS_CACHE_DAYS = Number(process.env.GOODREADS_CACHE_DAYS || 30);
export const DISCOVERY_CACHE_DAYS = Number(process.env.DISCOVERY_CACHE_DAYS || 7);

export const ADAPTIVE_TARGET_COVERAGE = Number(
  process.env.ADAPTIVE_TARGET_COVERAGE || 80,
);
export const ADAPTIVE_FIELD_MIN_COVERAGE = Number(
  process.env.ADAPTIVE_FIELD_MIN_COVERAGE || 55,
);
export const ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE = Number(
  process.env.ADAPTIVE_CRITICAL_FIELD_MIN_COVERAGE || 60,
);
export const ADAPTIVE_MAX_JOBS_PER_ROUND = Number(
  process.env.ADAPTIVE_MAX_JOBS_PER_ROUND || 3,
);
export const ADAPTIVE_MAX_FOLLOWUP_ROUNDS = Number(
  process.env.ADAPTIVE_MAX_FOLLOWUP_ROUNDS || 2,
);
export const ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS = Number(
  process.env.ADAPTIVE_MAX_ADDITIONAL_WEB_SEARCH_CALLS || 6,
);
export const ADAPTIVE_MAX_ADDITIONAL_COST_USD = Number(
  process.env.ADAPTIVE_MAX_ADDITIONAL_COST_USD || 0.25,
);
export const ADAPTIVE_MIN_COVERAGE_GAIN = Number(
  process.env.ADAPTIVE_MIN_COVERAGE_GAIN || 3,
);
export const ADAPTIVE_MAX_SOURCES_PER_JOB = Number(
  process.env.ADAPTIVE_MAX_SOURCES_PER_JOB || 8,
);

export function isAdaptiveResearchEnabled() {
  const v = process.env.ADAPTIVE_RESEARCH_ENABLED;
  if (v == null || String(v).trim() === "") return true;
  return !["0", "false", "no", "off"].includes(String(v).trim().toLowerCase());
}

export function isAdaptiveDebugEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  const v = process.env.ADAPTIVE_DEBUG;
  if (v == null || String(v).trim() === "") return false;
  return !["0", "false", "no", "off"].includes(String(v).trim().toLowerCase());
}

/** Grove prisestimater (USD) til udviklingslog — ikke faktura. */
export const PRICE_PER_1M = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

export function estimateCostUsd(model, inputTokens = 0, outputTokens = 0) {
  const rates = PRICE_PER_1M[model] || PRICE_PER_1M["gpt-4o-mini"];
  return (
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output
  );
}
