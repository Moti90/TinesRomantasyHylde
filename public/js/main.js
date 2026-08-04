import {
  getHealth,
  getSeries,
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
    if (saved === "home" || saved === "library" || saved === "discovery") {
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
