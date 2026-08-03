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

export function renderList(series, { onOpen, onStatusChange, onDelete }) {
  const body = document.getElementById("series-body");
  const count = document.getElementById("list-count");
  count.textContent = `${series.length} serier`;

  body.innerHTML = series
    .map((row, i) => {
      const name = row["Seriens navn"] || "Ukendt";
      const score = row["Tine-score"] ?? "–";
      return `
      <tr data-index="${i}">
        <td>
          <select data-status="${escapeAttr(name)}" class="row-status">
            ${statusOptions(row.Status)}
          </select>
        </td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(row.Forfatter || "–")}</td>
        <td><span class="score-pill ${scoreClass(score)}">${escapeHtml(String(score))}</span></td>
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
  meta.textContent = `${row.Forfatter || "Ukendt forfatter"} · ${row["Første bog/titel"] || ""}`;
  panel.dataset.seriesName = row["Seriens navn"] || "";
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

  const tineScore = parseNumber(row["Tine-score"]);
  const tineAssess = row._analysisMeta?.assessments?.["Tine-score"];
  tine.innerHTML =
    tineScore == null
      ? `<div class="tine-hero-empty">Ingen Tine-score</div>`
      : `
      <div class="tine-ring">
        <span class="tine-value">${escapeHtml(String(row["Tine-score"]))}</span>
        <span class="tine-label">Tine-score</span>
      </div>
      <div class="bar-track tine-track">
        <div class="bar-fill tone-high" style="width:${clamp(tineScore, 0, 100)}%"></div>
      </div>
      ${confidenceBadge(tineAssess)}`;

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
      const conf = confidenceLabel(a);
      const support = a.evidenceSourceIds?.length || 0;
      const conflict = a.conflictingSourceIds?.length || 0;
      return `
        <li>
          <strong>${escapeHtml(shortLabel(key))}</strong>
          ${a.score != null ? `· ${escapeHtml(String(a.score))}` : ""}
          <span class="conf-inline">${escapeHtml(conf)}</span>
          <p>${escapeHtml(a.reason || "")}</p>
          <p class="hint">
            ${support} understøttende kilde${support === 1 ? "" : "r"}
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

  return `
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
    return "Ikke nok information";
  }
  if (assessment.consensus === "mixed" || assessment.conflictingSourceIds?.length) {
    if (assessment.confidence === "low") return "Kilderne er uenige";
  }
  if (assessment.confidence === "high") return "Høj sikkerhed";
  if (assessment.confidence === "medium") return "Middel sikkerhed";
  if (assessment.confidence === "low") return "Lav sikkerhed";
  return "";
}

function confidenceBadge(assessment) {
  const label = confidenceLabel(assessment);
  if (!label) return "";
  const cls =
    label === "Høj sikkerhed"
      ? "conf-high"
      : label === "Middel sikkerhed"
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
