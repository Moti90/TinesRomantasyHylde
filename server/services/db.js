import pg from "pg";

const { Pool } = pg;

/** @type {import("pg").Pool | null} */
let pool = null;
/** @type {string | null} */
let lastError = null;
/** @type {boolean | null} */
let lastOk = null;
/** @type {number | null} */
let lastLatencyMs = null;
/** @type {string | null} */
let lastCheckedAt = null;

/**
 * Railway sætter typisk DATABASE_URL når Postgres er linked.
 * Fallback: DATABASE_PRIVATE_URL eller klassiske PG*-variabler.
 */
export function getDatabaseUrl() {
  const url =
    process.env.DATABASE_URL?.trim() ||
    process.env.DATABASE_PRIVATE_URL?.trim() ||
    "";
  if (url) return url;

  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const database = process.env.PGDATABASE?.trim();
  if (!host || !user || !database) return "";

  const port = process.env.PGPORT?.trim() || "5432";
  const password = encodeURIComponent(process.env.PGPASSWORD || "");
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

export function isDatabaseConfigured() {
  return Boolean(getDatabaseUrl());
}

function shouldUseSsl(connectionString) {
  if (process.env.DATABASE_SSL === "false") return false;
  if (process.env.PGSSLMODE === "disable") return false;
  if (process.env.DATABASE_SSL === "true") return true;
  if (process.env.NODE_ENV === "production") return true;
  return /railway|amazonaws|neon\.tech|supabase/i.test(connectionString);
}

function createPool() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) return null;

  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: shouldUseSsl(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

export function getPool() {
  if (!isDatabaseConfigured()) return null;
  if (!pool) pool = createPool();
  return pool;
}

/**
 * @returns {Promise<{ ok: boolean, configured: boolean, latencyMs: number | null, error: string | null }>}
 */
export async function pingDatabase() {
  const configured = isDatabaseConfigured();
  if (!configured) {
    lastOk = false;
    lastError = null;
    lastLatencyMs = null;
    lastCheckedAt = new Date().toISOString();
    return {
      ok: false,
      configured: false,
      latencyMs: null,
      error: null,
    };
  }

  const started = Date.now();
  try {
    const client = await getPool().connect();
    try {
      await client.query("SELECT 1 AS ok");
    } finally {
      client.release();
    }
    lastOk = true;
    lastError = null;
    lastLatencyMs = Date.now() - started;
    lastCheckedAt = new Date().toISOString();
    return {
      ok: true,
      configured: true,
      latencyMs: lastLatencyMs,
      error: null,
    };
  } catch (err) {
    lastOk = false;
    lastError = err?.message || String(err);
    lastLatencyMs = Date.now() - started;
    lastCheckedAt = new Date().toISOString();
    return {
      ok: false,
      configured: true,
      latencyMs: lastLatencyMs,
      error: lastError,
    };
  }
}

export function getDatabaseStatus() {
  const configured = isDatabaseConfigured();
  return {
    configured,
    connected: Boolean(configured && lastOk),
    ok: lastOk,
    latencyMs: lastLatencyMs,
    checkedAt: lastCheckedAt,
    error: lastError,
    source: process.env.DATABASE_URL
      ? "DATABASE_URL"
      : process.env.DATABASE_PRIVATE_URL
        ? "DATABASE_PRIVATE_URL"
        : process.env.PGHOST
          ? "PG*"
          : null,
  };
}

/** Soft-check ved opstart — appen kører videre på JSON hvis DB mangler. */
export async function initDatabase() {
  if (!isDatabaseConfigured()) {
    console.log(
      "[db] Ingen DATABASE_URL / PG*-variabler — kører kun på JSON-filer",
    );
    return getDatabaseStatus();
  }
  const result = await pingDatabase();
  if (result.ok) {
    console.log(`[db] Postgres forbundet (${result.latencyMs} ms)`);
  } else {
    console.warn(`[db] Postgres konfigureret, men forbindelse fejlede: ${result.error}`);
  }
  return getDatabaseStatus();
}

export async function closeDatabase() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
