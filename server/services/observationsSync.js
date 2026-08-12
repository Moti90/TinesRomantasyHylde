import { getPool, isDatabaseConfigured } from "./db.js";
import { seriesCanonicalKey } from "./seriesKeys.js";

/** @type {{
 *   skipped?: boolean,
 *   ok: boolean | null,
 *   observationCount: number | null,
 *   workCount: number | null,
 *   upserted: number | null,
 *   deleted: number | null,
 *   error: string | null,
 *   ranAt: string | null,
 * }} */
let lastSync = {
  ok: null,
  observationCount: null,
  workCount: null,
  upserted: null,
  deleted: null,
  error: null,
  ranAt: null,
};

export function getObservationsSyncStatus() {
  return { ...lastSync };
}

function mapSourceObservation(source) {
  const sourceId = String(source?.id || "").trim();
  if (!sourceId) return null;
  const summary = String(source.summary || "").trim();
  return {
    observation_type: "research_source",
    external_key: sourceId,
    claim_key: null,
    content: summary ? summary.slice(0, 1000) : source.title || null,
    source_url: source.url || null,
    source_kind: source.type || null,
    payload: {
      source: "series.json:_research.sources",
      sourceId,
      title: source.title || null,
      batch: source.batch || null,
      focus: source.focus || null,
      syncedAt: new Date().toISOString(),
    },
  };
}

function mapEvidenceObservations(row) {
  const assessments = row?._analysisMeta?.assessments;
  if (!assessments || typeof assessments !== "object") return [];

  const out = [];
  for (const [claimKey, assessment] of Object.entries(assessments)) {
    const ids = assessment?.evidenceSourceIds;
    if (!Array.isArray(ids) || ids.length === 0) continue;
    const key = String(claimKey || "").trim();
    if (!key) continue;
    for (const sourceIdRaw of ids) {
      const sourceId = String(sourceIdRaw || "").trim();
      if (!sourceId) continue;
      out.push({
        observation_type: "claim_evidence",
        external_key: `${key}::${sourceId}`,
        claim_key: key,
        content: `Evidens for ${key} via ${sourceId}`,
        source_url: null,
        source_kind: "evidence_ref",
        payload: {
          source: "series.json:_analysisMeta.assessments.evidenceSourceIds",
          claimKey: key,
          sourceId,
          syncedAt: new Date().toISOString(),
        },
      });
    }
  }
  return out;
}

function extractObservations(row) {
  const sources = Array.isArray(row?._research?.sources)
    ? row._research.sources
    : [];
  const fromSources = sources.map(mapSourceObservation).filter(Boolean);
  const fromEvidence = mapEvidenceObservations(row);
  return [...fromSources, ...fromEvidence];
}

/**
 * Soft dual-write: research sources + evidence refs → observations.
 * Forudsætter works (+ claims for evidence-link).
 */
export async function syncAllObservationsFromSeries(list) {
  const ranAt = new Date().toISOString();

  if (!isDatabaseConfigured()) {
    lastSync = {
      skipped: true,
      ok: null,
      observationCount: null,
      workCount: null,
      upserted: null,
      deleted: null,
      error: null,
      ranAt,
    };
    return getObservationsSyncStatus();
  }

  const pool = getPool();
  if (!pool) {
    lastSync = {
      skipped: true,
      ok: false,
      observationCount: null,
      workCount: null,
      upserted: null,
      deleted: null,
      error: "Ingen pool",
      ranAt,
    };
    return getObservationsSyncStatus();
  }

  const rows = Array.isArray(list) ? list : [];
  const byCanonical = new Map();
  for (const row of rows) {
    const key = seriesCanonicalKey(row?.["Seriens navn"]);
    if (!key) continue;
    byCanonical.set(key, extractObservations(row));
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

    const { rows: claimRows } = await client.query(
      `SELECT c.id, c.work_id, c.claim_key
       FROM claims c
       JOIN works w ON w.id = c.work_id
       WHERE w.canonical_key = ANY($1::text[])
         AND c.claim_type = 'assessment'`,
      [canonicalKeys],
    );
    const claimIdByWorkKey = new Map();
    for (const c of claimRows) {
      claimIdByWorkKey.set(`${c.work_id}::${c.claim_key}`, c.id);
    }

    let upserted = 0;
    let deleted = 0;
    let observationCount = 0;
    let workCount = 0;

    for (const [canonicalKey, observations] of byCanonical.entries()) {
      const workId = workIdByKey.get(canonicalKey);
      if (!workId) continue;
      workCount += 1;
      observationCount += observations.length;

      for (const obs of observations) {
        const claimId = obs.claim_key
          ? claimIdByWorkKey.get(`${workId}::${obs.claim_key}`) || null
          : null;

        await client.query(
          `INSERT INTO observations (
             work_id, claim_id, observation_type, external_key,
             content, source_url, source_kind, payload
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8::jsonb
           )
           ON CONFLICT (work_id, observation_type, external_key) DO UPDATE SET
             claim_id = EXCLUDED.claim_id,
             content = EXCLUDED.content,
             source_url = EXCLUDED.source_url,
             source_kind = EXCLUDED.source_kind,
             payload = EXCLUDED.payload`,
          [
            workId,
            claimId,
            obs.observation_type,
            obs.external_key,
            obs.content,
            obs.source_url,
            obs.source_kind,
            JSON.stringify(obs.payload),
          ],
        );
        upserted += 1;
      }

      const keepKeys = observations.map((o) => o.external_key);
      const del = await client.query(
        `DELETE FROM observations
         WHERE work_id = $1
           AND observation_type IN ('research_source', 'claim_evidence')
           AND NOT (external_key = ANY($2::text[]))`,
        [workId, keepKeys],
      );
      deleted += del.rowCount ?? 0;
    }

    const orphanDel = await client.query(
      `DELETE FROM observations o
       USING works w
       WHERE o.work_id = w.id
         AND w.canonical_key LIKE 'series:%'
         AND o.observation_type IN ('research_source', 'claim_evidence')
         AND NOT (w.canonical_key = ANY($1::text[]))`,
      [canonicalKeys],
    );
    deleted += orphanDel.rowCount ?? 0;

    await client.query(
      `INSERT INTO app_meta (key, value)
       VALUES (
         'fase7',
         jsonb_build_object(
           'bid', 5,
           'note', 'Dual-write research sources/evidence -> observations; JSON remains source of truth',
           'observationCount', $1::int,
           'workCount', $2::int,
           'syncedAt', $3::text
         )
       )
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [observationCount, workCount, ranAt],
    );

    await client.query("COMMIT");

    lastSync = {
      skipped: false,
      ok: true,
      observationCount,
      workCount,
      upserted,
      deleted,
      error: null,
      ranAt,
    };
    console.log(
      `[observations] Synced ${upserted} observation(s) across ${workCount} work(s)` +
        (deleted ? ` (slettet ${deleted})` : ""),
    );
    return getObservationsSyncStatus();
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    lastSync = {
      skipped: false,
      ok: false,
      observationCount: null,
      workCount: null,
      upserted: null,
      deleted: null,
      error: err?.message || String(err),
      ranAt,
    };
    console.warn(`[observations] Sync fejlede: ${lastSync.error}`);
    return getObservationsSyncStatus();
  } finally {
    client.release();
  }
}
