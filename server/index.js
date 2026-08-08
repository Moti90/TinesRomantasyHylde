import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import {
  loadSeries,
  saveSeries,
  upsertSeries,
  patchSeries,
  deleteSeries,
} from "./services/store.js";
import { ensureMigratedDatabase } from "./services/migrate.js";
import {
  analyzeNewSeries,
  reanalyzeSeries as pipelineReanalyze,
  refreshSeriesResearch,
} from "./services/pipeline.js";
import { hasOpenAIKey } from "./services/config.js";
import {
  getAiStatus,
  getGeminiStatus,
  setGeminiKey,
  setOpenAIKey,
} from "./services/config.js";
import { seriesToWorkbook, workbookToSeries } from "./services/excel.js";
import { STATUS_ORDER } from "./services/columns.js";
import discoveryRouter from "./routes/discovery.js";
import {
  findTineReviewForTarget,
  listTineReviews,
  upsertTineReview,
} from "./services/tineReviews.js";
import {
  isExcludedReviewBook,
  loadPirateReadsLibrary,
  mapPirateReadsBookForReview,
  searchPirateReadsForReview,
} from "./services/pirateReads.js";
import { identifyBook } from "./services/identify.js";
import {
  enrichIdentityWithLocalSeries,
  mapIdentityToReviewTarget,
  matchLocalLibrary,
} from "./services/tineReviewTargets.js";
import { getTineReviewSummary } from "./services/tineReviewSummaries.js";
import { backfillDecisionScores } from "./services/decisionScoreBackfill.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

ensureMigratedDatabase();
backfillDecisionScores();

const app = express();
const PORT = Number(process.env.PORT) || 3847;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(join(root, "public")));

app.use("/api/discover", discoveryRouter);

app.get("/api/health", (_req, res) => {
  const ai = getAiStatus();
  res.json({
    ok: true,
    ready: hasOpenAIKey(),
    provider: ai.provider,
    openai: hasOpenAIKey(),
    // Ingen nøgler / modelnavne til Tine-UI
    count: loadSeries().length,
  });
});

/** Udvikler-status — ikke til primær UI */
app.get("/api/admin/status", (_req, res) => {
  const ai = getAiStatus();
  const gemini = getGeminiStatus();
  res.json({
    ok: true,
    provider: ai.provider,
    openai: hasOpenAIKey(),
    gemini: gemini.configured,
    geminiStatus: gemini,
    aiStatus: ai,
    count: loadSeries().length,
  });
});

app.get("/api/settings/gemini", (_req, res) => {
  res.json(getGeminiStatus());
});

app.post("/api/settings/gemini", (req, res) => {
  const key = req.body?.apiKey;
  if (key !== null && key !== undefined && typeof key !== "string") {
    return res.status(400).json({ error: "Ugyldig nøgle" });
  }
  const status = setGeminiKey(key ?? "");
  res.json(status);
});

app.delete("/api/settings/gemini", (_req, res) => {
  res.json(setGeminiKey(""));
});

app.post("/api/settings/openai", (req, res) => {
  const key = req.body?.apiKey;
  if (key !== null && key !== undefined && typeof key !== "string") {
    return res.status(400).json({ error: "Ugyldig nøgle" });
  }
  res.json(setOpenAIKey(key ?? ""));
});

app.get("/api/series", (_req, res) => {
  res.json({ series: loadSeries(), statusOrder: STATUS_ORDER });
});

app.get("/api/tine-reviews", (_req, res) => {
  res.json({ reviews: listTineReviews() });
});

app.get("/api/tine-review-books", async (req, res) => {
  try {
    const library = await loadPirateReadsLibrary({
      force: req.query.force === "true",
    });
    const books = library.books
      .filter((book) => book.shelf === "read")
      .filter((book) => !isExcludedReviewBook(book))
      .map(mapPirateReadsBookForReview);
    res.json({
      books,
      meta: {
        source: "piratereads",
        fromCache: library.fromCache,
        fetchedAt: library.fetchedAt,
        count: books.length,
      },
    });
  } catch (err) {
    res.status(502).json({
      error: err.message || "Kunne ikke hente Tines læste Goodreads-bøger",
    });
  }
});

app.post("/api/tine-review-identify", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();
    const author = String(req.body?.author || "").trim();
    const selectedIdentity = req.body?.selectedIdentity || null;

    if (!query && !author && !selectedIdentity?.title) {
      return res.status(400).json({
        error: "Angiv bogtitel, serienavn eller forfatter",
      });
    }

    let identityResult;
    if (selectedIdentity?.title) {
      identityResult = {
        status: "identified",
        identity: enrichIdentityWithLocalSeries({
          title: selectedIdentity.title,
          author: selectedIdentity.author || author || null,
          series: selectedIdentity.series || null,
          bookNumber: selectedIdentity.bookNumber ?? null,
          goodreadsUrl: selectedIdentity.goodreadsUrl || null,
          source: selectedIdentity.source || null,
          identityConfidence:
            selectedIdentity.identityConfidence ||
            selectedIdentity.confidence ||
            "high",
        }),
        candidates: [],
      };
    } else {
      // 1) Goodreads (PirateReads) — samme hylder som før, bedst til anmeldelser
      let goodreads = null;
      try {
        const library = await loadPirateReadsLibrary();
        goodreads = searchPirateReadsForReview(library.books, { query, author });
      } catch (err) {
        console.warn("tine-review-identify: Goodreads-søgning fejlede:", err.message);
      }

      // 2) Lokalt bibliotek
      const local = matchLocalLibrary({ query, author });

      if (goodreads?.status === "identified") {
        identityResult = goodreads;
      } else if (goodreads?.status === "ambiguous") {
        const seen = new Set();
        const merged = [];
        for (const c of [
          ...(goodreads.candidates || []),
          ...(local?.candidates || []),
        ]) {
          const key = `${String(c.series || c.title || "").toLowerCase()}|${String(
            c.author || ""
          ).toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(c);
        }
        identityResult = {
          ...goodreads,
          candidates: merged.slice(0, 8),
        };
      } else if (local?.status === "ambiguous") {
        identityResult = local;
      } else if (local?.status === "identified" && local.identity?.series) {
        identityResult = local;
      } else {
        // 3) Open Library / Google Books som fallback
        identityResult = await identifyBook({ query, author });
        if (
          identityResult.status === "not_found" &&
          local?.status === "identified"
        ) {
          identityResult = local;
        } else if (identityResult.status === "identified") {
          identityResult = {
            ...identityResult,
            identity: enrichIdentityWithLocalSeries(identityResult.identity),
          };
        } else if (
          identityResult.status === "ambiguous" &&
          local?.candidates?.length
        ) {
          const seen = new Set();
          const merged = [];
          for (const c of [
            ...(local.candidates || []),
            ...identityResult.candidates,
          ]) {
            const key = `${String(c.series || c.title || "").toLowerCase()}|${String(
              c.author || ""
            ).toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(c);
          }
          identityResult = {
            ...identityResult,
            candidates: merged.slice(0, 8),
            userMessage:
              identityResult.userMessage ||
              local.userMessage ||
              "Flere bøger matcher. Vælg den rigtige.",
          };
        }
      }
    }

    if (identityResult.status === "ambiguous") {
      return res.json({
        needsChoice: true,
        candidates: identityResult.candidates || [],
        userMessage:
          identityResult.userMessage || "Flere bøger matcher. Vælg den rigtige.",
      });
    }

    if (identityResult.status === "not_found" || !identityResult.identity) {
      return res.status(404).json({
        error: "Kunne ikke finde en bog eller serie med det navn",
      });
    }

    const target = mapIdentityToReviewTarget(identityResult.identity);
    const existingReview = findTineReviewForTarget(target);
    return res.json({
      needsChoice: false,
      target,
      existingReview,
      candidates: identityResult.candidates || [],
      userMessage: target.isSeries
        ? "Serien er fundet. Bekræft, at det er den rigtige."
        : "Bogen er fundet. Bekræft, at det er den rigtige.",
    });
  } catch (err) {
    res.status(502).json({
      error: err.message || "Kunne ikke søge efter bog eller serie",
    });
  }
});

app.post("/api/tine-review-summary", async (req, res) => {
  try {
    const body = req.body || {};
    if (!String(body.firstBookTitle || body.displayTitle || "").trim()) {
      return res.status(400).json({ error: "Bogen mangler titel" });
    }
    const result = await getTineReviewSummary(
      {
        sourceBookId: body.sourceBookId || null,
        displayTitle: body.displayTitle || null,
        firstBookTitle: body.firstBookTitle || null,
        seriesName: body.seriesName || null,
        author: body.author || null,
        goodreadsUrl: body.goodreadsUrl || null,
      },
      { force: body.force === true }
    );
    res.json(result);
  } catch (err) {
    res.status(502).json({
      error: err.message || "Kunne ikke lave et resumé af bogen",
    });
  }
});

app.post("/api/tine-reviews", (req, res) => {
  try {
    const body = req.body || {};
    if (!String(body.seriesName || body.firstBookTitle || "").trim()) {
      return res.status(400).json({ error: "Bogen mangler titel" });
    }
    const overallScore =
      body.overallScore === null || body.overallScore === undefined || body.overallScore === ""
        ? null
        : Number(body.overallScore);
    if (overallScore != null && (Number.isNaN(overallScore) || overallScore < 0 || overallScore > 100)) {
      return res.status(400).json({ error: "Tines score skal være mellem 0 og 100" });
    }
    const rereadChoice = ["yes", "maybe", "no"].includes(body.rereadChoice)
      ? body.rereadChoice
      : null;
    const source =
      body.source === "piratereads" || body.source === "identity"
        ? body.source
        : "identity";
    const reviews = upsertTineReview({
      seriesName: body.seriesName || null,
      firstBookTitle: body.firstBookTitle || null,
      author: body.author || null,
      status: body.status || "Læst",
      isSeries: Boolean(body.isSeries),
      sourceBookId: body.sourceBookId || null,
      source,
      goodreadsUrl: body.goodreadsUrl || null,
      identity: body.identity || null,
      overallScore,
      rereadChoice,
      comment: body.comment || "",
      subjectiveScores: body.subjectiveScores || {},
      positives: Array.isArray(body.positives) ? body.positives : [],
      negatives: Array.isArray(body.negatives) ? body.negatives : [],
      ignoredFields: Array.isArray(body.ignoredFields) ? body.ignoredFields : [],
    });
    res.json({ reviews, series: loadSeries() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Kunne ikke gemme anmeldelse" });
  }
});

app.patch("/api/series/:name", (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const allowed = [
      "Status",
      "Tines egen vurdering",
      "Tines score",
      "Er serien på Mofibo? (ja, nej, ikke hele serien)",
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (
      patch["Tines score"] !== undefined &&
      patch["Tines score"] !== null &&
      patch["Tines score"] !== ""
    ) {
      const n = Number(patch["Tines score"]);
      if (Number.isNaN(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: "Tines score skal være 0–100" });
      }
      patch["Tines score"] = Math.round(n);
    } else if (patch["Tines score"] === "") {
      patch["Tines score"] = null;
    }
    const series = patchSeries(name, patch);
    res.json({ series });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.delete("/api/series/:name", (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const series = deleteSeries(name);
    res.json({ series });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const query = String(req.body.query || "").trim();
    const author = String(req.body.author || "").trim();
    const link = String(req.body.link || "").trim();
    const status = req.body.status || "Ikke læst";
    const selectedIdentity = req.body.selectedIdentity || null;

    if (!query && !link && !selectedIdentity) {
      return res.status(400).json({ error: "Angiv serienavn/titel eller link" });
    }

    if (!hasOpenAIKey()) {
      return res.status(503).json({
        error:
          "Analysen er ikke klar endnu. Prøv igen lidt senere.",
      });
    }

    const result = await analyzeNewSeries({
      query: query || link,
      author,
      link,
      status,
      selectedIdentity,
    });

    if (result.needsChoice) {
      return res.json({
        needsChoice: true,
        candidates: result.candidates,
        userMessage: result.userMessage,
      });
    }

    res.json({
      needsChoice: false,
      row: result.row,
      series: result.series,
      meta: {
        fallback: result.meta?.fallback || false,
        note: result.meta?.userMessage || null,
        userMessage: result.meta?.userMessage || null,
        researchCacheHit: result.meta?.researchCacheHit || false,
        foundation: result.meta?.foundation || null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Noget gik galt under analysen. Prøv igen.",
    });
  }
});

/** Genkør håndbogsanalyse — ingen ny web search */
app.post("/api/series/:name/reanalyze", async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    if (!hasOpenAIKey()) {
      return res.status(503).json({
        error: "Analysen er ikke klar endnu. Prøv igen lidt senere.",
      });
    }
    const result = await pipelineReanalyze(name);
    res.json({
      row: result.row,
      series: result.series,
      meta: {
        fallback: result.meta?.fallback || false,
        note: result.meta?.userMessage || null,
        userMessage: result.meta?.userMessage || null,
        webSearchUsed: false,
        researchCacheHit: result.meta?.researchCacheHit !== false,
        reused: Boolean(result.meta?.reused),
        foundation: result.meta?.foundation || null,
      },
    });
  } catch (err) {
    console.error(err);
    if (err.message === "Serie ikke fundet") {
      return res.status(404).json({ error: "Serie ikke fundet" });
    }
    res.status(500).json({
      error: "Genanalysen lykkedes ikke. Prøv igen.",
    });
  }
});

/** Ny webresearch + analyse */
app.post("/api/series/:name/refresh", async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    if (!hasOpenAIKey()) {
      return res.status(503).json({
        error: "Analysen er ikke klar endnu. Prøv igen lidt senere.",
      });
    }
    const result = await refreshSeriesResearch(name);
    res.json({
      row: result.row,
      series: result.series,
      meta: {
        fallback: result.meta?.fallback || false,
        note: result.meta?.userMessage || null,
        userMessage: result.meta?.userMessage || null,
        webSearchUsed: true,
        researchCacheHit: false,
        foundation: result.meta?.foundation || null,
      },
    });
  } catch (err) {
    console.error(err);
    if (err.message === "Serie ikke fundet") {
      return res.status(404).json({ error: "Serie ikke fundet" });
    }
    res.status(500).json({
      error: "Opdateringen lykkedes ikke. Prøv igen.",
    });
  }
});

app.get("/api/export", async (_req, res) => {
  try {
    const wb = await seriesToWorkbook(loadSeries());
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Tines_Romantasy_Database.xlsx"'
    );
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/import", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Ingen fil uploadet" });
    const imported = (await workbookToSeries(req.file.buffer)).map((row) => ({
      ...row,
      _origin: {
        type: "excel",
        label: "Fra Tines Excel-ark",
      },
    }));
    if (!imported.length) {
      return res.status(400).json({ error: "Ingen serier fundet i filen" });
    }
    const mode = req.body.mode || "replace";
    let series;
    if (mode === "merge") {
      let list = loadSeries();
      for (const row of imported) {
        const key = (row["Seriens navn"] || "").toLowerCase();
        const idx = list.findIndex(
          (r) => (r["Seriens navn"] || "").toLowerCase() === key
        );
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            ...row,
            "Tines egen vurdering":
              row["Tines egen vurdering"] ??
              list[idx]["Tines egen vurdering"] ??
              null,
            "Tines score":
              row["Tines score"] ?? list[idx]["Tines score"] ?? null,
          };
        } else list.push(row);
      }
      series = saveSeries(list);
    } else {
      series = saveSeries(imported);
    }
    backfillDecisionScores({ force: true });
    series = loadSeries();
    res.json({ series, count: imported.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Import fejlede" });
  }
});

// Railway (og andre PaaS) kræver 0.0.0.0 — ellers "Application failed to respond"
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Tines Romantasy Liste lytter på 0.0.0.0:${PORT}`);
  console.log(`DATA_DIR: ${process.env.DATA_DIR || "(lokal ./data)"}`);
  if (hasOpenAIKey()) console.log("AI: OpenAI klar (webresearch + håndbogsanalyse)");
  else console.log("AI: mangler (sæt OPENAI_API_KEY eller data/config.json)");
  if (!existsSync(join(root, "data/series.json")) && !process.env.DATA_DIR) {
    saveSeries([]);
  }
});
