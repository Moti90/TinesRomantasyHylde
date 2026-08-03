/**
 * Test af Discovery punkt 1–3 (uden API/UI).
 *
 *   node scripts/run-discovery.mjs           # kør (bruger cache hvis gyldig)
 *   node scripts/run-discovery.mjs --force   # ignorer cache
 *   node scripts/run-discovery.mjs --dna     # kun smags-DNA + queries (ingen API)
 */
import {
  extractTasteDNA,
  buildDiscoveryQueries,
  runDiscovery,
} from "../server/services/discovery.js";

const args = new Set(process.argv.slice(2));

async function main() {
  const dna = extractTasteDNA();
  console.log("\n=== Smags-DNA ===");
  console.log("Top-serier:", dna.topSerier.length);
  dna.topSerier.slice(0, 5).forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name} (${s.author}) — ${s.score}`);
  });
  console.log("Bund-serier:", dna.bundSerier.length);
  dna.bundSerier.slice(0, 5).forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name} (${s.author}) — ${s.score} [${s.status}]`);
  });

  const queries = buildDiscoveryQueries(dna.topSerier);
  console.log("\n=== Signatur-søgninger ===");
  queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));

  if (args.has("--dna")) {
    console.log("\n(--dna) Stopper før API-kald.");
    return;
  }

  console.log("\n=== Kører discovery ===");
  const result = await runDiscovery({ force: args.has("--force") });
  console.log("\nResultat:");
  console.log(`  fromCache: ${result.fromCache}`);
  console.log(`  queries: ${result.queries}`);
  console.log(`  kandidater: ${result.candidateCount} (nye: ${result.newCount})`);
  console.log(
    `  fjernet af genre-filter: ${result.meta.filteredOutByGenre ?? 0}${
      result.meta.genreFilterFailed ? " (filter fejlede — fail-safe)" : ""
    }`
  );
  console.log(
    `  fjernet af PirateReads: ${result.meta.filteredOutByPirateReads ?? 0} (hylder: ${result.meta.pirateReadsCount ?? "?"})`
  );
  console.log(`  estimeret cost: $${(result.meta.estimatedCostUsd || 0).toFixed(4)}`);
  console.log(`  gemt i: ${result.path}`);
  if (result.meta.queriesFailed) {
    console.log(`  fejlede søgninger: ${result.meta.queriesFailed}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
