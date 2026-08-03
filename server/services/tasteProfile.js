/**
 * Tines eksplicitte bogprofil (taste-profile.json).
 */
import { readFileSync, existsSync } from "fs";
import { dataPath } from "./paths.js";

const PROFILE_PATH = dataPath("taste-profile.json");

let cached = null;

export function loadTasteProfile() {
  if (cached) return cached;
  if (!existsSync(PROFILE_PATH)) return null;
  try {
    cached = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
    return cached;
  } catch {
    return null;
  }
}

/** Kort tekst til prompts (discovery/teaser/analyse). */
export function formatTasteProfileForPrompt(profile = null) {
  const p = profile || loadTasteProfile();
  if (!p) return "";

  const mmc = p.priority1?.mmc || {};
  const mmcBits = [
    mmc.powerfulButNotDomineering && "magtfuld uden at dominere",
    mmc.competentIntelligent && "kompetent/intelligent",
    mmc.protectiveInstinct && "beskytterinstinkt",
    mmc.bodyguardVibe && "bodyguard-vibe",
    mmc.respectsHeroine && "respekt for heltinden",
    mmc.loyal && "loyal",
    mmc.touchHerAndDie && "touch her and die",
    mmc.noBully && "INGEN bully",
    mmc.letsHerGrow && "lader hende vokse",
  ].filter(Boolean);

  return `TINES BOGPROFIL (eksplicit):
Prioritet 1: Færdig serie (standalone OK) · high/fantasy · episk plot · stærk romance (MF eller gerne RH) · HEA · heltindens udvikling (ingen → magt) · god worldbuilding · romantisk kemi/sommerfugle · MMC: ${mmcBits.join(", ")}.

Prioritet 2: Lange bøger (300+ sider) · found family · politiske intriger · spice · velskrevet plot · FemDom nice-to-have.

Trækker ned: hjerteknuser · romcom · bully · spice > plot · fade to black · teenage MC · kvalitetsfald senere · kun misforståelser som konflikt · urban fantasy.

NO GO: ingen romance · ufærdige serier · ingen fantasy · permanente dødsfald blandt hovedpersoner.

Favorit-serier: ${(p.belovedSeries || []).slice(0, 12).join(", ")}.
Favorit-MMC-arketyper: Rhysand, Casteel, Rain, Rowan, Rik, Edward (beskytter/bodyguard).
Favorit-FMC-arketyper: Aelin, Feyre, Sal, Mave, Shea, Shara (vokser ind i magt).`;
}

/** Signatur-søgninger baseret på profilen. */
export function buildTasteDiscoveryQueries(profile = null) {
  const p = profile || loadTasteProfile();
  const series = p?.belovedSeries || [];

  const tropes = [
    `"touch her and die" protective MMC adult romantasy finished series`,
    `"bodyguard romance" high fantasy adult romantasy HEA`,
    `"reverse harem" fantasy romance epic plot recommendations`,
    `"morally grey MMC who respects her" adult romantasy no bully`,
    `"found family" epic fantasy romance finished series`,
    `"heroine becomes queen" romantasy character growth`,
  ];

  const liked = [];
  // Brug favorit-serier (ikke kun scorede i vores DB)
  for (const name of series.slice(0, 4)) {
    liked.push(`"if you liked ${name}" similar finished romantasy series`);
  }

  const seen = new Set();
  const out = [];
  for (const q of [...tropes, ...liked]) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 8) break;
  }
  return out;
}

/** Soft/hard signaler til filtrering af kandidater. */
export function tasteHardNoGoBlob() {
  return [
    "no romance",
    "without romance",
    "middle grade",
    "children",
    "permanent character death of main",
    "kills off the main couple",
  ];
}
