export async function getHealth() {
  const res = await fetch("/api/health");
  return res.json();
}

export async function getSeries() {
  const res = await fetch("/api/series");
  if (!res.ok) throw new Error("Kunne ikke hente listen");
  return res.json();
}

export async function getTineReviews() {
  const res = await fetch("/api/tine-reviews");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Kunne ikke hente anmeldelser");
  return data;
}

export async function saveTineReview(payload) {
  const res = await fetch("/api/tine-reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Kunne ikke gemme anmeldelse");
  return data;
}

export async function analyzeSeries(payload) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Analyse fejlede");
  return data;
}

export async function patchSeries(name, patch) {
  const res = await fetch(`/api/series/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Opdatering fejlede");
  return data;
}

export async function deleteSeries(name) {
  const res = await fetch(`/api/series/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sletning fejlede");
  return data;
}

export async function reanalyzeSeries(name) {
  const res = await fetch(
    `/api/series/${encodeURIComponent(name)}/reanalyze`,
    { method: "POST" }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Genanalyse fejlede");
  return data;
}

export async function refreshSeries(name) {
  const res = await fetch(
    `/api/series/${encodeURIComponent(name)}/refresh`,
    { method: "POST" }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Opdatering fejlede");
  return data;
}

export async function importExcel(file, merge) {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", merge ? "merge" : "replace");
  const res = await fetch("/api/import", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Import fejlede");
  return data;
}

export function exportExcel() {
  window.location.href = "/api/export";
}

export async function getDiscoveryList(includeAdded = false) {
  const q = includeAdded ? "?includeAdded=true" : "";
  const res = await fetch(`/api/discover/list${q}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Kunne ikke hente discovery");
  return data;
}

export async function runDiscovery(force = false) {
  const q = force ? "?force=true" : "";
  const res = await fetch(`/api/discover/run${q}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Discovery fejlede");
  return data;
}

export async function ignoreDiscovered(title, author = null) {
  const res = await fetch(
    `/api/discover/${encodeURIComponent(title)}/ignore`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Ignore fejlede");
  return data;
}

export async function fetchDiscoveryTeaser(book, force = false) {
  const res = await fetch("/api/discover/teaser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: book.title,
      author: book.author || null,
      sources: book.sources || [],
      matchedSignals: book.matchedSignals || [],
      force,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Teaser fejlede");
  return data;
}
