import { getPool, isDatabaseConfigured } from "./db.js";
import { seriesCanonicalKey } from "./seriesKeys.js";

/** @type {{
 *   skipped?: boolean,
 *   ok: boolean | null,
 *   claimCount: number | null,
 *   workCount: number | null,
 *   upserted: number | null,
 *   deleted: number | null,
 *   error: string | null,
 *   ranAt: string | null,
 * }} */
let lastSync = {
  ok: null,
  claimCount: null,
  workCount: null,
  upserted: null,
  deleted: null,
  error: null,
  ranAt: null,
};

export function getClaimsSyncStatus() {
  return { ...lastSync };
}

function confidenceToNumber(confidence) {
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    return confidence;
  }
  const label = String(confidence || "").toLowerCase();
  if (label === "high") return 0.9;
  if (label === "medium") return 0.6;
  if (label === "low") return 0.3;
  return null;
}

function extractClaimsFromSeries(row) {
  const assessments = row?._analysisMeta?.assessments;
  if (!assessments || typeof assessments !== "object") return [];

  const out = [];
  for (const [key, assessment] of Object.entries(assessments)) {
    if (!assessment || typeof assessment !== "object") continue;
    const claimKey = String(key || "").trim();
    if (!claimKey) continue;

    const evidenceCount = Array.isArray(assessment.evidenceSourceIds)
      ? assessment.evidenceSourceIds.length
      : 0;
    const conflictCount = Array.isArray(assessment.conflictingSourceIds)
      ? assessment.conflictingSourceIds.length
      : 0;

    out.push({
      claim_type: "assessment",
      claim_key: claimKey,
      value: {
        score: assessment.score ?? null,
        basis: assessment.basis ?? null,
      },
      confidence: confidenceToNumber(assessment.confidence),
      spoiler_level:
        assessment.spoilerLevel || assessment.spoiler || assessment.spoiler_level || null,
      source_summary: [
        assessment.basis || null,
        assessment.sourceBatch || null,
        assessment.sourceCount != null ? `${assessment.sourceCount} kilder` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      payload: {
        source: "series.json:_analysisMeta.assessments",
        confidenceLabel: assessment.confidence ?? null,
        sourceBatch: assessment.sourceBatch ?? null,
        sourceCount: assessment.sourceCount ?? null,
        reason: assessment.reason
          ? String(assessment.reason).slice(0, 500)
          : null,
        evidenceCount,
        conflictCount,
        syncedAt: new Date().toISOString(),
      },
    });
  }
  return out;
}

/**
 * Soft dual-write: assessments → claims (JSON forbliver sandhed).
 * Forudsætter at works allerede er synkroniseret.
 */
export async function syncAllClaimsFromSeries(list) {
  const ranAt = new Date().toISOString();

  if (!isDatabaseConfigured()) {
    lastSync = {
      skipped: true,
      ok: null,
      claimCount: null,
      workCount: null,
      upserted: null,
      deleted: null,
      error: null,
      ranAt,
    };
    return getClaimsSyncStatus();
  }

  const pool = getPool();
  if (!pool) {
    lastSync = {
      skipped: true,
      ok: false,
      claimCount: null,
      workCount: null,
      upserted: null,
      deleted: null,
      error: "Ingen pool",
      ranAt,
    };
    return getClaimsSyncStatus();
  }

  const rows = Array.isArray(list) ? list : [];
  const byCanonical = new Map();
  for (const row of rows) {
    const key = seriesCanonicalKey(row?.["Seriens navn"]);
    if (!key) continue;
    byCanonical.set(key, extractClaimsFromSeries(row));
  }

  const canonicalKeys = [...byCanonical.keys()];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: works } = await client.query(
      `SELECT id, canonical_key FROM works
       WHERE canonical_key = ANY($1::text[])`,
      [canonicalKeys],
    );
    const workIdByKey = new Map(works.map((w) => [w.canonical_key, w.id]));

    let upserted = 0;
    let deleted = 0;
    let claimCount = 0;
    let workCount = 0;

    for (const [canonicalKey, claims] of byCanonical.entries()) {
      const workId = workIdByKey.get(canonicalKey);
      if (!workId) continue;
      workCount += 1;
      claimCount += claims.length;

      for (const claim of claims) {
        await client.query(
          `INSERT INTO claims (
             work_id, claim_type, claim_key, value, confidence,
             spoiler_level, source_summary, payload, updated_at
           ) VALUES (
             $1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, NOW()
           )
           ON CONFLICT (work_id, claim_type, claim_key) DO UPDATE SET
             value = EXCLUDED.value,
             confidence = EXCLUDED.confidence,
             spoiler_level = EXCLUDED.spoiler_level,
             source_summary = EXCLUDED.source_summary,
             payload = EXCLUDED.payload,
             updated_at = NOW()`,
          [
            workId,
            claim.claim_type,
            claim.claim_key,
            JSON.stringify(claim.value),
            claim.confidence,
            claim.spoiler_level,
            claim.source_summary || null,
            JSON.stringify(claim.payload),
          ],
        );
        upserted += 1;
      }

      const keepKeys = claims.map((c) => c.claim_key);
      const del = await client.query(
        `DELETE FROM claims
         WHERE work_id = $1
           AND claim_type = 'assessment'
           AND NOT (claim_key = ANY($2::text[]))`,
        [workId, keepKeys],
      );
      deleted += del.rowCount ?? 0;
    }

    // Fjern assessment-claims for series-works der ikke længere findes i listen
    const orphanDel = await client.query(
      `DELETE FROM claims c
       USING works w
       WHERE c.work_id = w.id
         AND w.canonical_key LIKE 'series:%'
         AND c.claim_type = 'assessment'
         AND NOT (w.canonical_key = ANY($1::text[]))`,
      [canonicalKeys],
    );
    deleted += orphanDel.rowCount ?? 0;

    await client.query(
      `INSERT INTO app_meta (key, value)
       VALUES (
         'fase7',
         jsonb_build_object(
           'bid', 4,
           'note', 'Dual-write assessments -> claims; JSON remains source of truth',
           'claimCount', $1::int,
           'workCount', $2::int,
           'syncedAt', $3::text
         )
       )
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [claimCount, workCount, ranAt],
    );

    await client.query("COMMIT");

    lastSync = {
      skipped: false,
      ok: true,
      claimCount,
      workCount,
      upserted,
      deleted,
      error: null,
      ranAt,
    };
    console.log(
      `[claims] Synced ${upserted} claim(s) across ${workCount} work(s)` +
        (deleted ? ` (slettet ${deleted})` : ""),
    );
    return getClaimsSyncStatus();
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    lastSync = {
      skipped: false,
      ok: false,
      claimCount: null,
      workCount: null,
      upserted: null,
      deleted: null,
      error: err?.message || String(err),
      ranAt,
    };
    console.warn(`[claims] Sync fejlede: ${lastSync.error}`);
    return getClaimsSyncStatus();
  } finally {
    client.release();
  }
}
