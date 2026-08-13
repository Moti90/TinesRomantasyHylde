#!/usr/bin/env node
/**
 * Research benchmark CLI (Bid 3 Fase A).
 * Default: offline fixtures (no API).
 * Live: npm run benchmark:research -- --live --ids acotar --confirm
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  evaluateSeriesBenchmark,
  findGroundTruth,
  summarizeRun,
} from "../server/services/researchBenchmark.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES_PATH = join(ROOT, "benchmark", "research-cases.json");
const TRUTH_PATH = join(ROOT, "benchmark", "research-ground-truth.json");
const FIXTURES_DIR = join(ROOT, "benchmark", "fixtures");
const OUTPUT_DIR = join(ROOT, "benchmark", "output");

function parseArgs(argv) {
  const args = { live: false, confirm: false, ids: [], limit: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--confirm") args.confirm = true;
    else if (a === "--offline") args.live = false;
    else if (a === "--ids") args.ids = String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadFixture(id) {
  const p = join(FIXTURES_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  return loadJson(p);
}

function stripRaw(result) {
  const { raw, reviewMarkdown, ...rest } = result;
  return rest;
}

function writeRun(outputRoot, results) {
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(join(outputRoot, "raw"), { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    ...summarizeRun(results),
    series: results.map(stripRaw),
  };
  writeFileSync(join(outputRoot, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  const md = results.map((r) => r.reviewMarkdown).join("\n\n---\n\n");
  writeFileSync(join(outputRoot, "review.md"), md, "utf8");
  writeFileSync(join(outputRoot, "review.json"), JSON.stringify(results.map(stripRaw), null, 2), "utf8");
  for (const r of results) {
    writeFileSync(
      join(outputRoot, "raw", `${r.id}.json`),
      JSON.stringify(
        {
          identity: r.identity,
          baselineResearch: r.raw?.baselineResearch,
          adaptiveResearch: r.raw?.adaptiveResearch,
          flags: r.flags,
        },
        null,
        2
      ),
      "utf8"
    );
  }
  return outputRoot;
}

function evaluateFixture(fix, groundTruthDoc, category) {
  const gt = findGroundTruth(groundTruthDoc, fix.id, fix.identity);
  return evaluateSeriesBenchmark({
    id: fix.id,
    category: category || fix.category,
    identity: fix.identity,
    baselineResearch: fix.baseline.research,
    baselineAnalysis: fix.baseline.analysis,
    adaptiveResearch: fix.adaptive.research,
    adaptiveAnalysis: fix.adaptive.analysis,
    followUpJobs: fix.adaptive.followUpJobs || [],
    groundTruth: gt,
    mode: "offline",
  });
}

async function runLiveCase(caseDef, groundTruthDoc) {
  const { hasOpenAIKey } = await import("../server/services/config.js");
  if (!hasOpenAIKey()) {
    throw new Error("Live benchmark requires an OpenAI key (data/config.json or OPENAI_API_KEY).");
  }
  const { researchSeries } = await import("../server/services/research.js");
  const { checkMofibo } = await import("../server/services/mofibo.js");
  const { runWebResearch } = await import("../server/services/webResearch.js");
  const { runHandbookAnalysis } = await import("../server/services/handbookAnalysis.js");
  const { runAdaptiveResearch } = await import("../server/services/adaptiveResearchLoop.js");

  const identity = caseDef.identity;
  const query = [identity.title, identity.author].filter(Boolean).join(" ");
  console.log(`[live] ${caseDef.id}: catalog/mofibo…`);
  const catalog = await researchSeries(query);
  const mofibo = await checkMofibo(identity.title);
  console.log(`[live] ${caseDef.id}: initial 4-batch research…`);
  const { research: initialResearch } = await runWebResearch({
    identity,
    catalog,
    mofibo,
  });
  const initialAnalysis = await runHandbookAnalysis({
    research: initialResearch,
    catalog,
    mofibo,
    query,
    updateGoodreads: true,
  });
  console.log(`[live] ${caseDef.id}: adaptive loop…`);
  const adapted = await runAdaptiveResearch({
    identity,
    initialResearch,
    initialAnalysis,
    catalog,
    mofibo,
  });
  const gt = findGroundTruth(groundTruthDoc, caseDef.id, identity);
  return evaluateSeriesBenchmark({
    id: caseDef.id,
    category: caseDef.category,
    identity,
    baselineResearch: initialResearch,
    baselineAnalysis: initialAnalysis,
    adaptiveResearch: adapted.research,
    adaptiveAnalysis: adapted.analysis,
    followUpJobs: (adapted.adaptive?.rounds || []).flatMap((r) => r.jobs || []),
    groundTruth: gt,
    mode: "live",
  });
}

function help() {
  console.log(`Research benchmark

Offline (default, no API):
  npm run benchmark:research

Live (costs money, requires --confirm):
  npm run benchmark:research -- --live --ids acotar --confirm
  npm run benchmark:research -- --live --limit 2 --confirm

Options:
  --offline          fixture mode (default)
  --live             real research pipeline
  --ids id,id        case ids from benchmark/research-cases.json
  --limit N          max live cases
  --confirm          required for live
  --out dir          output directory
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    help();
    return;
  }

  const casesDoc = loadJson(CASES_PATH);
  const truthDoc = loadJson(TRUTH_PATH);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = args.out || join(OUTPUT_DIR, runId);

  if (!args.live) {
    const fixtures = [];
    const wanted = args.ids.length ? args.ids : ["shadowbound-offline"];
    for (const id of wanted) {
      const fix = loadFixture(id);
      if (!fix) {
        console.warn(`No offline fixture for ${id} — skip (live required for real series).`);
        continue;
      }
      const caseDef = (casesDoc.cases || []).find((c) => c.id === id);
      fixtures.push(evaluateFixture(fix, truthDoc, caseDef?.category || fix.category));
    }
    if (!fixtures.length) {
      console.error("No offline fixtures evaluated.");
      process.exitCode = 1;
      return;
    }
    const dir = writeRun(outDir, fixtures);
    console.log(`Offline benchmark written to ${dir}`);
    console.log(JSON.stringify(summarizeRun(fixtures), null, 2));
    return;
  }

  if (!args.confirm) {
    const n = args.ids.length || args.limit || 2;
    console.error(`Live mode would call OpenAI/web_search.

Estimated cost (rough): ~$0.10–0.35 per series × ${n} ≈ $${(0.35 * n).toFixed(2)} worst case.

Refusing accidental live run.
Re-run with --live --confirm and --ids or --limit (max 3 recommended).`);
    process.exitCode = 2;
    return;
  }

  let selected = casesDoc.cases || [];
  if (args.ids.length) selected = selected.filter((c) => args.ids.includes(c.id));
  const limit = args.limit || selected.length;
  if (limit > 3 && !args.ids.length) {
    console.error("Refusing to live-run more than 3 series without explicit --ids.");
    process.exitCode = 2;
    return;
  }
  selected = selected.slice(0, Math.min(limit, 3));
  if (!selected.length) {
    console.error("No matching cases.");
    process.exitCode = 1;
    return;
  }

  console.log(`Live benchmark: ${selected.map((c) => c.id).join(", ")}`);
  const results = [];
  for (const caseDef of selected) {
    try {
      results.push(await runLiveCase(caseDef, truthDoc));
    } catch (err) {
      console.error(`Live case ${caseDef.id} failed:`, err.message);
      results.push({
        id: caseDef.id,
        identity: caseDef.identity,
        mode: "live",
        error: err.message,
        flags: [{ code: "TOO_EXPENSIVE", detail: err.message, requiresHumanReview: true }],
        reviewMarkdown: `# SERIES: ${caseDef.id}\n\nERROR: ${err.message}`,
        comparison: {},
        cost: { adaptiveAdditionalCostUsd: 0 },
      });
    }
  }
  const dir = writeRun(outDir, results);
  console.log(`Live benchmark written to ${dir}`);
  console.log(JSON.stringify(summarizeRun(results), null, 2));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

export { parseArgs, evaluateFixture, main };
