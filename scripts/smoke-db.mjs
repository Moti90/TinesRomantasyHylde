import "dotenv/config";
import { initDatabase, getDatabaseStatus } from "../server/services/db.js";

await initDatabase();
console.log(JSON.stringify(getDatabaseStatus(), null, 2));
