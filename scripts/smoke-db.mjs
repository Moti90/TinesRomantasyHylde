import "dotenv/config";
import { loadSeries } from "../server/services/store.js";
import { initDatabase, getDatabaseStatus } from "../server/services/db.js";
import {
  getMigrationStatus,
  runSqlMigrations,
} from "../server/services/dbMigrate.js";
import {
  getWorksSyncStatus,
  syncAllWorksFromSeries,
} from "../server/services/worksSync.js";

await initDatabase();
const db = getDatabaseStatus();
if (db.connected) {
  await runSqlMigrations();
  await syncAllWorksFromSeries(loadSeries());
}
console.log(
  JSON.stringify(
    {
      database: getDatabaseStatus(),
      migrations: getMigrationStatus(),
      works: getWorksSyncStatus(),
    },
    null,
    2,
  ),
);
