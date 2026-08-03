import { Router } from "express";
import { hasOpenAIKey } from "../services/config.js";
import {
  runDiscovery,
  listDiscovered,
  ignoreDiscovered,
  generateTeaser,
} from "../services/discovery.js";

const router = Router();

/** GET /api/discover/list?includeAdded=true */
router.get("/list", async (_req, res) => {
  try {
    const includeAdded =
      String(_req.query.includeAdded || "").toLowerCase() === "true";
    const data = await listDiscovered({ includeAdded });
    res.json({
      ok: true,
      lastRun: data.lastRun,
      fromCache: data.fromCache,
      candidates: data.candidates,
      count: data.candidates.length,
      pirateReads: data.pirateReads || null,
      readingProfile: data.readingProfile || null,
    });
  } catch (err) {
    console.error("[discover/list]", err);
    res.status(500).json({ error: err.message || "Kunne ikke hente discovery" });
  }
});

/** GET /api/discover/run?force=true — kør discovery */
router.get("/run", async (req, res) => {
  try {
    if (!hasOpenAIKey()) {
      return res.status(400).json({ error: "OpenAI-nøgle mangler" });
    }
    const force = String(req.query.force || "").toLowerCase() === "true";
    const result = await runDiscovery({ force });
    res.json({
      ok: true,
      newCount: result.newCount,
      candidateCount: result.candidateCount,
      fromCache: result.fromCache,
      lastRun: result.lastRun,
      queries: result.queries,
      meta: {
        estimatedCostUsd: result.meta?.estimatedCostUsd,
        filteredOutByGenre: result.meta?.filteredOutByGenre,
        filteredOutByPirateReads: result.meta?.filteredOutByPirateReads,
        pirateReadsCount: result.meta?.pirateReadsCount,
        genreFilterFailed: result.meta?.genreFilterFailed,
        queriesFailed: result.meta?.queriesFailed,
      },
    });
  } catch (err) {
    console.error("[discover/run]", err);
    res.status(500).json({ error: err.message || "Discovery fejlede" });
  }
});

/**
 * POST /api/discover/teaser
 * Body: { title, author?, sources?, matchedSignals?, force? }
 * Returnerer kort teaser — rører IKKE biblioteket.
 */
router.post("/teaser", async (req, res) => {
  try {
    if (!hasOpenAIKey()) {
      return res.status(400).json({ error: "OpenAI-nøgle mangler" });
    }
    const { title, author, sources, matchedSignals, force } = req.body || {};
    if (!title?.trim()) {
      return res.status(400).json({ error: "Titel mangler" });
    }
    const result = await generateTeaser({
      title,
      author,
      sources,
      matchedSignals,
      force: Boolean(force),
    });
    res.json({
      ok: true,
      teaser: result.teaser,
      cached: result.cached,
      candidate: result.candidate,
      meta: result.meta || null,
    });
  } catch (err) {
    console.error("[discover/teaser]", err);
    res.status(500).json({ error: err.message || "Teaser fejlede" });
  }
});

/** PUT /api/discover/:title/ignore */
router.put("/:title/ignore", (req, res) => {
  try {
    const title = decodeURIComponent(req.params.title || "");
    const author = req.body?.author || req.query?.author || null;
    if (!title.trim()) {
      return res.status(400).json({ error: "Titel mangler" });
    }
    const candidate = ignoreDiscovered(title, author);
    res.json({ ok: true, candidate });
  } catch (err) {
    console.error("[discover/ignore]", err);
    const status = /ikke fundet/i.test(err.message) ? 404 : 500;
    res.status(status).json({ error: err.message || "Ignore fejlede" });
  }
});

export default router;
