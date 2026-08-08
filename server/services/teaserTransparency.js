/**
 * Fase 6 — teaser-transparens (danske labels, evidensniveau, "Fundet her").
 * Ren logik uden OpenAI, så den kan testes isoleret.
 */

export const TEASER_SCHEMA_VERSION = 3;

export function cleanOptionalText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^(null|undefined|none|n\/a|na|ingen|intet)$/i.test(s)) return null;
  return s;
}

export function normalizeMatchRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (typeof row === "string") {
        const param = cleanOptionalText(row);
        return param ? { param, evidence: null } : null;
      }
      if (!row || typeof row !== "object") return null;
      const param = cleanOptionalText(row.param || row.label || row.name);
      if (!param) return null;
      return {
        param,
        evidence: cleanOptionalText(row.evidence || row.why || row.note),
      };
    })
    .filter(Boolean);
}

export function normalizeStringList(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(cleanOptionalText).filter(Boolean);
}

/** Korte linjer om hvor signalet blev fundet (discovery-kilder). */
export function buildFoundIn(sources = []) {
  const out = [];
  const seen = new Set();
  for (const s of sources || []) {
    const signal = cleanOptionalText(s?.signal);
    const context = cleanOptionalText(s?.context);
    const line = [signal, context].filter(Boolean).join(" · ");
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Evidensniveau ud fra kilder + bekræftede matches.
 * Alignerer sprogligt med analyseflowets kildegrundlag.
 */
export function deriveEvidenceBasis(sources = [], matchedParams = []) {
  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  const matchCount = Array.isArray(matchedParams) ? matchedParams.length : 0;
  if (sourceCount >= 3 && matchCount >= 2) return "kildebaseret";
  if (sourceCount >= 1 && matchCount >= 1) return "delvist";
  return "tyndt";
}

export function evidenceBasisLabel(basis) {
  if (basis === "kildebaseret") return "Kildebaseret";
  if (basis === "delvist") return "Delvist bekræftet";
  if (basis === "tyndt") return "Tyndt kildegrundlag";
  return null;
}

export function isTeaserCacheFresh(teaser, minSchema = TEASER_SCHEMA_VERSION) {
  if (!teaser?.blurb) return false;
  if (Number(teaser.schemaVersion) < minSchema) return false;
  for (const key of ["vibe", "whyMatch", "caution"]) {
    const v = teaser[key];
    if (typeof v === "string" && /^(null|undefined)$/i.test(v.trim())) {
      return false;
    }
  }
  return true;
}

/**
 * Byg endelig teaser med Fase 6-transparensfelter.
 */
export function finalizeTeaser(parsed, sources = [], refs = []) {
  const matchedParams = normalizeMatchRows(parsed?.matchedParams);
  const uncertainParams = normalizeStringList(parsed?.uncertainParams);
  const penaltyHits = normalizeStringList(
    parsed?.penaltyHits || parsed?.riskFlags
  );
  const aiFoundIn = normalizeStringList(parsed?.foundIn);
  const foundIn = aiFoundIn.length ? aiFoundIn : buildFoundIn(sources);
  const evidenceBasis =
    ["kildebaseret", "delvist", "tyndt"].includes(parsed?.evidenceBasis)
      ? parsed.evidenceBasis
      : deriveEvidenceBasis(sources, matchedParams);

  return {
    schemaVersion: TEASER_SCHEMA_VERSION,
    blurb: String(parsed?.blurb || "").trim(),
    vibe: cleanOptionalText(parsed?.vibe),
    whyMatch: cleanOptionalText(parsed?.whyMatch),
    matchedParams,
    uncertainParams,
    penaltyHits,
    caution: cleanOptionalText(parsed?.caution),
    foundIn,
    evidenceBasis,
    evidenceLabel: evidenceBasisLabel(evidenceBasis),
    generatedAt: new Date().toISOString(),
    references: (refs || []).map((r) => ({
      name: r.name,
      tineScore: r.tineScore,
    })),
  };
}
