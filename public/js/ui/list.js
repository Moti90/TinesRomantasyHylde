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

export function renderList(series, { onOpen, onStatusChange, onDelete }) {
  const body = document.getElementById("series-body");
  const count = document.getElementById("list-count");
  count.textContent = `${series.length} serier`;

  body.innerHTML = series
    .map((row, i) => {
      const name = row["Seriens navn"] || "Ukendt";
      const contentMatch =
        row.Indholdsmatch ?? row["Tine-score"] ?? row["Tines score"] ?? null;
      const readPriority = row["Læseprioritet nu"] ?? null;
      return `
      <tr data-index="${i}">
        <td>
          <select data-status="${escapeAttr(name)}" class="row-status">
            ${statusOptions(row.Status)}
          </select>
        </td>
        <td>
          <span class="series-name">${escapeHtml(name)}</span>
          ${originBadge(row)}
        </td>
        <td>${escapeHtml(row.Forfatter || "–")}</td>
        <td>
          <div class="decision-score-cell">
            <span class="decision-score-compact">
              <small>Match</small>
              <span class="score-circle ${scoreClass(contentMatch)}">${escapeHtml(
                String(contentMatch ?? "–")
              )}</span>
            </span>
            <span class="decision-score-compact">
              <small>Læs nu</small>
              <span class="score-circle is-muted ${scoreClass(
                readPriority
              )}">${escapeHtml(String(readPriority ?? "–"))}</span>
            </span>
          </div>
        </td>
        <td>${escapeHtml(String(row["Rhysand-faktoren"] ?? "–"))}</td>
        <td>${escapeHtml(displayFact(row["Er serien på Mofibo? (ja, nej, ikke hele serien)"]))}</td>
        <td>${escapeHtml(displayFact(row.Tempo))}</td>
        <td class="row-actions">
          <button type="button" class="linkish" data-open="${i}">Detaljer</button>
          <button type="button" class="linkish danger" data-delete="${escapeAttr(name)}">Slet</button>
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

  body.querySelectorAll("tr[data-index]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("select, button")) return;
      onOpen(series[Number(tr.dataset.index)]);
    });
  });

  body.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("change", () => {
      onStatusChange(sel.dataset.status, sel.value);
    });
  });
}

function setDetailCover(seriesName, author, firstBook) {
  const cover = document.getElementById("detail-cover");
  if (!cover) return;
  const label = String(seriesName || "Cover").slice(0, 36);
  cover.classList.add("is-fallback");
  cover.innerHTML = `<span class="cover-fallback">${escapeHtml(label)}</span>`;
  const title = String(firstBook || seriesName || "").trim();
  if (!title) return;
  const q = new URLSearchParams({ title });
  if (author) q.set("author", String(author));
  fetch(`/api/discover/cover?${q.toString()}`)
    .then((r) => r.json())
    .then((data) => {
      if (!data?.coverUrl) return;
      cover.classList.remove("is-fallback");
      cover.innerHTML = `
        <img src="${escapeAttr(data.coverUrl)}" alt="" loading="lazy" decoding="async"
          onerror="this.parentElement.classList.add('is-fallback'); this.remove();" />
        <span class="cover-fallback">${escapeHtml(label)}</span>`;
    })
    .catch(() => {});
}

export function renderDetail(row) {
  const panel = document.getElementById("detail");
  const title = document.getElementById("detail-title");
  const meta = document.getElementById("detail-meta");
  const tine = document.getElementById("detail-tine");
  const scores = document.getElementById("detail-scores");
  const facts = document.getElementById("detail-facts");
  const why = document.getElementById("detail-why");
  const own = document.getElementById("own-assessment");
  const ownScore = document.getElementById("own-score");
  const ownMsg = document.getElementById("own-assessment-msg");

  if (!row) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  title.textContent = row["Seriens navn"] || "Serie";
  meta.innerHTML = `${escapeHtml(row.Forfatter || "Ukendt forfatter")} · ${escapeHtml(
    row["Første bog/titel"] || ""
  )}${originBadge(row)}`;
  panel.dataset.seriesName = row["Seriens navn"] || "";
  setDetailCover(
    row["Seriens navn"],
    row.Forfatter,
    row["Første bog/titel"]
  );
  if (own) own.value = row["Tines egen vurdering"] || "";
  if (ownScore) {
    ownScore.value =
      row["Tines score"] == null || row["Tines score"] === ""
        ? ""
        : String(row["Tines score"]);
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
      ? `<div class="tine-hero-empty">Ingen beslutningsscorer endnu</div>`
      : `
        ${decisionScoreCard(
          "Indholdsmatch",
          contentMatch,
          contentAssess,
          "Hvor godt serien passer til Tines smag."
        )}
        ${decisionScoreCard(
          "Læseprioritet nu",
          readPriority,
          priorityAssess,
          "Justeret for tilgængelighed, risici og analysegrundlag."
        )}`;

  const barRows = [
    ...SCORE_0_5.map((key) =>
      barRow(key, row[key], 5, false, row._analysisMeta?.assessments?.[key])
    ),
    ...SCORE_PCT.map((key) =>
      barRow(key, row[key], 100, true, row._analysisMeta?.assessments?.[key])
    ),
  ].filter(Boolean);

  scores.innerHTML =
    barRows.join("") || `<p class="hint">Ingen scorer endnu</p>`;

  if (why) {
    why.innerHTML = renderWhySections(row);
  }

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

  facts.innerHTML =
    groupsHtml +
    (leftovers
      ? `<section class="fact-group"><h4>Øvrigt</h4><dl class="fact-list">${leftovers}</dl></section>`
      : "");

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderWhySections(row) {
  const meta = row._analysisMeta;
  if (!meta) return "";

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
      // Vis samme tal som scorebaren (rækkefelt), ikke et evt. forældet AI-tal
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
    `Helteprofil-kilder: ${f.helteprofil ?? 0} (beskyttende helt, bodyguard, touch her and die, Rhysand, bully)`,
    `Romanceprofil-kilder: ${f.romanceprofil ?? 0} (spice, romance-fokus, relation)`,
    `Plot/karakter-kilder: ${f.plotkarakter ?? 0} (episk plot, politiske intriger, krig, udvikling)`,
    `Helheds-kilder: ${f.helhed ?? 0} (læseoplevelse, serie-kvalitet, sammenligninger)`,
    `Øvrige faktakilder: ${f.factSources ?? 0} (Goodreads-side, Wikipedia, officielle)`,
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

  return `
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
    <details class="why-block">
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
    </details>
    <details class="why-block">
      <summary>Grundlag for analysen</summary>
      <ul class="foundation-list">${foundationBits}</ul>
      <p class="disclaimer">${escapeHtml(
        f.disclaimer ||
          "Kilder er batchet efter romantasy-felter. Appen har ikke læst alle anmeldelser — kun et systematisk udvalg."
      )}</p>
    </details>`;
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

function shortDecisionLabel(label) {
  const raw = String(label || "");
  if (/indholdsmatch|tine-score/i.test(raw)) return "Match";
  if (/læseprioritet/i.test(raw)) return "Læs nu";
  return raw;
}

function decisionMetaLine(assessment, helpText) {
  const badge = confidenceBadge(assessment);
  const help = helpText
    ? `<p class="decision-score-help">${escapeHtml(helpText)}</p>`
    : "";
  if (!badge && !help) return "";
  return `<div class="decision-score-meta">${help}${badge}</div>`;
}

function decisionScoreCard(label, score, assessment, helpText) {
  const short = shortDecisionLabel(label);
  const meta = decisionMetaLine(assessment, helpText);
  if (score == null) {
    return `
      <div class="decision-score-wrap">
        <div class="decision-score-card muted-row">
          <span class="decision-score-value">–</span>
          <span class="decision-score-label">${escapeHtml(short)}</span>
        </div>
        ${meta || `<div class="decision-score-meta"><span class="conf-badge conf-low">Kræver ny analyse</span></div>`}
      </div>`;
  }
  return `
    <div class="decision-score-wrap">
      <div class="decision-score-card">
        <span class="decision-score-value">${escapeHtml(String(score))}</span>
        <span class="decision-score-label">${escapeHtml(short)}</span>
      </div>
      ${meta}
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
