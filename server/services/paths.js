/**
 * Fælles stier til datafiler.
 * Lokalt: ./data
 * Railway: sæt DATA_DIR=/data og mount et volume dér.
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DATA = join(__dirname, "../../data");

export function getRepoDataDir() {
  return REPO_DATA;
}

export function getDataDir() {
  const fromEnv = process.env.DATA_DIR?.trim();
  return fromEnv || REPO_DATA;
}

export function dataPath(...parts) {
  return join(getDataDir(), ...parts);
}

/**
 * Ved deploy med tom volume: kopiér seed-filer fra repoets data/.
 * Overskriver aldrig eksisterende filer på volume.
 */
export function ensureDataVolumeSeeded() {
  const dest = getDataDir();
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });

  // Samme mappe som repo → intet at gøre
  if (dest === REPO_DATA) return { seeded: false, reason: "local" };

  if (!existsSync(REPO_DATA)) {
    console.warn("[data] Repo data/ mangler — kan ikke seede volume");
    return { seeded: false, reason: "no-repo-data" };
  }

  const seeded = [];
  for (const name of readdirSync(REPO_DATA)) {
    const src = join(REPO_DATA, name);
    const out = join(dest, name);
    try {
      if (!statSync(src).isFile()) continue;
      // Spring hemmeligheder/caches over ved seed
      if (
        name === "config.json" ||
        name.endsWith(".bak") ||
        name.endsWith(".log") ||
        name.startsWith("debug-") ||
        name === "piratereads-cache.json" ||
        name === "discovery-cache.json" ||
        name === "reading-profile.json"
      ) {
        continue;
      }
      if (existsSync(out)) continue;
      copyFileSync(src, out);
      seeded.push(name);
    } catch (err) {
      console.warn(`[data] Kunne ikke seede ${name}:`, err.message);
    }
  }

  // Cache-mapper
  for (const dir of ["research-cache", "backups"]) {
    const d = join(dest, dir);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }

  if (seeded.length) {
    console.log(`[data] Seedede volume (${dest}): ${seeded.join(", ")}`);
  }
  return { seeded: true, files: seeded, dest };
}

// Kør seed så snart paths-modulet loades (vigtigt før columns/store læser filer)
ensureDataVolumeSeeded();
