import "dotenv/config";
import { initDatabase, getDatabaseStatus } from "../server/services/db.js";
import {
  getMigrationStatus,
  runSqlMigrations,
} from "../server/services/dbMigrate.js";

await initDatabase();
const db = getDatabaseStatus();
if (db.connected) await runSqlMigrations();
console.log(
  JSON.stringify(
    { database: getDatabaseStatus(), migrations: getMigrationStatus() },
    null,
    2,
  ),
);
