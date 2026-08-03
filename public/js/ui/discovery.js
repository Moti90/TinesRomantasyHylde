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
      return `
      <li class="discovery-card" data-idx="${i}">
        <div class="discovery-card-main">
          <div class="discovery-card-title-row">
            <h3 class="discovery-title">${escapeHtml(c.title)}</h3>
            <span class="discovery-score" title="Antal matchende søgninger">${score}×</span>
          </div>
          <p class="discovery-author">${escapeHtml(c.author || "Ukendt forfatter")}</p>
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

export function showTeaserPanel(book, teaser) {
  const panel = document.getElementById("discovery-teaser-panel");
  if (!panel) return;
  panel.hidden = false;

  const titleEl = document.getElementById("teaser-title");
  const authorEl = document.getElementById("teaser-author");
  const vibeEl = document.getElementById("teaser-vibe");
  const blurbEl = document.getElementById("teaser-blurb");
  const whyEl = document.getElementById("teaser-why");
  const cautionEl = document.getElementById("teaser-caution");
  const linkEl = document.getElementById("teaser-search");

  if (titleEl) titleEl.textContent = book?.title || "";
  if (authorEl) authorEl.textContent = book?.author || "Ukendt forfatter";
  if (vibeEl) {
    vibeEl.textContent = teaser?.vibe || "";
    vibeEl.hidden = !teaser?.vibe;
  }
  if (blurbEl) blurbEl.textContent = teaser?.blurb || "";
  if (whyEl) {
    whyEl.textContent = teaser?.whyMatch || "";
    whyEl.hidden = !teaser?.whyMatch;
  }
  if (cautionEl) {
    cautionEl.textContent = teaser?.caution || "";
    cautionEl.hidden = !teaser?.caution;
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
