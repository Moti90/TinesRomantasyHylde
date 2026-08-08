/** Fastlåste versioner til cache/stabilitet — bump kun ved bevidste promptændringer. */
export const HANDBOOK_VERSION = "handbook-v3";
export const RESEARCH_PROMPT_VERSION = "research-v14";
export const ANALYSIS_PROMPT_VERSION = "analysis-v13";
export const SEARCH_PLAN_VERSION = "batch-v5";
export const DISCOVERY_PROMPT_VERSION = "discovery-v2";

export const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-4o";
export const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-4o-mini";
export const DISCOVERY_MODEL =
  process.env.OPENAI_DISCOVERY_MODEL || "gpt-4o-mini";

/** Midlertidigt 7 dage under batch-v1-validering (før 60). */
export const RESEARCH_CACHE_DAYS = Number(process.env.RESEARCH_CACHE_DAYS || 7);
export const GOODREADS_CACHE_DAYS = Number(process.env.GOODREADS_CACHE_DAYS || 30);
export const DISCOVERY_CACHE_DAYS = Number(process.env.DISCOVERY_CACHE_DAYS || 7);

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
