function scoreClass(score) {
  const n = Number(String(score).replace(/[^\d.]/g, "")) || 0;
  if (n >= 90) return "score-90";
  if (n >= 80) return "score-80";
  if (n >= 70) return "score-70";
  if (n >= 60) return "score-60";
  return "score-low";
}

const SCORE_0_5 = [
  "Book hangover (0-5)",
  "Worldbuilding (0-5)",
  "Episk plot (0-5)",
  "Politiske intriger (0-5)",
  "Krig/militær (0-5)",
  "Kvindelig udvikling (0-5)",
  "Karakterudvikling (0-5)",
  "Beskyttende helt(e) (0-5)",
  "Bodyguard-vibe (0-5)",
  "Touch her and die-vibe (0-5)",
  "Spice/erotik (0-5)",
  "Spice/erotik kvalitet (0-5)",
  "Rhysand-faktoren",
];

const SCORE_PCT = [
  "Hvor hurtigt griber den? (0-100%)",
  "Romance i fokus (0-100%)",
];

const SCORE_GROUPS = [
  {
    title: "Romance",
    keys: [
      "Romance i fokus (0-100%)",
      "Rhysand-faktoren",
      "Beskyttende helt(e) (0-5)",
      "Touch her and die-vibe (0-5)",
      "Spice/erotik (0-5)",
      "Spice/erotik kvalitet (0-5)",
    ],
  },
  {
    title: "Story",
    keys: [
      "Episk plot (0-5)",
      "Worldbuilding (0-5)",
      "Politiske intriger (0-5)",
      "Krig/militær (0-5)",
      "Hvor hurtigt griber den? (0-100%)",
    ],
  },
  {
    title: "Characters",
    keys: [
      "Karakterudvikling (0-5)",
      "Kvindelig udvikling (0-5)",
      "Book hangover (0-5)",
      "Bodyguard-vibe (0-5)",
    ],
  },
];

const HERO_SKIP = new Set([
  "Tine-score",
  "Indholdsmatch",
  "Læseprioritet nu",
  "Seriens navn",
  "Første bog/titel",
  "Forfatter",
  ...SCORE_0_5,
  ...SCORE_PCT,
]);

const FACT_GROUPS = [
  {
    title: "Serie & tilgængelighed",
    keys: [
      "Status",
      "Antal bøger i serien",
      "Lydbog (ja/nej, ikke hele serien)",
      "Er serien på Mofibo? (ja, nej, ikke hele serien)",
      "Er serien færdigskrevet",
      "Relation",
      "Tempo",
      "Goodreads-score",
    ],
  },
  {
    title: "Verden & plot",
    keys: [
      "Worldbuilding-tags",
      "Chosen one eller vokser naturligt ind i rollen?",
      "Falder kvaliteten?",
      "Happy ending?",
      "Tilfredsstillende slutning?",
      "Romance sekundær eller central?",
    ],
  },
  {
    title: "Advarsler & tone",
    keys: [
      "Bully-risiko",
      "FemDom (ja/nej)",
      "Trigger warnings",
      "Permanente dødsfald blandt hovedpersonerne?",
    ],
  },
  {
    title: "Minder om",
    keys: ["Minder mest om", "Hvis du savner..."],
  },
];

function originLabel(row) {
  if (row?._origin?.type === "tine_reviews") return "Fra Tines anmeldelser";
  if (row?._origin?.type === "excel") return "Fra Tines Excel-ark";
  return "";
}

function originBadge(row) {
  const label = originLabel(row);
  if (!label) return "";
  const cls =
    row?._origin?.type === "tine_reviews" ? "origin-review" : "origin-excel";
  return `<span class="origin-badge ${cls}">${escapeHtml(label)}</span>`;
}

const PAGE_SIZE = 20;
let listPage = 0;

function isAnalyzed(row) {
  return Boolean(
    row?._analysisMeta ||
      row?.Indholdsmatch != null ||
      row?.["Tine-score"] != null
  );
}

function scoreCircle(value, kind) {
  if (value == null || value === "") {
    return `<span class="score-circle empty" title="${kind}">–</span>`;
  }
  return `<span class="score-circle ${kind}" title="${kind}">${escapeHtml(
    String(value)
  )}</span>`;
}

function crownIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4 4 5-7 5 7 4-4v11H3V8z"/></svg>`;
}

export function renderList(series, { onOpen, onStatusChange, onDelete }) {
  const body = document.getElementById("series-body");
  const count = document.getElementById("list-count");
  const pager = document.getElementById("library-pagination");
  const pageLabel = document.getElementById("library-page-label");
  const prevBtn = document.getElementById("library-prev");
  const nextBtn = document.getElementById("library-next");
  if (!body) return;

  const total = series.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  if (listPage >= pageCount) listPage = pageCount - 1;
  if (listPage < 0) listPage = 0;
  const start = listPage * PAGE_SIZE;
  const pageRows = series.slice(start, start + PAGE_SIZE);

  if (count) {
    count.textContent = total
      ? `${total} serier${pageCount > 1 ? ` · side ${listPage + 1}/${pageCount}` : ""}`
      : "0 serier";
  }

  if (pager) {
    pager.hidden = total <= PAGE_SIZE;
    if (pageLabel) {
      pageLabel.textContent = `Viser ${total ? start + 1 : 0}–${Math.min(
        start + PAGE_SIZE,
        total
      )} af ${total}`;
    }
    if (prevBtn) prevBtn.disabled = listPage <= 0;
    if (nextBtn) nextBtn.disabled = listPage >= pageCount - 1;
  }

  body.innerHTML = pageRows
    .map((row, i) => {
      const absoluteIndex = start + i;
      const name = row["Seriens navn"] || "Ukendt";
      const contentMatch =
        row.Indholdsmatch ?? row["Tine-score"] ?? row["Tines score"] ?? null;
      const readPriority = row["Læseprioritet nu"] ?? null;
      const analyzed = isAnalyzed(row);
      const rhys = row["Rhysand-faktoren"];
      return `
      <tr data-index="${absoluteIndex}">
        <td>
          <span class="status-cell">
            <span class="status-dot ${analyzed ? "is-analyzed" : "is-pending"}"></span>
            ${analyzed ? "Analyseret" : "Afventer"}
          </span>
          <select data-status="${escapeAttr(name)}" class="row-status" aria-label="Læsestatus for ${escapeAttr(name)}">
            ${statusOptions(row.Status)}
          </select>
        </td>
        <td>
          <span class="series-name">${escapeHtml(name)}</span>
          ${originBadge(row)}
        </td>
        <td>${escapeHtml(row.Forfatter || "–")}</td>
        <td>${scoreCircle(contentMatch, "match")}</td>
        <td>${scoreCircle(readPriority, "read")}</td>
        <td>
          <span class="rhysand-cell">
            ${rhys != null && rhys !== "" ? crownIcon() : ""}
            ${escapeHtml(String(rhys ?? "–"))}
          </span>
        </td>
        <td>${escapeHtml(displayFact(row["Er serien på Mofibo? (ja, nej, ikke hele serien)"]))}</td>
        <td>${escapeHtml(displayFact(row.Tempo))}</td>
        <td class="row-actions">
          <button type="button" class="btn ghost" data-open="${absoluteIndex}">Detaljer</button>
          <div class="row-more">
            <button type="button" class="linkish" data-more="${absoluteIndex}" aria-expanded="false" aria-label="Flere handlinger">⋯</button>
            <div class="row-more-menu" data-more-menu="${absoluteIndex}" hidden>
              <button type="button" data-delete="${escapeAttr(name)}">Slet serie</button>
            </div>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  body.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onOpen(series[Number(btn.dataset.open)]);
    });
  });

  body.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onDelete?.(btn.dataset.delete);
    });
  });

  body.querySelectorAll("[data-more]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.more;
      const menu = body.querySelector(`[data-more-menu="${id}"]`);
      body.querySelectorAll("[data-more-menu]").forEach((m) => {
        if (m !== menu) m.hidden = true;
      });
      if (menu) {
        menu.hidden = !menu.hidden;
        btn.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
      }
    });
  });

  body.querySelectorAll("tr[data-index]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("select, button, .row-more-menu")) return;
      onOpen(series[Number(tr.dataset.index)]);
    });
  });

  body.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("change", () => {
      onStatusChange(sel.dataset.status, sel.value);
    });
  });

  if (prevBtn && !prevBtn.dataset.bound) {
    prevBtn.dataset.bound = "1";
    prevBtn.addEventListener("click", () => {
      listPage -= 1;
      document.dispatchEvent(new CustomEvent("library:pager"));
    });
  }
  if (nextBtn && !nextBtn.dataset.bound) {
    nextBtn.dataset.bound = "1";
    nextBtn.addEventListener("click", () => {
      listPage += 1;
      document.dispatchEvent(new CustomEvent("library:pager"));
    });
  }
}

export function resetListPage() {
  listPage = 0;
}

function coverPlaceholderHtml(name) {
  const label = String(name || "Serie").trim() || "Serie";
  return escapeHtml(label.length > 42 ? `${label.slice(0, 40)}…` : label);
}

function renderScoreGroups(row) {
  const groups = SCORE_GROUPS.map((group) => {
    const rows = group.keys
      .map((key) => {
        const isPct = key.includes("0-100");
        return barRow(
          key,
          row[key],
          isPct ? 100 : 5,
          isPct,
          row._analysisMeta?.assessments?.[key]
        );
      })
      .filter(Boolean)
      .join("");
    return `<section class="score-group"><h3>${escapeHtml(
      group.title
    )}</h3>${rows || `<p class="hint">Ingen scorer</p>`}</section>`;
  }).join("");
  return groups || `<p class="hint">Ingen scorer endnu</p>`;
}

function renderQuickMeta(row) {
  const chips = [
    ["Rhysand", row["Rhysand-faktoren"] != null ? `${row["Rhysand-faktoren"]}/5` : null],
    [
      "Mofibo",
      row["Er serien på Mofibo? (ja, nej, ikke hele serien)"],
    ],
    ["Tempo", row.Tempo],
  ]
    .map(([label, value]) => {
      if (value == null || value === "") return "";
      return `<div class="meta-chip-card"><span class="label">${escapeHtml(
        label
      )}</span><span class="value">${escapeHtml(String(value))}</span></div>`;
    })
    .filter(Boolean)
    .join("");
  return chips;
}

export function setupDetailTabs() {
  const tabs = document.querySelectorAll("[data-detail-tab]");
  tabs.forEach((tab) => {
    if (tab.dataset.bound) return;
    tab.dataset.bound = "1";
    tab.addEventListener("click", () => {
      const id = tab.dataset.detailTab;
      document.querySelectorAll("[data-detail-tab]").forEach((t) => {
        t.classList.toggle("is-active", t === tab);
      });
      document.querySelectorAll("[data-detail-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.detailPanel !== id;
      });
    });
  });
}

export function renderDetail(row) {
  const panel = document.getElementById("detail");
  const title = document.getElementById("detail-title");
  const meta = document.getElementById("detail-meta");
  const tine = document.getElementById("detail-tine");
  const scores = document.getElementById("detail-scores");
  const facts = document.getElementById("detail-facts");
  const why = document.getElementById("detail-why");
  const foundation = document.getElementById("detail-foundation");
  const quickMeta = document.getElementById("detail-quick-meta");
  const cover = document.getElementById("detail-cover");
  const own = document.getElementById("own-assessment");
  const ownScore = document.getElementById("own-score");
  const ownDisplay = document.getElementById("own-score-display");
  const ownMsg = document.getElementById("own-assessment-msg");

  if (!row) {
    panel.classList.add("hidden");
    return;
  }

  setupDetailTabs();
  panel.classList.remove("hidden");
  const seriesName = row["Seriens navn"] || "Serie";
  title.textContent = seriesName;
  meta.innerHTML = `${escapeHtml(row.Forfatter || "Ukendt forfatter")}${
    row["Første bog/titel"]
      ? ` · ${escapeHtml(row["Første bog/titel"])}`
      : ""
  } ${originBadge(row)}`;
  panel.dataset.seriesName = seriesName;
  if (cover) cover.innerHTML = coverPlaceholderHtml(seriesName);

  if (own) own.value = row["Tines egen vurdering"] || "";
  if (ownScore) {
    ownScore.value =
      row["Tines score"] == null || row["Tines score"] === ""
        ? ""
        : String(row["Tines score"]);
  }
  if (ownDisplay) {
    ownDisplay.textContent =
      row["Tines score"] == null || row["Tines score"] === ""
        ? "–"
        : `${row["Tines score"]}/100`;
  }
  if (ownMsg) {
    ownMsg.textContent = "";
    ownMsg.classList.remove("ok", "error");
  }

  const contentMatch = parseNumber(row.Indholdsmatch ?? row["Tine-score"]);
  const readPriority = parseNumber(row["Læseprioritet nu"]);
  const contentAssess =
    row._analysisMeta?.assessments?.Indholdsmatch ||
    row._analysisMeta?.assessments?.["Tine-score"];
  const priorityAssess =
    row._analysisMeta?.assessments?.["Læseprioritet nu"];
  tine.innerHTML =
    contentMatch == null && readPriority == null
      ? `<div class="tine-hero-empty hint">Ingen beslutningsscorer endnu</div>`
      : `
        ${decisionScoreCard(
          "Match",
          contentMatch,
          contentAssess,
          "Hvor godt serien passer til Tines smag."
        )}
        ${decisionScoreCard(
          "Læs nu",
          readPriority,
          priorityAssess,
          "Justeret for tilgængelighed, risici og analysegrundlag."
        )}`;

  if (quickMeta) quickMeta.innerHTML = renderQuickMeta(row);
  if (scores) scores.innerHTML = renderScoreGroups(row);

  const whyParts = renderWhySections(row);
  if (why) why.innerHTML = whyParts.why || "";
  if (foundation) foundation.innerHTML = whyParts.foundation || "";

  const skipFacts = new Set([
    ...HERO_SKIP,
    "Tines egen vurdering",
    "Tines score",
  ]);
  const used = new Set();
  const groupsHtml = FACT_GROUPS.map((group) => {
    const items = group.keys
      .filter((k) => !skipFacts.has(k))
      .map((k) => {
        used.add(k);
        return factRow(k, formatFactValue(k, row));
      })
      .join("");
    return `
      <section class="fact-group">
        <h4>${escapeHtml(group.title)}</h4>
        <dl class="fact-list">${items}</dl>
      </section>`;
  }).join("");

  const leftovers = Object.keys(row)
    .filter(
      (k) =>
        !k.startsWith("_") &&
        !skipFacts.has(k) &&
        !used.has(k) &&
        k !== "schemaVersion"
    )
    .map((k) => factRow(k, formatFactValue(k, row)))
    .join("");

  if (facts) {
    facts.innerHTML =
      groupsHtml +
      (leftovers
        ? `<section class="fact-group"><h4>Øvrigt</h4><dl class="fact-list">${leftovers}</dl></section>`
        : "");
  }

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderWhySections(row) {
  const meta = row._analysisMeta;
  if (!meta) {
    return {
      why: `<p class="hint">Ingen analysebegrundelser endnu.</p>`,
      foundation: `<p class="hint">Intet analysegrundlag endnu.</p>`,
    };
  }

  const assessments = meta.assessments || {};
  const withReason = Object.entries(assessments).filter(
    ([, a]) => a && (a.reason || a.evidenceSourceIds?.length)
  );

  const whyItems = withReason
    .slice(0, 12)
    .map(([key, a]) => {
      const basis = assessmentBasisLabel(a);
      const conf = confidenceLabel(a);
      const support = a.evidenceSourceIds?.length || 0;
      const conflict = a.conflictingSourceIds?.length || 0;
      const displayScore =
        row[key] != null && row[key] !== "" ? row[key] : a.score;
      const supportText = support
        ? `${support} understøttende kilde${support === 1 ? "" : "r"}`
        : ["ai_inference", "synopsis_only"].includes(a.basis)
          ? "Ingen direkte kilder til netop dette felt"
          : "Ingen understøttende kilder";
      return `
        <li>
          <strong>${escapeHtml(shortLabel(key))}</strong>
          ${
            displayScore != null && displayScore !== ""
              ? `· ${escapeHtml(String(displayScore))}`
              : ""
          }
          <span class="conf-inline">${escapeHtml(
            [basis, conf].filter(Boolean).join(" · ")
          )}</span>
          <p>${escapeHtml(a.reason || "")}</p>
          <p class="hint">
            ${escapeHtml(supportText)}
            ${conflict ? ` · ${conflict} uenig` : ""}
          </p>
        </li>`;
    })
    .join("");

  const sources = meta.sources || [];
  const batchGroups = [
    ["helteprofil", "Helteprofil"],
    ["romanceprofil", "Romanceprofil"],
    ["plotkarakter", "Plot/karakter"],
    ["helhed", "Helhed"],
  ];
  const groupedSources = batchGroups
    .map(([batch, label]) => {
      const items = sources.filter((s) => s.batch === batch && s.url);
      if (!items.length) return "";
      const lis = items
        .map(
          (s) =>
            `<li><a href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a></li>`
        )
        .join("");
      return `<h4 class="mini-h">${escapeHtml(label)} (${items.length})</h4><ul class="source-links">${lis}</ul>`;
    })
    .join("");
  const otherSources = sources.filter((s) => s.url && !s.batch);
  const otherLis = otherSources
    .map(
      (s) =>
        `<li><a href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a></li>`
    )
    .join("");

  const f = meta.foundation || {};
  const gr = f.goodreads;
  const foundationBits = [
    gr
      ? `Goodreads-rating: ${formatNumberDa(gr.value)} (${formatNumberDa(gr.ratingCount, 0)} stjerne-ratings — ikke antal læste anmeldelser)`
      : "Goodreads: ikke verificeret",
    `Helteprofil-kilder: ${f.helteprofil ?? 0}`,
    `Romanceprofil-kilder: ${f.romanceprofil ?? 0}`,
    `Plot/karakter-kilder: ${f.plotkarakter ?? 0}`,
    `Helheds-kilder: ${f.helhed ?? 0}`,
    `Øvrige faktakilder: ${f.factSources ?? 0}`,
    `${f.totalSources ?? 0} kilder i det systematiske udvalg`,
    f.researchedAt
      ? `Research: ${new Date(f.researchedAt).toLocaleDateString("da-DK")}`
      : null,
  ]
    .filter(Boolean)
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join("");
  const uncertainty = meta.uncertainty;
  const evidence = meta.evidence || {};
  const conflictThemes = evidence.conflictThemes || [];
  const conflictObs = (meta.observations || []).filter((o) => o.hasConflict);
  const uncertaintyLabel =
    uncertainty?.level === "strong"
      ? "Stærkt analysegrundlag"
      : uncertainty?.level === "medium"
        ? "Delvist analysegrundlag"
        : "Tyndt analysegrundlag";
  const uncertaintyItems = uncertainty
    ? [
        `${uncertainty.sourceCoverage ?? 0}% af smagsvurderingerne har direkte kildegrundlag`,
        `${uncertainty.inferredFields?.length || 0} vurderinger bygger på AI'ens viden eller bogbeskrivelsen`,
        `${uncertainty.lowConfidenceFields?.length || 0} vurderinger har lav sikkerhed`,
        uncertainty.notVerifiedFacts?.length
          ? `Ikke verificerede fakta: ${uncertainty.notVerifiedFacts.join(", ")}`
          : "De centrale fakta er verificeret",
        uncertainty.staleOrMissingFreshFacts?.length
          ? `Bør opdateres: ${uncertainty.staleOrMissingFreshFacts.join(", ")}`
          : null,
        conflictThemes.length
          ? `Kilderne er uenige om: ${conflictThemes.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")
    : "";
  const conflictItems = conflictObs
    .slice(0, 6)
    .map(
      (o) => `
        <li>
          <strong>${escapeHtml(o.label || o.theme || "Tema")}</strong>
          <span class="conf-inline">Kilderne er uenige</span>
          <p>${escapeHtml(o.statement || "")}</p>
          <p class="hint">${escapeHtml(
            `${o.supportCount || 0} understøtter · ${o.conflictCount || 0} uenig`
          )}</p>
        </li>`
    )
    .join("");
  const readPriority = meta.readPriority;
  const priorityAdjustments = (readPriority?.adjustments || [])
    .map(
      (adjustment) => `
        <li>
          <strong>${escapeHtml(adjustment.label)}</strong>
          <span class="priority-points">${adjustment.points > 0 ? "+" : ""}${escapeHtml(
            String(adjustment.points)
          )} point</span>
          <p>${escapeHtml(adjustment.reason)}</p>
        </li>`
    )
    .join("");

  const why = `
    ${
      readPriority
        ? `<details class="why-block decision-explanation">
            <summary>Sådan beregnes læseprioriteten</summary>
            <p class="hint">${escapeHtml(readPriority.reason || "")}</p>
            <ul class="priority-adjustments">${
              priorityAdjustments ||
              "<li>Ingen praktiske forhold trækker prioriteten ned.</li>"
            }</ul>
          </details>`
        : ""
    }
    ${
      uncertainty
        ? `<details class="why-block uncertainty-block">
            <summary>${escapeHtml(uncertaintyLabel)}</summary>
            <ul class="foundation-list">${uncertaintyItems}</ul>
          </details>`
        : ""
    }
    ${
      conflictItems
        ? `<details class="why-block conflict-block">
            <summary>Hvor kilderne er uenige (${conflictObs.length})</summary>
            <ul class="why-list">${conflictItems}</ul>
          </details>`
        : ""
    }
    <details class="why-block" open>
      <summary>Hvorfor denne vurdering?</summary>
      <ul class="why-list">${whyItems || "<li class='hint'>Ingen ekstra begrundelser endnu</li>"}</ul>
      ${
        groupedSources || otherLis
          ? `<h4 class="mini-h">Kilder</h4>${groupedSources}${
              otherLis
                ? `<h4 class="mini-h">Øvrige</h4><ul class="source-links">${otherLis}</ul>`
                : ""
            }`
          : ""
      }
    </details>`;

  const foundation = `
    <details class="why-block" open>
      <summary>Grundlag for analysen</summary>
      <ul class="foundation-list">${foundationBits}</ul>
      <p class="disclaimer">${escapeHtml(
        f.disclaimer ||
          "Kilder er batchet efter romantasy-felter. Appen har ikke læst alle anmeldelser — kun et systematisk udvalg."
      )}</p>
    </details>`;

  return { why, foundation };
}

function formatFactValue(key, row) {
  if (key === "Goodreads-score") {
    const gr = row._analysisMeta?.foundation?.goodreads;
    if (gr?.value != null) {
      const n = gr.ratingCount
        ? ` (${formatNumberDa(gr.ratingCount, 0)} ratings)`
        : "";
      return `${formatNumberDa(gr.value)}${n}`;
    }
    const raw = row["Goodreads-score"];
    // Aldrig vis Open Library / Google Books som Goodreads
    if (
      raw == null ||
      raw === "" ||
      /open library|google books/i.test(String(raw))
    ) {
      return null;
    }
    const legacy = row._ratingMeta?.legacy;
    if (legacy?.source === "legacy_unknown") {
      return `${raw} (ældre data — ikke verificeret Goodreads)`;
    }
    return String(raw);
  }
  return row[key];
}

function displayFact(value) {
  if (value == null || value === "") return "Ikke verificeret";
  return String(value);
}

function factRow(key, value) {
  return `
    <div class="fact-row">
      <dt>${escapeHtml(shortLabel(key))}</dt>
      <dd>${escapeHtml(stringify(value))}</dd>
    </div>`;
}

function decisionScoreCard(label, score, assessment, helpText) {
  if (score == null) {
    return `
      <div class="decision-score-card muted-row">
        <div class="decision-score-top">
          <span class="decision-score-value">–</span>
          <span class="decision-score-label">${escapeHtml(label)}</span>
        </div>
        <p class="decision-score-help">${escapeHtml(helpText)}</p>
        <span class="conf-badge conf-low">Kræver ny analyse</span>
      </div>`;
  }
  return `
    <div class="decision-score-card">
      <div class="decision-score-top">
        <span class="decision-score-value">${escapeHtml(String(score))}</span>
        <span class="decision-score-label">${escapeHtml(label)}</span>
      </div>
      <div class="bar-track tine-track">
        <div class="bar-fill tone-${barTone(score)}" style="width:${clamp(
          score,
          0,
          100
        )}%"></div>
      </div>
      <p class="decision-score-help">${escapeHtml(helpText)}</p>
      ${confidenceBadge(assessment)}
    </div>`;
}

function barRow(key, value, max, isPercent = false, assessment = null) {
  const n = parseNumber(value);
  const conf = confidenceBadge(assessment);
  if (n == null) {
    return `
      <div class="bar-row muted-row">
        <div class="bar-label">
          <span class="bar-name">${escapeHtml(shortLabel(key))}</span>
          <span class="bar-num">–</span>
        </div>
        ${isPercent ? percentMeter(0) : segmentMeter(0, max)}
        ${conf}
        ${assessment?.reason ? `<p class="bar-reason">${escapeHtml(assessment.reason)}</p>` : ""}
      </div>`;
  }

  if (!isPercent && max === 5) {
    return `
      <div class="bar-row">
        <div class="bar-label">
          <span class="bar-name">${escapeHtml(shortLabel(key))}</span>
          <span class="bar-num">${escapeHtml(formatScore(n))}<small>/5</small></span>
        </div>
        ${segmentMeter(n, 5)}
        ${conf}
        ${assessment?.reason ? `<p class="bar-reason">${escapeHtml(assessment.reason)}</p>` : ""}
      </div>`;
  }

  const pct = clamp((n / max) * 100, 0, 100);
  return `
    <div class="bar-row">
      <div class="bar-label">
        <span class="bar-name">${escapeHtml(shortLabel(key))}</span>
        <span class="bar-num">${escapeHtml(stringify(value))}</span>
      </div>
      ${percentMeter(pct)}
      ${conf}
      ${assessment?.reason ? `<p class="bar-reason">${escapeHtml(assessment.reason)}</p>` : ""}
    </div>`;
}

function confidenceLabel(assessment) {
  if (!assessment) return "";
  if (assessment.basis === "insufficient" || assessment.score == null) {
    return "";
  }
  if (assessment.consensus === "mixed" || assessment.conflictingSourceIds?.length) {
    if (assessment.confidence === "low") return "Kilderne er uenige";
  }
  if (assessment.confidence === "high") return "Høj sikkerhed";
  if (assessment.confidence === "medium") return "Middel sikkerhed";
  if (assessment.confidence === "low") return "Lav sikkerhed";
  return "";
}

function assessmentBasisLabel(assessment) {
  if (!assessment) return "";
  if (assessment.basis === "source_consensus") return "Kildebaseret";
  if (assessment.basis === "mixed_sources") return "Kilder og modelvurdering";
  if (assessment.basis === "ai_inference") return "Vurderet af modellen";
  if (assessment.basis === "synopsis_only") {
    return "Vurderet ud fra bogbeskrivelsen";
  }
  if (assessment.basis === "insufficient" || assessment.score == null) {
    return "Ikke verificeret";
  }
  return "";
}

function confidenceBadge(assessment) {
  const label = [assessmentBasisLabel(assessment), confidenceLabel(assessment)]
    .filter(Boolean)
    .join(" · ");
  if (!label) return "";
  const cls =
    assessment?.confidence === "high"
      ? "conf-high"
      : assessment?.confidence === "medium"
        ? "conf-mid"
        : "conf-low";
  return `<span class="conf-badge ${cls}">${escapeHtml(label)}</span>`;
}

function segmentMeter(value, max = 5) {
  const filled = Math.round(Number(value) * 2) / 2;
  const cells = Array.from({ length: max }, (_, i) => {
    const idx = i + 1;
    let cls = "seg";
    if (filled >= idx) cls += " on";
    else if (filled >= idx - 0.5) cls += " half";
    return `<span class="${cls}" aria-hidden="true"></span>`;
  }).join("");
  return `<div class="seg-meter" role="img" aria-label="${filled} af ${max}">${cells}</div>`;
}

function percentMeter(pct) {
  return `
    <div class="bar-track">
      <div class="bar-fill tone-${barTone(pct)}" style="width:${clamp(pct, 0, 100)}%"></div>
    </div>`;
}

function shortLabel(key) {
  return key
    .replace(" (0-5)", "")
    .replace(" (0-100%)", "")
    .replace(" (ja/nej, ikke hele serien)", "")
    .replace(" (ja, nej, ikke hele serien)", "")
    .replace("?", "");
}

function parseNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  const m = String(value).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function formatScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatNumberDa(n, digits = 2) {
  if (n == null || n === "") return "–";
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString("da-DK", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits === 0 ? 0 : undefined,
  });
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function barTone(pct) {
  if (pct >= 80) return "high";
  if (pct >= 60) return "good";
  if (pct >= 40) return "mid";
  if (pct >= 20) return "low";
  return "weak";
}

function statusOptions(current) {
  const opts = ["Læser nu", "Ikke læst", "Sat på pause", "Læst", "Droppet"];
  return opts
    .map(
      (o) =>
        `<option ${o === current ? "selected" : ""}>${escapeHtml(o)}</option>`
    )
    .join("");
}

function stringify(v) {
  if (v == null || v === "") return "Ikke verificeret";
  return String(v);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}
