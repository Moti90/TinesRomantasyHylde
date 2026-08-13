import { createHash } from "crypto";
import {
  ADAPTIVE_VERSION,
  RESEARCH_PROMPT_VERSION,
  isAdaptiveResearchEnabled,
} from "./versions.js";

export function stableHash(value) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(json).digest("hex").slice(0, 24);
}

export function researchInputHash(identity) {
  return stableHash({
    title: (identity?.title || "").trim().toLowerCase(),
    author: (identity?.author || "").trim().toLowerCase(),
    series: (identity?.series || "").trim().toLowerCase(),
    bookNumber: identity?.bookNumber ?? null,
    promptVersion: RESEARCH_PROMPT_VERSION,
    adaptiveVersion: isAdaptiveResearchEnabled() ? ADAPTIVE_VERSION : null,
  });
}

export function analysisInputHash({
  researchHash,
  handbookVersion,
  promptVersion,
  model,
  anchors,
}) {
  return stableHash({
    researchHash,
    handbookVersion,
    promptVersion,
    model,
    anchors,
  });
}
