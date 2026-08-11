import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getPool, isDatabaseConfigured } from "./db.js";

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../db/migrations",
);

/** @type {{
 *   skipped?: boolean,
 *   applied: string[],
 *   newlyApplied: string[],
 *   latest: string | null,
 *   error: string | null,
 *   ranAt: string | null,
 * }} */
let lastStatus = {
  applied: [],
  newlyApplied: [],
  latest: null,
  error: null,
  ranAt: null,
};

export function getMigrationStatus() {
  return { ...lastStatus, applied: [...lastStatus.applied] };
}

function listMigrationFiles() {
  try {
    return readdirSync(migrationsDir)
      .filter((name) => /^\d+_.+\.sql$/i.test(name))
      .sort((a, b) => a.localeCompare(b, "en"));
  } catch {
    return [];
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Kører pending SQL-migrationer. Soft-fail: returnerer status, kaster ikke
 * opstarten væk medmindre caller vælger det.
 */
export async function runSqlMigrations() {
  const ranAt = new Date().toISOString();

  if (!isDatabaseConfigured()) {
    lastStatus = {
      skipped: true,
      applied: [],
      newlyApplied: [],
      latest: null,
      error: null,
      ranAt,
    };
    return getMigrationStatus();
  }

  const pool = getPool();
  if (!pool) {
    lastStatus = {
      skipped: true,
      applied: [],
      newlyApplied: [],
      latest: null,
      error: "Ingen pool",
      ranAt,
    };
    return getMigrationStatus();
  }

  const files = listMigrationFiles();
  const client = await pool.connect();
  const newlyApplied = [];

  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query(
      "SELECT id FROM schema_migrations ORDER BY id ASC",
    );
    const already = new Set(rows.map((r) => r.id));

    for (const file of files) {
      if (already.has(file)) continue;
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (id) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
        newlyApplied.push(file);
        already.add(file);
        console.log(`[db] Migration applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    const applied = [...already].sort((a, b) => a.localeCompare(b, "en"));
    lastStatus = {
      skipped: false,
      applied,
      newlyApplied,
      latest: applied[applied.length - 1] || null,
      error: null,
      ranAt,
    };
    if (newlyApplied.length === 0) {
      console.log(
        `[db] Schema up to date (${applied.length} migration${applied.length === 1 ? "" : "er"})`,
      );
    }
    return getMigrationStatus();
  } catch (err) {
    lastStatus = {
      skipped: false,
      applied: lastStatus.applied || [],
      newlyApplied,
      latest: lastStatus.latest || null,
      error: err?.message || String(err),
      ranAt,
    };
    console.warn(`[db] Migration fejlede: ${lastStatus.error}`);
    return getMigrationStatus();
  } finally {
    client.release();
  }
}
