/**
 * tools/fetch-relays.js
 *
 * Reworked ingestion: no longer depends on the Mullvad CLI.
 * - Fetches the public, unauthenticated Mullvad relays API:
 *     https://api.mullvad.net/www/relays/all/
 * - Normalizes the API response into the project's canonical relay schema.
 * - Resolves coordinates using data/city-coordinates.json and data/countries.json (fallbacks).
 * - Writes sanitized output to tools/data/relays.json and ../data/relays.json
 *
 * Notes:
 * - This script intentionally avoids invoking any external CLI.
 * - It attempts to be robust against missing supplemental data files.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, writeFile, readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const RELAYS_PATH = path.join(DATA_DIR, 'relays.json');
const ROOT_RELAYS_PATH = path.join(__dirname, '..', 'data', 'relays.json');
const CITY_COORDS_PATH = path.join(DATA_DIR, 'city-coordinates.json');
const COUNTRIES_PATH = path.join(DATA_DIR, 'countries.json');

// Paths to persist the raw Mullvad API payload so we have a full local cache
const RAW_API_PATH = path.join(DATA_DIR, 'mullvad_api_raw.json');
const ROOT_RAW_API_PATH = path.join(__dirname, '..', 'data', 'mullvad_api_raw.json');

const API_URL = 'https://api.mullvad.net/www/relays/all/';

// Debug flag
const DEBUG_INGEST = !!(process.env.INGEST_DEBUG || process.env.DEBUG);
function dbg(...args) {
  if (DEBUG_INGEST) console.log('[ingest-debug]', ...args);
}

// friendly fallback map for common city codes used historically in the project
const cityCodeToCityName = {
  sea: 'Seattle',
  lax: 'Los Angeles',
  tor: 'Toronto',
  van: 'Vancouver',
  sfo: 'San Francisco',
  tia: 'Tirana',
  dal: 'Dallas',
  chi: 'Chicago',
  nyc: 'New York',
  adl: 'Adelaide',
  mel: 'Melbourne',
  per: 'Perth',
  syd: 'Sydney',
  yyc: 'Calgary',
  mtr: 'Montreal',
  par: 'Paris',
  bru: 'Brussels',
  vie: 'Vienna',
  sof: 'Sofia',
  hel: 'Helsinki',
  cph: 'Copenhagen',
  lon: 'London',
  bos: 'Boston',
  was: 'Washington DC',
  den: 'Denver',
  atl: 'Atlanta',
  phx: 'Phoenix',
  scl: 'Santiago'
};

// basic fallback country names (augmented by data/countries.json when available)
const countryCodeToName = {
  US: 'United States',
  GB: 'United Kingdom',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  NL: 'Netherlands',
  BE: 'Belgium',
  CA: 'Canada',
  DK: 'Denmark',
  ES: 'Spain',
  FI: 'Finland',
  SE: 'Sweden',
  GR: 'Greece',
  AT: 'Austria',
  IE: 'Ireland',
  CH: 'Switzerland',
  PT: 'Portugal',
  CY: 'Cyprus',
  EE: 'Estonia',
  RO: 'Romania',
  PL: 'Poland',
  CZ: 'Czechia',
  NO: 'Norway',
  IT: 'Italy',
  JP: 'Japan',
  CN: 'China',
  KR: 'South Korea',
  MX: 'Mexico',
  BR: 'Brazil',
  CL: 'Chile',
  CO: 'Colombia',
  ZA: 'South Africa',
  SG: 'Singapore',
  NZ: 'New Zealand',
  IL: 'Israel'
};

let cityCoordsFromFile = {};
let countriesMap = {};

async function loadCityCoords() {
  // prefer tools/data, fall back to project data/
  try {
    const contents = await readFile(CITY_COORDS_PATH, 'utf8');
    cityCoordsFromFile = JSON.parse(contents);
    dbg('Loaded city coords from', CITY_COORDS_PATH);
  } catch {
    try {
      const fallback = path.join(__dirname, '..', 'data', 'city-coordinates.json');
      const contents = await readFile(fallback, 'utf8');
      cityCoordsFromFile = JSON.parse(contents);
      dbg('Loaded city coords from', fallback);
    } catch {
      cityCoordsFromFile = {};
      dbg('No city coords file found; continuing with empty map');
    }
  }
}

async function loadCountries() {
  try {
    const contents = await readFile(COUNTRIES_PATH, 'utf8');
    const parsed = JSON.parse(contents);
    if (parsed && typeof parsed === 'object') countriesMap = parsed;
    else countriesMap = {};
    dbg('Loaded countries map from', COUNTRIES_PATH);
  } catch {
    try {
      const fallback = path.join(__dirname, '..', 'data', 'countries.json');
      const contents = await readFile(fallback, 'utf8');
      const parsed = JSON.parse(contents);
      if (parsed && typeof parsed === 'object') countriesMap = parsed;
      else countriesMap = {};
      dbg('Loaded countries map from', fallback);
    } catch {
      countriesMap = {};
      dbg('No countries.json found; using fallback map');
    }
  }
}

function getCountryNameFromCode(code) {
  if (!code) return 'Unknown';
  const c = String(code).toUpperCase();
  if (countriesMap[c]) return countriesMap[c];
  if (countryCodeToName[c]) return countryCodeToName[c];
  return 'Unknown';
}

const countryCentroids = {
  'United States': [37.0902, -95.7129],
  'United Kingdom': [55.3781, -3.4360],
  'Australia': [-25.2744, 133.7751],
  'Germany': [51.1657, 10.4515],
  'France': [46.2276, 2.2137],
  'Netherlands': [52.1400, 5.2913],
  'Canada': [56.1304, -106.3468]
};

function resolveCoordinates(countryCode, cityCode, cityName) {
  // 1) try city code lookup in file
  if (cityCode && cityCoordsFromFile[cityCode]) {
    const v = cityCoordsFromFile[cityCode];
    if (typeof v.lat === 'number' && typeof v.lon === 'number') return [v.lat, v.lon];
  }
  // 2) try city name lowercase
  if (cityName) {
    const key = cityName.toLowerCase();
    if (cityCoordsFromFile[key]) {
      const v = cityCoordsFromFile[key];
      if (typeof v.lat === 'number' && typeof v.lon === 'number') return [v.lat, v.lon];
    }
    if (cityCoordsFromFile[cityName]) {
      const v = cityCoordsFromFile[cityName];
      if (typeof v.lat === 'number' && typeof v.lon === 'number') return [v.lat, v.lon];
    }
  }
  // 3) try fallback map by friendly name
  if (cityCode && cityCodeToCityName[cityCode]) {
    const friendly = cityCodeToCityName[cityCode];
    if (cityCoordsFromFile[friendly]) {
      const v = cityCoordsFromFile[friendly];
      if (typeof v.lat === 'number' && typeof v.lon === 'number') return [v.lat, v.lon];
    }
  }
  // 4) country centroid
  const country = getCountryNameFromCode(countryCode);
  if (country && countryCentroids[country]) return countryCentroids[country];
  return null;
}

async function ensureDataDir() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

/**
 * Map a single API relay object into the canonical schema used by the frontend:
 * {
 *   id, country, countryCode, city, lat, lon, ownership, protocols
 * }
 */
function mapApiRelayToCanonical(apiRelay) {
  const hostname = apiRelay.hostname || apiRelay.fqdn || '';
  const countryCode = (apiRelay.country_code || apiRelay.country || '').toUpperCase();
  const country = apiRelay.country_name || getCountryNameFromCode(countryCode) || 'Unknown';
  // prefer API city_name, fall back to city_code friendly map
  const cityName = apiRelay.city_name || (apiRelay.city_code ? (cityCodeToCityName[apiRelay.city_code] || apiRelay.city_code.toUpperCase()) : '');
  // protocols
  const protocols = [];
  const t = (apiRelay.type || '').toString().toLowerCase();
  if (t === 'wireguard' || t === 'wg') protocols.push('WireGuard');
  if (t === 'openvpn' || t === 'ovpn') protocols.push('OpenVPN');
  // Some entries use 'bridge' or other types; leave protocols empty for those
  // ownership: API field 'owned' exists (boolean). If present, owned===true => "Mullvad"
  let ownership = 'Mullvad';
  if (typeof apiRelay.owned === 'boolean') {
    ownership = apiRelay.owned ? 'Mullvad' : 'Rented';
  } else {
    // fallback to provider heuristics
    if (apiRelay.provider && /mullvad/i.test(apiRelay.provider)) ownership = 'Mullvad';
    else ownership = 'Rented';
  }

  // coordinates: API doesn't include lat/lon — use supplemental lookups.
  let lat = null;
  let lon = null;
  const coords = resolveCoordinates(countryCode, apiRelay.city_code, cityName);
  if (coords) {
    lat = Number(coords[0]);
    lon = Number(coords[1]);
  } else {
    // Keep null for unresolved coordinates (frontend should handle nulls gracefully).
    lat = null;
    lon = null;
  }

  return {
    id: hostname,
    country: country,
    countryCode: countryCode || 'XX',
    city: cityName || '',
    lat: lat,
    lon: lon,
    ownership: ownership,
    protocols: protocols,
    // preserve online/active state from the API when available
    active: apiRelay && typeof apiRelay.active === 'boolean' ? apiRelay.active : true
  };
}

async function fetchRelaysFromApi() {
  dbg('Fetching relays from API:', API_URL);
  const res = await fetch(API_URL, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch ${API_URL}: ${res.status} ${res.statusText} - ${String(body).slice(0, 200)}`);
  }
  const json = await res.json();
  if (!Array.isArray(json)) throw new Error('Unexpected API response: expected array');
  return json;
}

async function ingest() {
  await ensureDataDir();
  await loadCityCoords();
  await loadCountries();

  let apiRelays;
  try {
    apiRelays = await fetchRelaysFromApi();
  } catch (err) {
    console.error('Failed to fetch relays from Mullvad API:', err.message || err);
    process.exit(1);
  }

  // persist the full raw API response so we have a complete local cache
  try {
    await writeFile(RAW_API_PATH, JSON.stringify(apiRelays, null, 2), 'utf8');
    console.log(`Wrote ${apiRelays.length} raw API entries to ${RAW_API_PATH}`);
  } catch (e) {
    console.error('Failed to write raw API to tools data path:', e && e.message ? e.message : e);
  }
  try {
    await writeFile(ROOT_RAW_API_PATH, JSON.stringify(apiRelays, null, 2), 'utf8');
    console.log(`Also wrote ${apiRelays.length} raw API entries to ${ROOT_RAW_API_PATH}`);
  } catch (e) {
    console.error('Failed to write raw API to root data path:', e && e.message ? e.message : e);
  }

  const sanitized = apiRelays.map(mapApiRelayToCanonical).filter(Boolean);

  // normalize coordinates: frontend expects numbers or null. Use nulls for unresolved coords.
  const final = sanitized.map(r => ({
    id: r.id,
    country: r.country || getCountryNameFromCode(r.countryCode),
    countryCode: r.countryCode || 'XX',
    city: r.city || '',
    lat: (typeof r.lat === 'number' ? r.lat : null),
    lon: (typeof r.lon === 'number' ? r.lon : null),
    ownership: r.ownership || 'Mullvad',
    protocols: Array.isArray(r.protocols) ? r.protocols : [],
    // preserve active/online state when present in the API
    active: (typeof r.active === 'boolean') ? r.active : true
  }));

  // write to tools/data and root data/
  try {
    await writeFile(RELAYS_PATH, JSON.stringify(final, null, 2), 'utf8');
    console.log(`Wrote ${final.length} relays to ${RELAYS_PATH}`);
  } catch (err) {
    console.error('Failed to write relays to tools data path:', err.message || err);
  }

  try {
    await writeFile(ROOT_RELAYS_PATH, JSON.stringify(final, null, 2), 'utf8');
    console.log(`Also wrote ${final.length} relays to ${ROOT_RELAYS_PATH}`);
  } catch (err) {
    console.error('Failed to write relays to root data path:', err.message || err);
  }
}

ingest().catch(err => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
