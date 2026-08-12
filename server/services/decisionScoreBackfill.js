import { buildUncertaintyProfile } from "./decisionScores.js";
import { applyDecisionScoresToRow } from "./decisionScoreSync.js";
import { loadSeries, saveSeries } from "./store.js";

const DECISION_SCORES_VERSION = 2;

export function backfillDecisionScores({ force = false } = {}) {
  const series = loadSeries();
  let changed = false;
  const next = series.map((row) => {
    if (row["Tine-score"] == null) return row;
    const currentVersion = row._analysisMeta?.decisionScoresVersion || 0;
    if (!force && currentVersion === DECISION_SCORES_VERSION) {
      return row;
    }

    const updated = { ...row };
    const meta = {
      ...(row._analysisMeta || {}),
      assessments: { ...(row._analysisMeta?.assessments || {}) },
    };
    meta.uncertainty = buildUncertaintyProfile(
      row._research || {},
      meta.assessments
    );
    meta.decisionScoresVersion = DECISION_SCORES_VERSION;
    applyDecisionScoresToRow(updated, meta);
    updated._analysisMeta = meta;
    changed = true;
    return updated;
  });

  if (changed) saveSeries(next);
  return { changed, count: next.length };
}

export { DECISION_SCORES_VERSION };
