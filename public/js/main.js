import {
  getHealth,
  getSeries,
  getTineReviews,
  saveTineReview,
  analyzeSeries,
  patchSeries,
  deleteSeries,
  reanalyzeSeries,
  refreshSeries,
  importExcel,
  exportExcel,
  getDiscoveryList,
  runDiscovery as apiRunDiscovery,
  ignoreDiscovered,
  fetchDiscoveryTeaser,
} from "./api.js";
import { renderList, renderDetail } from "./ui/list.js";
import {
  renderDiscoveryList,
  setDiscoveryMeta,
  setDiscoveryStatus,
  showTeaserPanel,
  hideTeaserPanel,
  isFreshTeaser,
} from "./ui/discovery.js";

let series = [];
let tineReviews = [];
let reviewIndex = 0;
let pendingAnalyze = null;
let stepTimer = null;
const LIBRARY_LOCK_CODE = "1234";

const ANALYZE_STEPS = [
  "Identificerer bog eller serie",
  "Søger efter oplysninger og anmeldelser",
  "Sammenholder kilder",
  "Vurderer efter Tines håndbog",
  "Gemmer analysen",
];

const REVIEW_SCORE_FIELDS = [
  ["romance", "Romance / sommerfugle"],
  ["rhysand", "Rhysand-faktor"],
  ["touchHerAndDie", "Touch Her And Die"],
  ["protective", "Beskyttende helt(e)"],
  ["bodyguard", "Bodyguard-vibe"],
  ["femaleGrowth", "Kvindelig udvikling"],
  ["worldbuilding", "Worldbuilding"],
  ["epicPlot", "Episk plot"],
  ["spiceQuality", "Spice-kvalitet"],
  ["bookHangover", "Book hangover"],
];

const REVIEW_POSITIVE_TAGS = [
  "Beskyttende helt",
  "Stærk kvindelig udvikling",
  "Følelsesmæssig intensitet",
  "Episk plot",
  "Stærk romance",
  "Book hangover",
  "Found family",
  "Reverse harem / why choose",
];

const REVIEW_NEGATIVE_TAGS = [
  "Bully / nedladende MMC",
  "For meget erotik ift. plot",
  "For langsom uden payoff",
  "Uafsluttet serie",
  "Svag romance",
  "Kontrol forklædt som beskyttelse",
  "Tynd worldbuilding",
  "Utilfredsstillende slutning",
];

function setMsg(id, text, isError = false) {
  const el = document.getElementById(id);
  el.textContent = text || "";
  el.classList.toggle("error", Boolean(isError && text));
  el.classList.toggle("ok", Boolean(!isError && text));
}

function requireLibraryCode() {
  return window.prompt("Indtast kode for at låse bibliotekshandlingen op") === LIBRARY_LOCK_CODE;
}

function showSteps(activeIndex) {
  const box = document.getElementById("analyze-steps");
  if (!box) return;
  box.hidden = false;
  box.innerHTML = ANALYZE_STEPS.map(
    (label, i) =>
      `<div class="step ${i < activeIndex ? "done" : ""} ${i === activeIndex ? "active" : ""}">${label}</div>`
  ).join("");
}

function hideSteps() {
  const box = document.getElementById("analyze-steps");
  if (box) {
    box.hidden = true;
    box.innerHTML = "";
  }
  if (stepTimer) {
    clearInterval(stepTimer);
    stepTimer = null;
  }
}

function startStepAnimation() {
  let i = 0;
  showSteps(0);
  stepTimer = setInterval(() => {
    i = Math.min(i + 1, ANALYZE_STEPS.length - 1);
    showSteps(i);
  }, 4500);
}

function hideCandidates() {
  const box = document.getElementById("candidate-pick");
  if (box) {
    box.hidden = true;
    box.innerHTML = "";
  }
}

function showCandidates(candidates, basePayload) {
  const box = document.getElementById("candidate-pick");
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `
    <p class="hint">Flere bøger matcher. Vælg den rigtige:</p>
    <ul class="candidate-list">
      ${candidates
        .map(
          (c, i) => `
        <li>
          <button type="button" class="btn ghost candidate-btn" data-idx="${i}">
            <strong>${escapeHtml(c.title || "?")}</strong>
            <span>${escapeHtml(c.author || "Ukendt forfatter")}${c.year ? ` · ${c.year}` : ""}</span>
          </button>
        </li>`
        )
        .join("")}
    </ul>`;

  box.querySelectorAll(".candidate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const c = candidates[Number(btn.dataset.idx)];
      hideCandidates();
      await runAnalyze({
        ...basePayload,
        selectedIdentity: {
          title: c.title,
          author: c.author,
          series: c.series || null,
          bookNumber: c.bookNumber ?? null,
          identityConfidence: c.identityConfidence || "high",
        },
      });
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function onStatusChange(name, status) {
  try {
    const res = await patchSeries(name, { Status: status });
    series = res.series;
    paintList();
  } catch (err) {
    setMsg("io-status", err.message, true);
  }
}

async function onDelete(name) {
  if (!name) return;
  const ok = window.confirm(`Slet "${name}" fra listen?`);
  if (!ok) return;
  try {
    const res = await deleteSeries(name);
    series = res.series;
    const open = document.getElementById("detail")?.dataset.seriesName;
    if (open && open.toLowerCase() === name.toLowerCase()) {
      renderDetail(null);
    }
    paintList();
  } catch (err) {
    setMsg("io-status", err.message, true);
  }
}

function paintList() {
  renderList(series, {
    onOpen: (row) => renderDetail(row),
    onStatusChange,
    onDelete,
  });
}

async function saveOwnAssessment() {
  const panel = document.getElementById("detail");
  const name = panel.dataset.seriesName;
  const text = document.getElementById("own-assessment").value;
  const scoreRaw = document.getElementById("own-score").value.trim();
  const msg = document.getElementById("own-assessment-msg");
  if (!name) return;

  let score = null;
  if (scoreRaw !== "") {
    score = Number(scoreRaw);
    if (Number.isNaN(score) || score < 0 || score > 100) {
      msg.textContent = "Score skal være et tal mellem 0 og 100";
      msg.classList.add("error");
      msg.classList.remove("ok");
      return;
    }
  }

  try {
    const res = await patchSeries(name, {
      "Tines egen vurdering": text,
      "Tines score": scoreRaw === "" ? "" : score,
    });
    series = res.series;
    paintList();
    const updated = series.find((r) => r["Seriens navn"] === name);
    if (updated) renderDetail(updated);
    msg.textContent =
      score == null
        ? "Note gemt (ingen score sat — score hjælper kalibrering)"
        : `Gemt — din score ${score} bruges til fremtidige analyser`;
    msg.classList.add("ok");
    msg.classList.remove("error");
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add("error");
    msg.classList.remove("ok");
  }
}

async function refresh() {
  const data = await getSeries();
  series = data.series || [];
  paintList();
  renderTineReviews();
}

function getReviewBooks() {
  return series.filter((row) => {
    const status = String(row.Status || "").trim().toLowerCase();
    return status === "læst" || status === "droppet";
  });
}

function reviewBookKey(book) {
  return [
    book?.["Seriens navn"],
    book?.["Første bog/titel"],
    book?.Forfatter,
  ]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

function reviewDataKey(review) {
  return [review?.seriesName, review?.firstBookTitle, review?.author]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

function findTineReview(book) {
  const key = reviewBookKey(book);
  return tineReviews.find((review) => reviewDataKey(review) === key) || null;
}

function renderReviewTagList(id, tags, selected = []) {
  const box = document.getElementById(id);
  if (!box) return;
  const chosen = new Set(selected);
  box.innerHTML = tags
    .map(
      (tag, i) => `
        <label class="review-tag-option">
          <input type="checkbox" value="${escapeHtml(tag)}" ${chosen.has(tag) ? "checked" : ""} />
          <span>${escapeHtml(tag)}</span>
        </label>`
    )
    .join("");
}

function renderReviewScoreFields(saved = null) {
  const box = document.getElementById("review-score-fields");
  if (!box) return;
  const ignored = new Set(saved?.ignoredFields || []);
  const scores = saved?.subjectiveScores || {};
  box.innerHTML = REVIEW_SCORE_FIELDS.map(([key, label]) => {
    const score = scores[key]?.score;
    const isIgnored = ignored.has(key);
    const options = [0, 1, 2, 3, 4, 5]
      .map(
        (n) => `
          <label class="review-score-option">
            <input
              type="radio"
              name="review-score-${key}"
              value="${n}"
              ${Number(score) === n && !isIgnored ? "checked" : ""}
              ${isIgnored ? "disabled" : ""}
            />
            <span>${n}</span>
          </label>`
      )
      .join("");
    return `
      <div class="review-score-row" data-review-field="${key}">
        <div>
          <strong>${escapeHtml(label)}</strong>
          <div class="review-score-scale">${options}</div>
        </div>
        <label class="review-unknown">
          <input type="checkbox" class="review-unknown-input" ${isIgnored ? "checked" : ""} />
          Jeg ved ikke / kan ikke huske det
        </label>
      </div>`;
  }).join("");

  box.querySelectorAll(".review-unknown-input").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".review-score-row");
      row?.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.disabled = input.checked;
        if (input.checked) radio.checked = false;
      });
      updateReviewLearningSummary();
    });
  });
  box.querySelectorAll('input[type="radio"]').forEach((input) => {
    input.addEventListener("change", updateReviewLearningSummary);
  });
}

function updateReviewLearningSummary() {
  const rows = [...document.querySelectorAll(".review-score-row")];
  const ignored = rows.filter((row) => row.querySelector(".review-unknown-input")?.checked)
    .length;
  const scored = rows.filter((row) => row.querySelector('input[type="radio"]:checked'))
    .length;
  const summary = document.getElementById("review-learning-summary");
  if (summary) {
    summary.textContent = `${scored} subjektive felter tæller med. ${ignored} felter er markeret som "kan ikke huske" og bliver ikke brugt til statistik eller læring.`;
  }
}

function renderTineReviews() {
  const form = document.getElementById("tine-review-form");
  if (!form) return;
  const books = getReviewBooks();
  const empty = document.getElementById("review-empty");
  const title = document.getElementById("review-title");
  const author = document.getElementById("review-author");
  const position = document.getElementById("review-position");
  const status = document.getElementById("review-book-status");

  if (!books.length) {
    form.hidden = true;
    if (empty) empty.hidden = false;
    if (title) title.textContent = "Ingen tidligere læste bøger klar endnu";
    if (author) author.textContent = "";
    if (position) position.textContent = "Bog 0 af 0";
    if (status) status.textContent = "";
    return;
  }

  form.hidden = false;
  if (empty) empty.hidden = true;
  reviewIndex = Math.max(0, Math.min(reviewIndex, books.length - 1));
  const book = books[reviewIndex];
  const saved = findTineReview(book);

  if (title) title.textContent = book["Seriens navn"] || book["Første bog/titel"] || "Ukendt bog";
  if (author) author.textContent = book.Forfatter || "Ukendt forfatter";
  if (position) position.textContent = `Bog ${reviewIndex + 1} af ${books.length}`;
  if (status) status.textContent = book.Status || "";

  document.getElementById("review-overall-score").value = saved?.overallScore ?? "";
  document.getElementById("review-comment").value = saved?.comment || "";
  renderReviewScoreFields(saved);
  renderReviewTagList("review-positive-tags", REVIEW_POSITIVE_TAGS, saved?.positives || []);
  renderReviewTagList("review-negative-tags", REVIEW_NEGATIVE_TAGS, saved?.negatives || []);
  updateReviewLearningSummary();
}

async function loadTineReviews() {
  const data = await getTineReviews();
  tineReviews = data.reviews || [];
  renderTineReviews();
}

function collectCheckedValues(selector) {
  return [...document.querySelectorAll(`${selector} input:checked`)].map(
    (input) => input.value
  );
}

function collectReviewPayload() {
  const books = getReviewBooks();
  const book = books[reviewIndex];
  if (!book) return null;
  const subjectiveScores = {};
  const ignoredFields = [];
  for (const [key, label] of REVIEW_SCORE_FIELDS) {
    const row = document.querySelector(`[data-review-field="${key}"]`);
    if (!row) continue;
    if (row.querySelector(".review-unknown-input")?.checked) {
      ignoredFields.push(key);
      continue;
    }
    const selected = row.querySelector('input[type="radio"]:checked');
    if (selected) {
      subjectiveScores[key] = {
        label,
        score: Number(selected.value),
      };
    }
  }
  const overallRaw = document.getElementById("review-overall-score")?.value;
  return {
    seriesName: book["Seriens navn"] || null,
    firstBookTitle: book["Første bog/titel"] || null,
    author: book.Forfatter || null,
    status: book.Status || null,
    overallScore: overallRaw === "" ? null : Number(overallRaw),
    comment: document.getElementById("review-comment")?.value?.trim() || "",
    subjectiveScores,
    positives: collectCheckedValues("#review-positive-tags"),
    negatives: collectCheckedValues("#review-negative-tags"),
    ignoredFields,
  };
}

async function saveCurrentTineReview() {
  const payload = collectReviewPayload();
  if (!payload) return;
  if (
    payload.overallScore != null &&
    (Number.isNaN(payload.overallScore) ||
      payload.overallScore < 0 ||
      payload.overallScore > 100)
  ) {
    setMsg("review-status", "Tines score skal være mellem 0 og 100", true);
    return;
  }
  const res = await saveTineReview(payload);
  tineReviews = res.reviews || [];
  setMsg(
    "review-status",
    "Anmeldelsen er gemt. Felter markeret som 'kan ikke huske' tæller ikke med."
  );
  const books = getReviewBooks();
  if (reviewIndex < books.length - 1) reviewIndex += 1;
  renderTineReviews();
}

function setupTineReviews() {
  document.getElementById("tine-review-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await saveCurrentTineReview();
    } catch (err) {
      setMsg("review-status", err.message, true);
    }
  });
  document.getElementById("review-prev")?.addEventListener("click", () => {
    reviewIndex = Math.max(0, reviewIndex - 1);
    renderTineReviews();
  });
  document.getElementById("review-next")?.addEventListener("click", () => {
    const books = getReviewBooks();
    reviewIndex = Math.min(Math.max(books.length - 1, 0), reviewIndex + 1);
    renderTineReviews();
  });
  document.getElementById("review-skip")?.addEventListener("click", () => {
    const books = getReviewBooks();
    if (books.length) reviewIndex = (reviewIndex + 1) % books.length;
    renderTineReviews();
    setMsg("review-status", "Sprunget over");
  });
}

function closeMenus(except = null) {
  document.querySelectorAll(".corner-menu").forEach((menu) => {
    if (except && menu === except) return;
    menu.classList.remove("open");
    const panel = menu.querySelector(".corner-panel");
    const trigger = menu.querySelector(".corner-trigger");
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  });
}

function setupCornerMenus() {
  document.querySelectorAll(".corner-menu").forEach((menu) => {
    const trigger = menu.querySelector(".corner-trigger");
    const panel = menu.querySelector(".corner-panel");
    if (!trigger || !panel) return;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = panel.hidden;
      closeMenus(willOpen ? menu : null);
      panel.hidden = !willOpen;
      menu.classList.toggle("open", willOpen);
      trigger.setAttribute("aria-expanded", String(willOpen));
    });
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".corner-menu")) return;
    closeMenus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });
}

async function runAnalyze(payload) {
  const btn = document.getElementById("analyze-btn");
  btn.disabled = true;
  hideCandidates();
  startStepAnimation();
  setMsg("analyze-status", "");
  pendingAnalyze = payload;

  try {
    const res = await analyzeSeries(payload);
    if (res.needsChoice) {
      hideSteps();
      showCandidates(res.candidates || [], payload);
      setMsg("analyze-status", res.userMessage || "Vælg den rigtige bog");
      return;
    }
    showSteps(ANALYZE_STEPS.length - 1);
    series = res.series;
    paintList();
    renderDetail(res.row);
    const msg =
      res.meta?.userMessage ||
      `Tilføjet: ${res.row["Seriens navn"]}${
        res.row["Tine-score"] != null ? ` · Tine-score ${res.row["Tine-score"]}` : ""
      }`;
    setMsg("analyze-status", msg, Boolean(res.meta?.fallback));
    document.getElementById("query").value = "";
    document.getElementById("author").value = "";
    document.getElementById("link").value = "";
    hideCandidates();
  } catch (err) {
    setMsg("analyze-status", err.message, true);
  } finally {
    hideSteps();
    btn.disabled = false;
    pendingAnalyze = null;
  }
}

function setView(view) {
  const panels = document.querySelectorAll("[data-view-panel]");
  const buttons = document.querySelectorAll(".app-nav-btn");
  panels.forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  buttons.forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("is-active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (view !== "library") closeMenus();
  if (view === "discovery") {
    loadDiscovery().catch((err) =>
      setDiscoveryStatus(err.message || "Kunne ikke hente discovery", true)
    );
  }
  if (view === "reviews") {
    renderTineReviews();
  }
  try {
    sessionStorage.setItem("trl-view", view);
  } catch {
    /* ignore */
  }
}

function setupViews() {
  document.querySelectorAll(".app-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
  document.getElementById("goto-library")?.addEventListener("click", () => {
    setView("library");
  });
  let start = "home";
  try {
    const saved = sessionStorage.getItem("trl-view");
    if (
      saved === "home" ||
      saved === "library" ||
      saved === "discovery" ||
      saved === "reviews"
    ) {
      start = saved;
    }
  } catch {
    /* ignore */
  }
  setView(start);
}

async function loadDiscovery({ keepStatus = false } = {}) {
  const data = await getDiscoveryList(false);
  setDiscoveryMeta({
    lastRun: data.lastRun,
    fromCache: data.fromCache,
    pirateReads: data.pirateReads,
    readingProfile: data.readingProfile,
  });
  renderDiscoveryList(data.candidates || [], {
    onTeaser: showDiscoveredTeaser,
    onIgnore: ignoreDiscoveredBook,
  });
  if (!keepStatus && !(data.candidates || []).length) {
    setDiscoveryStatus("");
  }
}

async function showDiscoveredTeaser(book) {
  setDiscoveryStatus(`Henter teaser for «${book.title}»…`);
  try {
    // Genbrug kun friske teasers (schema v2 med match-parametre)
    if (isFreshTeaser(book.teaser)) {
      showTeaserPanel(book, book.teaser);
      setDiscoveryStatus("");
      return;
    }
    const res = await fetchDiscoveryTeaser(book);
    const enriched = { ...book, ...(res.candidate || {}), searchUrl: book.searchUrl || res.candidate?.searchUrl };
    showTeaserPanel(enriched, res.teaser);
    setDiscoveryStatus(res.cached ? "Teaser (fra cache)" : "Teaser klar");
    await loadDiscovery({ keepStatus: true });
  } catch (err) {
    setDiscoveryStatus(err.message, true);
  }
}

async function ignoreDiscoveredBook(book) {
  try {
    await ignoreDiscovered(book.title, book.author);
    hideTeaserPanel();
    setDiscoveryStatus(`Ignoreret: ${book.title}`);
    await loadDiscovery({ keepStatus: true });
  } catch (err) {
    setDiscoveryStatus(err.message, true);
  }
}

function setupDiscovery() {
  document.getElementById("discovery-run")?.addEventListener("click", async () => {
    const btn = document.getElementById("discovery-run");
    if (btn) btn.disabled = true;
    setDiscoveryStatus("Kører discovery-søgning… kan tage et par minutter");
    try {
      const res = await apiRunDiscovery(false);
      setDiscoveryStatus(
        `Fandt ${res.newCount ?? 0} nye kandidater (${res.candidateCount ?? 0} i alt)`
      );
      await loadDiscovery({ keepStatus: true });
    } catch (err) {
      setDiscoveryStatus(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("teaser-close")?.addEventListener("click", () => {
    hideTeaserPanel();
  });
}

async function init() {
  setupViews();
  setupDiscovery();
  setupTineReviews();

  try {
    const health = await getHealth();
    const text = health.ready
      ? "Klar til analyse"
      : "Analyse ikke klar endnu";
    const healthEl = document.getElementById("health-line");
    const healthHome = document.getElementById("health-line-home");
    if (healthEl) healthEl.textContent = text;
    if (healthHome) healthHome.textContent = text;
  } catch {
    const fail = "Serveren svarer ikke endnu";
    const healthEl = document.getElementById("health-line");
    const healthHome = document.getElementById("health-line-home");
    if (healthEl) healthEl.textContent = fail;
    if (healthHome) healthHome.textContent = fail;
  }

  setupCornerMenus();
  await refresh();
  await loadTineReviews();

  document.getElementById("close-detail").addEventListener("click", () => {
    renderDetail(null);
  });

  document.getElementById("delete-detail").addEventListener("click", () => {
    const name = document.getElementById("detail")?.dataset.seriesName;
    onDelete(name);
  });

  document
    .getElementById("reanalyze-detail")
    .addEventListener("click", async () => {
      const name = document.getElementById("detail")?.dataset.seriesName;
      const btn = document.getElementById("reanalyze-detail");
      if (!name) return;
      if (!requireLibraryCode()) {
        setMsg("reanalyze-status", "Låst - forkert kode", true);
        return;
      }
      btn.disabled = true;
      setMsg("reanalyze-status", "Genanalyserer efter håndbogen…");
      try {
        const res = await reanalyzeSeries(name);
        series = res.series;
        paintList();
        renderDetail(res.row);
        setMsg(
          "reanalyze-status",
          res.meta?.userMessage ||
            res.meta?.note ||
            (res.meta?.reused
              ? "Ingen ændringer — eksisterende analyse genbrugt"
              : "Opdateret"),
          Boolean(res.meta?.fallback)
        );
      } catch (err) {
        setMsg("reanalyze-status", err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

  document
    .getElementById("refresh-detail")
    ?.addEventListener("click", async () => {
      const name = document.getElementById("detail")?.dataset.seriesName;
      const btn = document.getElementById("refresh-detail");
      if (!name) return;
      if (!requireLibraryCode()) {
        setMsg("reanalyze-status", "Låst - forkert kode", true);
        return;
      }
      btn.disabled = true;
      setMsg(
        "reanalyze-status",
        "Opdaterer oplysninger fra nettet… kan tage et øjeblik"
      );
      try {
        const res = await refreshSeries(name);
        series = res.series;
        paintList();
        renderDetail(res.row);
        setMsg(
          "reanalyze-status",
          res.meta?.userMessage || "Oplysninger opdateret",
          Boolean(res.meta?.fallback)
        );
      } catch (err) {
        setMsg("reanalyze-status", err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

  document
    .getElementById("save-own-assessment")
    .addEventListener("click", saveOwnAssessment);

  document
    .getElementById("analyze-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = document.getElementById("query").value.trim();
      const author = document.getElementById("author").value.trim();
      const link = document.getElementById("link").value.trim();
      const status = document.getElementById("status").value;
      if (!query && !link) {
        setMsg("analyze-status", "Skriv et serienavn eller indsæt et link", true);
        return;
      }
      await runAnalyze({ query, author, link, status });
    });

  document.getElementById("export-btn").addEventListener("click", () => {
    exportExcel();
    setMsg("io-status", "Downloader Excel…");
  });

  document
    .getElementById("import-file")
    .addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const merge = document.getElementById("merge-import").checked;
      setMsg("io-status", "Importerer…");
      try {
        const res = await importExcel(file, merge);
        series = res.series;
        paintList();
        setMsg("io-status", `Importerede ${res.count} serier`);
      } catch (err) {
        setMsg("io-status", err.message, true);
      } finally {
        e.target.value = "";
      }
    });
}

init();
