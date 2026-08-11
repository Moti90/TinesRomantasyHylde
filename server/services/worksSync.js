import { getPool, isDatabaseConfigured } from "./db.js";

/** @type {{
 *   skipped?: boolean,
 *   ok: boolean | null,
 *   count: number | null,
 *   upserted: number | null,
 *   deleted: number | null,
 *   error: string | null,
 *   ranAt: string | null,
 * }} */
let lastSync = {
  ok: null,
  count: null,
  upserted: null,
  deleted: null,
  error: null,
  ranAt: null,
};

let syncQueue = Promise.resolve();

export function getWorksSyncStatus() {
  return { ...lastSync };
}

export function seriesCanonicalKey(seriesName) {
  const name = String(seriesName || "").trim().toLowerCase();
  if (!name) return null;
  return `series:${name}`;
}

function mapSeriesToWork(row) {
  const seriesTitle = String(row?.["Seriens navn"] || "").trim();
  const canonicalKey = seriesCanonicalKey(seriesTitle);
  if (!canonicalKey) return null;

  const firstBook = String(row?.["Første bog/titel"] || "").trim();
  const author = String(row?.Forfatter || "").trim();

  return {
    canonical_key: canonicalKey,
    title: firstBook || seriesTitle,
    author: author || null,
    series_title: seriesTitle,
    payload: {
      source: "series.json",
      status: row?.Status ?? null,
      firstBook: firstBook || null,
      indholdsmatch: row?.Indholdsmatch ?? null,
      laeseprioritetNu: row?.["Læseprioritet nu"] ?? null,
      tineScore: row?.["Tine-score"] ?? null,
      goodreadsScore: row?.["Goodreads-score"] ?? null,
      origin: row?._origin ?? null,
      syncedAt: new Date().toISOString(),
    },
  };
}

/**
 * Synkroniserer hele series-listen til works (upsert + slet orphans).
 * Soft-fail: returnerer status, kaster ikke videre til caller.
 */
export async function syncAllWorksFromSeries(list) {
  const ranAt = new Date().toISOString();

  if (!isDatabaseConfigured()) {
    lastSync = {
      skipped: true,
      ok: null,
      count: null,
      upserted: null,
      deleted: null,
      error: null,
      ranAt,
    };
    return getWorksSyncStatus();
  }

  const pool = getPool();
  if (!pool) {
    lastSync = {
      skipped: true,
      ok: false,
      count: null,
      upserted: null,
      deleted: null,
      error: "Ingen pool",
      ranAt,
    };
    return getWorksSyncStatus();
  }

  const works = (Array.isArray(list) ? list : [])
    .map(mapSeriesToWork)
    .filter(Boolean);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let upserted = 0;

    for (const work of works) {
      await client.query(
        `INSERT INTO works (canonical_key, title, author, series_title, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
         ON CONFLICT (canonical_key) DO UPDATE SET
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           series_title = EXCLUDED.series_title,
           payload = EXCLUDED.payload,
           updated_at = NOW()`,
        [
          work.canonical_key,
          work.title,
          work.author,
          work.series_title,
          JSON.stringify(work.payload),
        ],
      );
      upserted += 1;
    }

    const keys = works.map((w) => w.canonical_key);
    const del = await client.query(
      `DELETE FROM works
       WHERE canonical_key LIKE 'series:%'
         AND NOT (canonical_key = ANY($1::text[]))`,
      [keys],
    );

    await client.query(
      `INSERT INTO app_meta (key, value)
       VALUES (
         'fase7',
         jsonb_build_object(
           'bid', 3,
           'note', 'Dual-write series.json -> works; JSON remains source of truth',
           'worksCount', $1::int,
           'syncedAt', $2::text
         )
       )
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [works.length, ranAt],
    );

    await client.query("COMMIT");

    lastSync = {
      skipped: false,
      ok: true,
      count: works.length,
      upserted,
      deleted: del.rowCount ?? 0,
      error: null,
      ranAt,
    };
    console.log(
      `[works] Synced ${upserted} serie(r) til Postgres` +
        (lastSync.deleted ? ` (slettet ${lastSync.deleted} orphan(s))` : ""),
    );
    return getWorksSyncStatus();
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    lastSync = {
      skipped: false,
      ok: false,
      count: null,
      upserted: null,
      deleted: null,
      error: err?.message || String(err),
      ranAt,
    };
    console.warn(`[works] Sync fejlede: ${lastSync.error}`);
    return getWorksSyncStatus();
  } finally {
    client.release();
  }
}

/** Kø-baseret fire-and-forget efter JSON-save — blokerer ikke request. */
export function scheduleWorksSync(list) {
  if (!isDatabaseConfigured()) return;
  syncQueue = syncQueue
    .then(() => syncAllWorksFromSeries(list))
    .catch((err) => {
      console.warn(`[works] Queue-fejl: ${err?.message || err}`);
    });
}
