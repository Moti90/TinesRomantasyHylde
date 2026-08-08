/**
 * UI for fanen «Opdag nye» — separat fra biblioteket (kun teasers).
 */

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatLastRun(iso) {
  if (!iso) return "Aldrig kørt";
  try {
    const d = new Date(iso);
    return d.toLocaleString("da-DK", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * @param {object} opts
 * @param {(book: object) => void|Promise<void>} opts.onTeaser
 * @param {(book: object) => void|Promise<void>} opts.onIgnore
 */
export function renderDiscoveryList(candidates, { onTeaser, onIgnore } = {}) {
  const list = document.getElementById("discovery-list");
  const empty = document.getElementById("discovery-empty");
  const countEl = document.getElementById("discovery-count");
  if (!list) return;

  const rows = Array.isArray(candidates) ? candidates : [];
  if (countEl) {
    countEl.textContent = rows.length ? `${rows.length} forslag` : "";
  }

  if (!rows.length) {
    list.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  list.innerHTML = rows
    .map((c, i) => {
      const signals = (c.matchedSignals || [])
        .map((s) => `<span class="signal-tag">${escapeHtml(s)}</span>`)
        .join("");
      const score = c.discoveryScore ?? 1;
      const hasTeaser = Boolean(c.teaser?.blurb);
      const evidenceLabel =
        c.teaser?.evidenceLabel ||
        ({
          kildebaseret: "Kildebaseret",
          delvist: "Delvist bekræftet",
          tyndt: "Tyndt kildegrundlag",
        }[c.teaser?.evidenceBasis] || "");
      return `
      <li class="discovery-card" data-idx="${i}">
        <div class="discovery-card-main">
          <div class="discovery-card-title-row">
            <h3 class="discovery-title">${escapeHtml(c.title)}</h3>
            <span class="discovery-score" title="Antal matchende søgninger">${score}×</span>
          </div>
          <p class="discovery-author">${escapeHtml(c.author || "Ukendt forfatter")}</p>
          ${
            evidenceLabel
              ? `<p class="discovery-evidence-pill">${escapeHtml(evidenceLabel)}</p>`
              : ""
          }
          ${
            c.searchUrl
              ? `<p class="discovery-links"><a class="discovery-search" href="${escapeHtml(c.searchUrl)}" target="_blank" rel="noopener noreferrer">Søg på Google</a></p>`
              : ""
          }
          <div class="signal-tags">${signals || `<span class="hint">Ingen signal-tags</span>`}</div>
        </div>
        <div class="discovery-card-actions">
          <button type="button" class="btn primary discovery-teaser" data-idx="${i}">
            ${hasTeaser ? "Vis teaser" : "Kort teaser"}
          </button>
          <button type="button" class="btn ghost discovery-ignore" data-idx="${i}">
            Ignorér
          </button>
        </div>
      </li>`;
    })
    .join("");

  list.querySelectorAll(".discovery-teaser").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const book = rows[Number(btn.dataset.idx)];
      if (!book || !onTeaser) return;
      btn.disabled = true;
      try {
        await onTeaser(book);
      } finally {
        btn.disabled = false;
      }
    });
  });

  list.querySelectorAll(".discovery-ignore").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const book = rows[Number(btn.dataset.idx)];
      if (!book || !onIgnore) return;
      btn.disabled = true;
      try {
        await onIgnore(book);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function cleanDisplayText(value) {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s || /^(null|undefined|none|n\/a|na|ingen|intet)$/i.test(s)) return "";
  return s;
}

function isFreshTeaser(teaser) {
  if (!teaser?.blurb) return false;
  // Fase 6: kræv schema v3 med evidens/fundet-her
  if (Number(teaser.schemaVersion) < 3) return false;
  for (const key of ["vibe", "whyMatch", "caution"]) {
    const v = teaser[key];
    if (typeof v === "string" && /^(null|undefined)$/i.test(v.trim())) {
      return false;
    }
  }
  return true;
}

function foundInLines(teaser, book) {
  const fromTeaser = Array.isArray(teaser?.foundIn)
    ? teaser.foundIn.map(cleanDisplayText).filter(Boolean)
    : [];
  if (fromTeaser.length) return fromTeaser;
  return (book?.sources || [])
    .slice(0, 6)
    .map((s) =>
      [cleanDisplayText(s.signal), cleanDisplayText(s.context)]
        .filter(Boolean)
        .join(" · ")
    )
    .filter(Boolean);
}

function renderMatchSection(teaser, book) {
  const matched = Array.isArray(teaser?.matchedParams) ? teaser.matchedParams : [];
  const uncertain = Array.isArray(teaser?.uncertainParams)
    ? teaser.uncertainParams
    : [];
  const penalties = Array.isArray(teaser?.penaltyHits) ? teaser.penaltyHits : [];
  const found = foundInLines(teaser, book);
  const evidenceLabel =
    cleanDisplayText(teaser?.evidenceLabel) ||
    ({
      kildebaseret: "Kildebaseret",
      delvist: "Delvist bekræftet",
      tyndt: "Tyndt kildegrundlag",
    }[teaser?.evidenceBasis] || "");

  const parts = [];
  if (evidenceLabel) {
    parts.push(
      `<p class="teaser-evidence-badge teaser-evidence-${escapeHtml(
        teaser?.evidenceBasis || "tyndt"
      )}">${escapeHtml(evidenceLabel)}</p>`
    );
  }
  if (matched.length) {
    const items = matched
      .map((row) => {
        const param =
          typeof row === "string"
            ? cleanDisplayText(row)
            : cleanDisplayText(row?.param || row?.label);
        if (!param) return "";
        const evidence =
          typeof row === "object" ? cleanDisplayText(row?.evidence) : "";
        return `<li><strong>${escapeHtml(param)}</strong>${
          evidence ? ` — <span class="hint">${escapeHtml(evidence)}</span>` : ""
        }</li>`;
      })
      .filter(Boolean)
      .join("");
    if (items) {
      parts.push(
        `<div class="teaser-match-block teaser-match-yes"><h4>Bekræftet match</h4><ul>${items}</ul></div>`
      );
    }
  }
  if (uncertain.length) {
    const items = uncertain
      .map((s) => cleanDisplayText(s))
      .filter(Boolean)
      .map((s) => `<li>${escapeHtml(s)}</li>`)
      .join("");
    if (items) {
      parts.push(
        `<div class="teaser-match-block teaser-match-maybe"><h4>Usikkert / ikke bekræftet</h4><ul>${items}</ul></div>`
      );
    }
  }
  if (penalties.length) {
    const items = penalties
      .map((s) => cleanDisplayText(s))
      .filter(Boolean)
      .map((s) => `<li>${escapeHtml(s)}</li>`)
      .join("");
    if (items) {
      parts.push(
        `<div class="teaser-match-block teaser-match-no"><h4>Trækker ned / risiko</h4><ul>${items}</ul></div>`
      );
    }
  }
  if (found.length) {
    const items = found.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
    parts.push(
      `<div class="teaser-match-block teaser-found"><h4>Fundet her</h4><ul>${items}</ul></div>`
    );
  }
  const refs = Array.isArray(teaser?.references) ? teaser.references : [];
  if (refs.length) {
    const items = refs
      .map((r) => {
        const name = cleanDisplayText(r?.name);
        if (!name) return "";
        const score =
          r?.tineScore != null && r.tineScore !== ""
            ? ` (Tine-score ${escapeHtml(String(r.tineScore))})`
            : "";
        return `<li>${escapeHtml(name)}${score}</li>`;
      })
      .filter(Boolean)
      .join("");
    if (items) {
      parts.push(
        `<div class="teaser-match-block teaser-refs"><h4>Minder om i biblioteket</h4><ul>${items}</ul></div>`
      );
    }
  }
  return parts.join("");
}

export function showTeaserPanel(book, teaser) {
  const panel = document.getElementById("discovery-teaser-panel");
  if (!panel) return;
  panel.hidden = false;

  const titleEl = document.getElementById("teaser-title");
  const authorEl = document.getElementById("teaser-author");
  const vibeEl = document.getElementById("teaser-vibe");
  const blurbEl = document.getElementById("teaser-blurb");
  const whyEl = document.getElementById("teaser-why");
  const matchEl = document.getElementById("teaser-match");
  const cautionEl = document.getElementById("teaser-caution");
  const linkEl = document.getElementById("teaser-search");

  const vibe = cleanDisplayText(teaser?.vibe);
  const why = cleanDisplayText(teaser?.whyMatch);
  const caution = cleanDisplayText(teaser?.caution);
  const matchHtml = renderMatchSection(teaser, book);

  if (titleEl) titleEl.textContent = book?.title || "";
  if (authorEl) authorEl.textContent = book?.author || "Ukendt forfatter";
  if (vibeEl) {
    vibeEl.textContent = vibe;
    vibeEl.hidden = !vibe;
  }
  if (blurbEl) blurbEl.textContent = teaser?.blurb || "";
  if (whyEl) {
    whyEl.textContent = why;
    whyEl.hidden = !why;
  }
  if (matchEl) {
    matchEl.innerHTML = matchHtml;
    matchEl.hidden = !matchHtml;
  }
  if (cautionEl) {
    cautionEl.textContent = caution
      ? `Risiko / advarsel: ${caution}`
      : "";
    cautionEl.hidden = !caution;
  }
  if (linkEl) {
    const url = book?.searchUrl;
    if (url) {
      linkEl.href = url;
      linkEl.hidden = false;
    } else {
      linkEl.hidden = true;
    }
  }

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export { isFreshTeaser };

export function hideTeaserPanel() {
  const panel = document.getElementById("discovery-teaser-panel");
  if (panel) panel.hidden = true;
}

export function setDiscoveryMeta({ lastRun, fromCache, pirateReads, readingProfile } = {}) {
  const el = document.getElementById("discovery-meta");
  if (!el) return;
  const parts = [`Senest: ${formatLastRun(lastRun)}`];
  if (fromCache) parts.push("cache");
  if (pirateReads?.filteredOut > 0) {
    parts.push(`−${pirateReads.filteredOut} på hylder`);
  }
  if (readingProfile?.filteredOut > 0) {
    parts.push(`−${readingProfile.filteredOut} uden for smag`);
  }
  el.textContent = parts.join(" · ");
}

export function setDiscoveryStatus(text, isError = false) {
  const el = document.getElementById("discovery-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("error", Boolean(isError && text));
  el.classList.toggle("ok", Boolean(!isError && text));
}
