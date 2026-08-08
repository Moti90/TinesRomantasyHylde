import {
  getHealth,
  getSeries,
  getTineReviewSummary,
  getTineReviews,
  identifyTineReviewTarget,
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
let activeReviewTarget = null;
let pendingReviewTarget = null;
let activeReviewTab = "overview";
let reviewSummaryRequest = 0;
const reviewSummaries = new Map();
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

/** Samme scorefelter som biblioteket — nøgler matcher columns.json 1:1 */
const REVIEW_SCORE_FIELDS = [
  ["Rhysand-faktoren", "Rhysand-faktoren", "Hvor respektfuld, loyal, kompetent og støttende var den centrale mandlige karakter?", 5],
  ["Beskyttende helt(e) (0-5)", "Beskyttende helt(e)", "Hvor meget beskyttede han hende med omsorg uden at kontrollere hendes valg?", 5],
  ["Bodyguard-vibe (0-5)", "Bodyguard-vibe", "Hvor meget havde relationen følelsen af, at han passede på hende og skabte tryghed?", 5],
  ["Touch her and die-vibe (0-5)", "Touch her and die-vibe", "Hvor tydeligt og intenst reagerede han, når hun blev truet eller såret?", 5],
  ["Kvindelig udvikling (0-5)", "Kvindelig udvikling", "Hvor tydeligt voksede heltinden i styrke, selvstændighed, magt eller lederskab?", 5],
  ["Karakterudvikling (0-5)", "Karakterudvikling", "Hvor stærk var den samlede karakterudvikling?", 5],
  ["Worldbuilding (0-5)", "Worldbuilding", "Hvor levende, sammenhængende og spændende oplevede du fantasyverdenen?", 5],
  ["Episk plot (0-5)", "Episk plot", "Hvor stort og betydningsfuldt var plottet for riger, folk, krig eller verdens skæbne?", 5],
  ["Politiske intriger (0-5)", "Politiske intriger", "Hvor meget politisk spil, hofintriger eller magtkampe var der?", 5],
  ["Krig/militær (0-5)", "Krig/militær", "Hvor central var krig, militær eller væbnet konflikt?", 5],
  ["Spice/erotik (0-5)", "Spice/erotik", "Hvor meget erotik var der i læseoplevelsen?", 5],
  ["Spice/erotik kvalitet (0-5)", "Spice/erotik kvalitet", "Hvor godt understøttede de intime scener romance, kemi, karakterer og plot?", 5],
  ["Book hangover (0-5)", "Book hangover", "Hvor meget savnede du bogen, karaktererne eller universet efter læsningen?", 5],
  ["Romance i fokus (0-100%)", "Romance i fokus", "Hvor stor en del af oplevelsen var romance og kemi?", 100],
  ["Hvor hurtigt griber den? (0-100%)", "Hvor hurtigt griber den?", "Hvor hurtigt blev du fanget af historien?", 100],
];

const REVIEW_CHOICE_FIELDS = [
  ["Bully-risiko", "Bully-risiko", "Var der nedladende, ydmygende eller manipulerende adfærd i romantikken?", ["Lav", "Mellem", "Høj"]],
  ["Tempo", "Tempo", "Hvordan oplevede du tempoet?", ["Langsomt", "Moderat", "Hurtigt"]],
  ["Romance sekundær eller central?", "Romance central eller sekundær", "Var romancen central eller sekundær?", ["Central", "Sekundær", "Balanceret"]],
  ["Happy ending?", "Happy ending?", "Fik den et happy ending?", ["Ja", "Nej", "Overvejende ja", "Ukendt"]],
  ["Tilfredsstillende slutning?", "Tilfredsstillende slutning?", "Føltes slutningen tilfredsstillende?", ["Ja", "Nej", "Delvist"]],
  ["Falder kvaliteten?", "Falder kvaliteten?", "Faldt kvaliteten senere i serien?", ["Ja", "Nej"]],
  ["Permanente dødsfald blandt hovedpersonerne?", "Permanente dødsfald", "Dør hovedpersoner permanent?", ["Ja", "Nej"]],
  ["FemDom (ja/nej)", "FemDom", "Var der FemDom?", ["Ja", "Nej"]],
  ["Chosen one eller vokser naturligt ind i rollen?", "Chosen one / naturlig vækst", "Var hun chosen one, eller voksede hun naturligt ind i rollen?", ["Chosen one", "Vokser naturligt ind i rollen", "Begge / blandet"]],
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
          goodreadsUrl: c.goodreadsUrl || null,
          source: c.source === "Goodreads" ? "piratereads" : c.source || null,
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

function updateHomeStats(discoveryCount = null) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };
  const total = series.length;
  const analyzed = series.filter((row) => {
    const m = row.Indholdsmatch ?? row["Tine-score"] ?? row["Tines score"];
    return m != null && m !== "";
  }).length;
  const favorites = series.filter((row) => {
    const m = Number(row.Indholdsmatch ?? row["Tine-score"] ?? 0);
    return m >= 90;
  }).length;
  set("stat-series", total);
  set("stat-analyzed", analyzed);
  set("stat-favorites", favorites);
  if (discoveryCount != null) set("stat-discovery", discoveryCount);
}

async function refresh() {
  const data = await getSeries();
  series = data.series || [];
  paintList();
  updateHomeStats();
  if (activeReviewTarget) renderActiveTineReview();
}

function reviewBookKey(book) {
  if (book?.sourceBookId) return String(book.sourceBookId).trim().toLowerCase();
  return [book?.seriesName, book?.firstBookTitle, book?.author]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

function reviewDataKey(review) {
  if (review?.sourceBookId) {
    return String(review.sourceBookId).trim().toLowerCase();
  }
  return [review?.seriesName || review?.firstBookTitle, review?.author]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
}

function findTineReview(book) {
  if (!book) return null;
  const key = reviewBookKey(book);
  const seriesKey = [book.seriesName || book.firstBookTitle, book.author]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
  return (
    tineReviews.find((review) => reviewDataKey(review) === key) ||
    tineReviews.find((review) => {
      const other = [review.seriesName || review.firstBookTitle, review.author]
        .map((part) => String(part || "").trim().toLowerCase())
        .join("|");
      return other === seriesKey;
    }) ||
    null
  );
}

function hideReviewCandidates() {
  const box = document.getElementById("review-candidate-pick");
  if (!box) return;
  box.hidden = true;
  box.innerHTML = "";
}

function showReviewCandidates(candidates, basePayload) {
  const box = document.getElementById("review-candidate-pick");
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `
    <p class="hint">Flere matches. Vælg den rigtige:</p>
    <ul class="candidate-list">
      ${candidates
        .map(
          (c, i) => `
        <li>
          <button type="button" class="btn ghost candidate-btn" data-idx="${i}">
            <strong>${escapeHtml(
              c.series ? `Serie: ${c.series}` : c.title || "?"
            )}</strong>
            <span>${escapeHtml(c.author || "Ukendt forfatter")}${
              c.series && c.title ? ` · bog: ${escapeHtml(c.title)}` : ""
            }${c.year ? ` · ${c.year}` : ""}</span>
          </button>
        </li>`
        )
        .join("")}
    </ul>`;

  box.querySelectorAll(".candidate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const c = candidates[Number(btn.dataset.idx)];
      hideReviewCandidates();
      await runReviewIdentify({
        ...basePayload,
        selectedIdentity: {
          title: c.title,
          author: c.author,
          series: c.series || null,
          bookNumber: c.bookNumber ?? null,
          goodreadsUrl: c.goodreadsUrl || null,
          source: c.source === "Goodreads" ? "piratereads" : c.source || null,
          identityConfidence: c.identityConfidence || "high",
        },
      });
    });
  });
}

function resetReviewSearchUi() {
  hideReviewCandidates();
  pendingReviewTarget = null;
  activeReviewTarget = null;
  const confirm = document.getElementById("review-confirm");
  const active = document.getElementById("review-active");
  const empty = document.getElementById("review-empty");
  if (confirm) confirm.hidden = true;
  if (active) active.hidden = true;
  if (empty) empty.hidden = false;
  reviewSummaryRequest += 1;
  resetReviewSummary();
}

function showReviewConfirm(target, existingReview = null) {
  pendingReviewTarget = target;
  activeReviewTarget = null;
  const confirm = document.getElementById("review-confirm");
  const active = document.getElementById("review-active");
  const empty = document.getElementById("review-empty");
  if (empty) empty.hidden = true;
  if (active) active.hidden = true;
  if (!confirm) return;
  confirm.hidden = false;
  const kind = document.getElementById("review-confirm-kind");
  const title = document.getElementById("review-confirm-title");
  const meta = document.getElementById("review-confirm-meta");
  const note = document.getElementById("review-confirm-note");
  if (kind) {
    kind.textContent = target.isSeries ? "Serie fundet" : "Standalone-bog fundet";
  }
  if (title) {
    title.textContent = target.displayTitle || target.seriesName || "Ukendt";
  }
  if (meta) {
    const bits = [
      target.author || "Ukendt forfatter",
      target.isSeries
        ? `Startbog/fundet titel: ${target.firstBookTitle || "–"}`
        : null,
      target.bookNumber != null ? `Bog nr. ${target.bookNumber}` : null,
    ].filter(Boolean);
    meta.textContent = bits.join(" · ");
  }
  if (note) {
    note.textContent = existingReview
      ? "Du har allerede en anmeldelse her — den åbnes, så du kan rette eller udfylde mere."
      : target.isSeries
        ? "Bekræft, at det er den rigtige serie, før anmeldelsen åbnes."
        : "Bekræft, at det er den rigtige bog, før anmeldelsen åbnes.";
  }
}

async function runReviewIdentify(payload) {
  const btn = document.getElementById("review-search-btn");
  if (btn) btn.disabled = true;
  setMsg("review-status", "Søger…");
  try {
    const res = await identifyTineReviewTarget(payload);
    if (res.needsChoice) {
      showReviewCandidates(res.candidates || [], payload);
      setMsg("review-status", res.userMessage || "Vælg den rigtige bog");
      return;
    }
    hideReviewCandidates();
    showReviewConfirm(res.target, res.existingReview || null);
    setMsg("review-status", res.userMessage || "Bekræft match");
  } catch (err) {
    setMsg("review-status", err.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function setReviewTab(tabName) {
  activeReviewTab = ["overview", "scores", "tags"].includes(tabName)
    ? tabName
    : "overview";
  document.querySelectorAll("[data-review-tab]").forEach((button) => {
    const active = button.dataset.reviewTab === activeReviewTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-review-tab-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.reviewTabPanel !== activeReviewTab;
  });
}

function showReviewSummary(summary, cached = false) {
  const loading = document.getElementById("review-summary-loading");
  const text = document.getElementById("review-summary-short");
  const note = document.getElementById("review-summary-note");
  const spoilers = document.getElementById("review-spoilers");
  const points = document.getElementById("review-spoiler-points");
  const source = document.getElementById("review-summary-source");
  if (loading) loading.hidden = true;
  if (text) {
    text.textContent = summary.shortSummary || "";
    text.hidden = !summary.shortSummary;
  }
  if (note) {
    note.textContent = summary.note || "";
    note.hidden = !summary.note;
  }
  if (points) {
    points.innerHTML = (summary.spoilerPoints || [])
      .map((point) => `<li>${escapeHtml(point)}</li>`)
      .join("");
  }
  if (spoilers) {
    spoilers.hidden = !(summary.spoilerPoints || []).length;
    spoilers.open = false;
  }
  if (source) {
    source.textContent = cached ? "AI-resumé · gemt" : "AI-genereret";
  }
}

function resetReviewSummary() {
  const loading = document.getElementById("review-summary-loading");
  const text = document.getElementById("review-summary-short");
  const note = document.getElementById("review-summary-note");
  const spoilers = document.getElementById("review-spoilers");
  const points = document.getElementById("review-spoiler-points");
  const source = document.getElementById("review-summary-source");
  if (loading) {
    loading.textContent = "Henter et kort resumé…";
    loading.hidden = false;
  }
  if (text) {
    text.textContent = "";
    text.hidden = true;
  }
  if (note) {
    note.textContent = "";
    note.hidden = true;
  }
  if (spoilers) {
    spoilers.hidden = true;
    spoilers.open = false;
  }
  if (points) points.innerHTML = "";
  if (source) source.textContent = "AI-genereret";
}

async function loadReviewSummary(book) {
  const key = reviewBookKey(book);
  const request = ++reviewSummaryRequest;
  resetReviewSummary();
  if (reviewSummaries.has(key)) {
    showReviewSummary(reviewSummaries.get(key), true);
    return;
  }
  try {
    const data = await getTineReviewSummary(book);
    if (request !== reviewSummaryRequest) return;
    if (!activeReviewTarget || reviewBookKey(activeReviewTarget) !== key) return;
    reviewSummaries.set(key, data.summary);
    showReviewSummary(data.summary, data.cached);
  } catch (err) {
    if (request !== reviewSummaryRequest) return;
    const loading = document.getElementById("review-summary-loading");
    if (loading) {
      loading.textContent = `Resuméet kunne ikke hentes: ${err.message}`;
      loading.hidden = false;
    }
  }
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

function bindReviewUnknownToggle(box) {
  box.querySelectorAll(".review-unknown-input").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest(".review-score-row");
      row?.querySelectorAll('input[type="radio"], input[type="number"]').forEach(
        (field) => {
          field.disabled = input.checked;
          if (input.checked) {
            if (field.type === "radio") field.checked = false;
            if (field.type === "number") field.value = "";
          }
        }
      );
      updateReviewLearningSummary();
    });
  });
  box
    .querySelectorAll('input[type="radio"], input[type="number"]')
    .forEach((input) => {
      input.addEventListener("change", updateReviewLearningSummary);
      input.addEventListener("input", updateReviewLearningSummary);
    });
}

function renderReviewScoreFields(saved = null) {
  const box = document.getElementById("review-score-fields");
  if (!box) return;
  const ignored = new Set(saved?.ignoredFields || []);
  const scores = saved?.subjectiveScores || {};

  const numericHtml = REVIEW_SCORE_FIELDS.map(([key, label, helpText, max]) => {
    const score = scores[key]?.score;
    const isIgnored = ignored.has(key);
    if (max === 100) {
      return `
        <div class="review-score-row" data-review-field="${escapeHtml(key)}" data-field-type="percent">
          <div>
            <strong>${escapeHtml(label)}</strong>
            <p class="review-field-help">${escapeHtml(helpText)}</p>
            <input
              class="review-pct-input"
              type="number"
              min="0"
              max="100"
              step="5"
              placeholder="0-100"
              value="${score != null && !isIgnored ? escapeHtml(String(score)) : ""}"
              ${isIgnored ? "disabled" : ""}
            />
          </div>
          <label class="review-unknown">
            <input type="checkbox" class="review-unknown-input" ${isIgnored ? "checked" : ""} />
            Jeg ved ikke / kan ikke huske det
          </label>
        </div>`;
    }
    const options = [0, 1, 2, 3, 4, 5]
      .map(
        (n) => `
          <label class="review-score-option">
            <input
              type="radio"
              name="review-score-${escapeHtml(key)}"
              value="${n}"
              ${Number(score) === n && !isIgnored ? "checked" : ""}
              ${isIgnored ? "disabled" : ""}
            />
            <span>${n}</span>
          </label>`
      )
      .join("");
    return `
      <div class="review-score-row" data-review-field="${escapeHtml(key)}" data-field-type="scale">
        <div>
          <strong>${escapeHtml(label)}</strong>
          <p class="review-field-help">${escapeHtml(helpText)}</p>
          <div class="review-score-scale">${options}</div>
        </div>
        <label class="review-unknown">
          <input type="checkbox" class="review-unknown-input" ${isIgnored ? "checked" : ""} />
          Jeg ved ikke / kan ikke huske det
        </label>
      </div>`;
  }).join("");

  const choiceHtml = REVIEW_CHOICE_FIELDS.map(([key, label, helpText, options]) => {
    const value = scores[key]?.value;
    const isIgnored = ignored.has(key);
    const opts = options
      .map(
        (option) => `
          <label>
            <input
              type="radio"
              name="review-choice-${escapeHtml(key)}"
              value="${escapeHtml(option)}"
              ${value === option && !isIgnored ? "checked" : ""}
              ${isIgnored ? "disabled" : ""}
            />
            <span>${escapeHtml(option)}</span>
          </label>`
      )
      .join("");
    return `
      <div class="review-score-row" data-review-field="${escapeHtml(key)}" data-field-type="choice">
        <div>
          <strong>${escapeHtml(label)}</strong>
          <p class="review-field-help">${escapeHtml(helpText)}</p>
          <div class="review-choice-options">${opts}</div>
        </div>
        <label class="review-unknown">
          <input type="checkbox" class="review-unknown-input" ${isIgnored ? "checked" : ""} />
          Jeg ved ikke / kan ikke huske det
        </label>
      </div>`;
  }).join("");

  box.innerHTML = numericHtml + choiceHtml;
  bindReviewUnknownToggle(box);
}

function updateReviewLearningSummary() {
  const rows = [...document.querySelectorAll(".review-score-row")];
  const ignored = rows.filter((row) =>
    row.querySelector(".review-unknown-input")?.checked
  ).length;
  const scored = rows.filter((row) => {
    if (row.querySelector(".review-unknown-input")?.checked) return false;
    if (row.dataset.fieldType === "percent") {
      return row.querySelector('input[type="number"]')?.value !== "";
    }
    return Boolean(row.querySelector('input[type="radio"]:checked'));
  }).length;
  const summary = document.getElementById("review-learning-summary");
  if (summary) {
    summary.textContent = `${scored} felter tæller med. ${ignored} felter er markeret som "kan ikke huske" og bliver ikke brugt til statistik eller læring.`;
  }
}

function openConfirmedReview(target) {
  activeReviewTarget = target;
  pendingReviewTarget = null;
  const confirm = document.getElementById("review-confirm");
  const active = document.getElementById("review-active");
  const empty = document.getElementById("review-empty");
  if (confirm) confirm.hidden = true;
  if (empty) empty.hidden = true;
  if (active) active.hidden = false;
  renderActiveTineReview();
}

function renderActiveTineReview() {
  const form = document.getElementById("tine-review-form");
  if (!form || !activeReviewTarget) return;
  const book = activeReviewTarget;
  const saved = findTineReview(book);
  const title = document.getElementById("review-title");
  const author = document.getElementById("review-author");
  const position = document.getElementById("review-position");
  const status = document.getElementById("review-book-status");

  if (title) {
    title.textContent =
      book.displayTitle || book.seriesName || book.firstBookTitle || "Ukendt";
  }
  if (author) author.textContent = book.author || "Ukendt forfatter";
  if (position) {
    position.textContent = book.isSeries
      ? "Anmelder som serie"
      : "Anmelder som standalone";
  }
  if (status) {
    status.textContent = saved ? "Tidligere anmeldt" : "Ny anmeldelse";
  }

  document.getElementById("review-overall-score").value =
    saved?.overallScore ?? "";
  document.querySelectorAll('input[name="review-reread"]').forEach((input) => {
    input.checked = input.value === saved?.rereadChoice;
  });
  document.getElementById("review-comment").value = saved?.comment || "";
  renderReviewScoreFields(saved);
  renderReviewTagList(
    "review-positive-tags",
    REVIEW_POSITIVE_TAGS,
    saved?.positives || []
  );
  renderReviewTagList(
    "review-negative-tags",
    REVIEW_NEGATIVE_TAGS,
    saved?.negatives || []
  );
  updateReviewLearningSummary();
  setReviewTab("overview");
  loadReviewSummary(book);
}

async function loadTineReviews() {
  try {
    const reviewData = await getTineReviews();
    tineReviews = reviewData.reviews || [];
    if (activeReviewTarget) renderActiveTineReview();
  } catch (err) {
    setMsg("review-status", err.message, true);
  }
}

function collectCheckedValues(selector) {
  return [...document.querySelectorAll(`${selector} input:checked`)].map(
    (input) => input.value
  );
}

function findReviewFieldRow(key) {
  return [...document.querySelectorAll(".review-score-row")].find(
    (row) => row.dataset.reviewField === key
  );
}

function collectReviewPayload() {
  const book = activeReviewTarget;
  if (!book) return null;
  const subjectiveScores = {};
  const ignoredFields = [];

  for (const [key, label] of REVIEW_SCORE_FIELDS) {
    const row = findReviewFieldRow(key);
    if (!row) continue;
    if (row.querySelector(".review-unknown-input")?.checked) {
      ignoredFields.push(key);
      continue;
    }
    if (row.dataset.fieldType === "percent") {
      const raw = row.querySelector('input[type="number"]')?.value;
      if (raw !== "" && raw != null) {
        subjectiveScores[key] = { label, score: Number(raw) };
      }
      continue;
    }
    const selected = row.querySelector('input[type="radio"]:checked');
    if (selected) {
      subjectiveScores[key] = { label, score: Number(selected.value) };
    }
  }

  for (const [key, label] of REVIEW_CHOICE_FIELDS) {
    const row = findReviewFieldRow(key);
    if (!row) continue;
    if (row.querySelector(".review-unknown-input")?.checked) {
      ignoredFields.push(key);
      continue;
    }
    const selected = row.querySelector('input[type="radio"]:checked');
    if (selected) {
      subjectiveScores[key] = { label, value: selected.value };
    }
  }

  const overallRaw = document.getElementById("review-overall-score")?.value;
  return {
    seriesName: book.seriesName || book.firstBookTitle || null,
    firstBookTitle: book.firstBookTitle || null,
    author: book.author || null,
    status: "Læst",
    isSeries: Boolean(book.isSeries),
    sourceBookId: book.sourceBookId || null,
    source: book.source || "identity",
    identity: book.identity || null,
    goodreadsUrl: book.goodreadsUrl || null,
    overallScore: overallRaw === "" ? null : Number(overallRaw),
    rereadChoice:
      document.querySelector('input[name="review-reread"]:checked')?.value ||
      null,
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
  for (const [key, entry] of Object.entries(payload.subjectiveScores || {})) {
    if (entry.score == null) continue;
    const field = REVIEW_SCORE_FIELDS.find((row) => row[0] === key);
    const max = field?.[3] || 5;
    if (Number.isNaN(entry.score) || entry.score < 0 || entry.score > max) {
      setMsg("review-status", `${field?.[1] || key} skal være mellem 0 og ${max}`, true);
      return;
    }
  }
  const res = await saveTineReview(payload);
  tineReviews = res.reviews || [];
  if (Array.isArray(res.series)) {
    series = res.series;
    paintList();
  }
  setMsg(
    "review-status",
    payload.overallScore == null
      ? "Anmeldelsen er gemt, men den flyttes først til biblioteket, når Tines score er udfyldt."
      : "Anmeldelsen er gemt og lagt i biblioteket. Felter markeret som 'kan ikke huske' tæller ikke med."
  );
  renderActiveTineReview();
}

function setupTineReviews() {
  document.querySelectorAll("[data-review-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setReviewTab(button.dataset.reviewTab);
    });
  });
  document.getElementById("review-search-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = document.getElementById("review-query")?.value?.trim() || "";
    const author =
      document.getElementById("review-author-input")?.value?.trim() || "";
    if (!query && !author) {
      setMsg(
        "review-status",
        "Skriv en bogtitel, et serienavn eller en forfatter",
        true
      );
      return;
    }
    resetReviewSearchUi();
    document.getElementById("review-empty").hidden = true;
    await runReviewIdentify({ query, author });
  });
  document.getElementById("review-confirm-yes")?.addEventListener("click", () => {
    if (!pendingReviewTarget) return;
    openConfirmedReview(pendingReviewTarget);
    setMsg("review-status", "Anmeldelsen er klar");
  });
  document.getElementById("review-confirm-no")?.addEventListener("click", () => {
    resetReviewSearchUi();
    setMsg("review-status", "Søg igen");
  });
  document.getElementById("review-new-search")?.addEventListener("click", () => {
    resetReviewSearchUi();
    document.getElementById("review-query")?.focus();
    setMsg("review-status", "");
  });
  document.getElementById("tine-review-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await saveCurrentTineReview();
    } catch (err) {
      setMsg("review-status", err.message, true);
    }
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
        res.row.Indholdsmatch != null
          ? ` · Indholdsmatch ${res.row.Indholdsmatch}`
          : ""
      }${
        res.row["Læseprioritet nu"] != null
          ? ` · Læseprioritet ${res.row["Læseprioritet nu"]}`
          : ""
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
  document.body.classList.toggle("is-home-view", view === "home");
  if (view !== "library") closeMenus();
  if (view === "discovery") {
    loadDiscovery().catch((err) =>
      setDiscoveryStatus(err.message || "Kunne ikke hente discovery", true)
    );
  }
  if (view === "reviews" && activeReviewTarget) {
    renderActiveTineReview();
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
  document.getElementById("goto-discovery")?.addEventListener("click", () => {
    setView("discovery");
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
  const candidates = data.candidates || [];
  updateHomeStats(candidates.length);
  renderDiscoveryList(candidates, {
    onTeaser: showDiscoveredTeaser,
    onIgnore: ignoreDiscoveredBook,
  });
  if (!keepStatus && !candidates.length) {
    setDiscoveryStatus("");
  }
}

async function showDiscoveredTeaser(book) {
  setDiscoveryStatus(`Henter teaser for «${book.title}»…`);
  try {
    // Genbrug kun friske teasers (schema v3 med evidens/transparens)
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
    if (healthEl) healthEl.textContent = text;
  } catch {
    const fail = "Serveren svarer ikke endnu";
    const healthEl = document.getElementById("health-line");
    if (healthEl) healthEl.textContent = fail;
  }

  setupCornerMenus();
  await refresh();
  await loadTineReviews();
  getDiscoveryList(false)
    .then((data) => updateHomeStats((data.candidates || []).length))
    .catch(() => {});

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
