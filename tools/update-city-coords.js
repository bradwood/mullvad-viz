/**
 * tools/update-city-coords.js
 *
 * Populate / update data/city-coordinates.json by querying
 * Nominatim (OpenStreetMap) for missing city coordinates.
 *
 * Usage:
 *  - node tools/update-city-coords.js
 *      -> scans data/relays.json for unique city names and queries
 *         Nominatim for any city not present in data/city-coordinates.json
 *
 *  - node tools/update-city-coords.js --city "London"
 *      -> fetch coordinates only for the specified city (adds/updates entry)
 *
 *  - node tools/update-city-coords.js --all
 *      -> refresh coordinates for every city found in data/relays.json
 *
 *  - node tools/update-city-coords.js --force
 *      -> re-query even if an entry exists (use carefully)
 *
 * Notes:
 *  - Nominatim is rate-limited. This script enforces a 3 second delay
 *    between requests (configurable via WAIT_MS).
 *  - The script writes to data/city-coordinates.json and preserves existing entries.
 *  - Keys written: exact city name as found in relays.json and a lowercase
 *    variant to help case-insensitive lookups.
 *  - The script will try several candidate query strings per city (strip state,
 *    just city, etc.) before giving up.
 *
 * IMPORTANT: Be polite to the Nominatim service. Do not remove or reduce the delay.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile, appendFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RELAYS_PATH = path.join(__dirname, '..', 'data', 'relays.json');
const CITY_COORDS_PATH = path.join(__dirname, '..', 'data', 'city-coordinates.json');
const DEBUG_LOG_PATH = path.join(__dirname, '..', 'lat-long-debug.txt');

const WAIT_MS = 3000; // 3 seconds between requests
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'mullvad-viz/1.0 (+https://github.com/your-org/mullvad-viz)';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadJson(pathname) {
  try {
    const txt = await readFile(pathname, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

async function saveJson(pathname, obj) {
  const txt = JSON.stringify(obj, null, 2) + '\n';
  await writeFile(pathname, txt, 'utf8');
}

async function logDebug(line) {
  const ts = new Date().toISOString();
  const entry = `${ts} ${line}\n`;
  try {
    await appendFile(DEBUG_LOG_PATH, entry, 'utf8');
  } catch {
    // best-effort, ignore
  }
  console.log(line);
}

/**
 * Build a list of candidate query strings for Nominatim from a raw city string.
 * Examples:
 *  - "San Jose, CA" -> ["San Jose, CA", "San Jose", "San Jose, United States"]
 *  - "Boston, MA"    -> ["Boston, MA", "Boston"]
 */
function buildCandidates(rawCity) {
  const s = (rawCity || '').toString().trim();
  const candidates = [];
  if (!s) return candidates;

  // push original
  candidates.push(s);

  // split on comma
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    // push just the first part (city name only)
    candidates.push(parts[0]);

    // If second token looks like a US state (2 letters), add city only and city + "United States"
    const second = parts[1];
    if (/^[A-Za-z]{2}$/.test(second)) {
      candidates.push(`${parts[0]}, United States`);
    } else if (/^[A-Za-z]{2}\s+[A-Za-z]{2}$/.test(second)) {
      // e.g., "St Louis, MO USA" - still push city only
      candidates.push(parts[0]);
    } else {
      // for other multi-parts, also try first two parts joined
      candidates.push(`${parts[0]}, ${parts[1]}`);
    }
  } else {
    // single token city - also try appending country guesses for ambiguous names? keep simple
    // nothing more for now
  }

  // ensure uniqueness and preserve order
  const seen = new Set();
  const uniq = [];
  for (const c of candidates) {
    if (!seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      uniq.push(c);
    }
  }
  return uniq;
}

/**
 * Query Nominatim for a single candidate string.
 * Uses 'city=' param when the candidate is a single token (no comma),
 * otherwise uses 'q=' free-text which tends to handle "City, ST" better.
 */
async function queryNominatimCandidate(candidate) {
  const isSimpleCity = !candidate.includes(',');
  const url = isSimpleCity
    ? `${NOMINATIM_URL}?city=${encodeURIComponent(candidate)}&format=json&limit=1`
    : `${NOMINATIM_URL}?q=${encodeURIComponent(candidate)}&format=json&limit=1`;

  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json'
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      await logDebug(`  -> Nominatim HTTP ${res.status} for candidate "${candidate}"`);
      return null;
    }
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;
    const entry = json[0];
    const lat = parseFloat(entry.lat);
    const lon = parseFloat(entry.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, display_name: entry.display_name || null, candidate };
  } catch (err) {
    await logDebug(`  -> Nominatim request failed for "${candidate}": ${err && err.message ? err.message : err}`);
    return null;
  }
}

/**
 * Try to find coordinates for a city by trying multiple candidates.
 * Returns { lat, lon, display_name, usedCandidate } or null.
 */
async function findCoordsForCity(city) {
  const candidates = buildCandidates(city);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    // try candidate, with one retry for transient issues
    const result = await queryNominatimCandidate(candidate);
    if (result) return result;
    // small backoff (not the main 3s)
    await sleep(1000);
    const retry = await queryNominatimCandidate(candidate);
    if (retry) return retry;
    // otherwise move to next candidate
  }
  return null;
}

function gatherCityNamesFromRelays(relays) {
  const set = new Set();
  for (const r of relays) {
    if (!r) continue;
    const city = (r.city || '').toString().trim();
    if (city) set.add(city);
  }
  return [...set].sort();
}

function normalizeKey(key) {
  return key && typeof key === 'string' ? key.trim() : '';
}

async function main() {
  const argv = process.argv.slice(2);
  const singleCityArgIndex = argv.findIndex(a => a === '--city' || a === '-c');
  const singleCity = singleCityArgIndex >= 0 ? (argv[singleCityArgIndex + 1] || '') : null;
  const force = argv.includes('--force') || argv.includes('-f');
  const all = argv.includes('--all') || argv.includes('-a');

  const relays = await loadJson(RELAYS_PATH);
  if (!Array.isArray(relays) || relays.length === 0) {
    console.error('No relays found in data/relays.json. Run ingest first.');
    process.exit(1);
  }

  let cityCoords = await loadJson(CITY_COORDS_PATH);
  if (!cityCoords || typeof cityCoords !== 'object') cityCoords = {};

  let citiesToProcess = [];

  if (singleCity) {
    const k = normalizeKey(singleCity);
    if (!k) {
      console.error('Invalid --city argument.');
      process.exit(1);
    }
    citiesToProcess = [k];
  } else {
    const cityNames = gatherCityNamesFromRelays(relays);
    if (all) {
      citiesToProcess = cityNames;
    } else {
      // select cities that are missing from cityCoords (case-insensitive)
      for (const city of cityNames) {
        const exactKey = city;
        const lowerKey = city.toLowerCase();
        const existsExact = Object.prototype.hasOwnProperty.call(cityCoords, exactKey);
        const existsLower = Object.prototype.hasOwnProperty.call(cityCoords, lowerKey);
        if (!existsExact && !existsLower) citiesToProcess.push(city);
        else if (force) citiesToProcess.push(city);
      }
    }
  }

  if (citiesToProcess.length === 0) {
    console.log('No cities to process. Use --all to refresh every city, --force to re-fetch existing, or --city "Name" to fetch a single city.');
    process.exit(0);
  }

  console.log(`Will query Nominatim for ${citiesToProcess.length} cities (wait ${WAIT_MS}ms between requests).`);
  await logDebug(`Will query Nominatim for ${citiesToProcess.length} cities (wait ${WAIT_MS}ms between requests).`);

  for (let i = 0; i < citiesToProcess.length; i++) {
    const city = citiesToProcess[i];
    await logDebug(`[${i + 1}/${citiesToProcess.length}] Querying: ${city}`);
    const result = await findCoordsForCity(city);

    if (result) {
      const exactKey = city;
      const lowerKey = city.toLowerCase();
      cityCoords[exactKey] = { lat: Number(result.lat), lon: Number(result.lon) };
      if (!Object.prototype.hasOwnProperty.call(cityCoords, lowerKey)) {
        cityCoords[lowerKey] = { lat: Number(result.lat), lon: Number(result.lon) };
      }
      await logDebug(`  -> ${result.lat}, ${result.lon} (via "${result.candidate}")`);
    } else {
      await logDebug(`  -> No result for "${city}" from Nominatim`);
    }

    // persist after each attempt
    try {
      await saveJson(CITY_COORDS_PATH, cityCoords);
    } catch (e) {
      console.warn('Failed to save city-coordinates.json:', e && e.message ? e.message : e);
      await logDebug(`Failed to save city-coordinates.json: ${e && e.message ? e.message : e}`);
    }

    // wait unless last
    if (i < citiesToProcess.length - 1) {
      await sleep(WAIT_MS);
    }
  }

  await logDebug(`Done. Updated ${CITY_COORDS_PATH}`);
  console.log('Done. Updated', CITY_COORDS_PATH);
  process.exit(0);
}

main().catch(err => {
  console.error('update-city-coords failed:', err);
  (async () => { await logDebug(`update-city-coords failed: ${String(err)}`); process.exit(1); })();
});
