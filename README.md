# Mullvad Viz

A small visualization app that plots Mullvad VPN relays on a Leaflet world map and shows simple charts (ownership and protocol distribution).

This repository contains a tiny Express backend that serves static frontend assets and an API endpoint that returns relay data from a JSON file. Tools are provided to fetch relay information from Mullvad's public relay API and to manage city coordinates.

## Prerequisites

- Node 18+ (for built-in fetch support) or a compatible environment.
- No Mullvad CLI is required anymore — the ingestion script fetches relays directly from the public Mullvad relays API.

---

## Quick start

1. Install dependencies
   - npm install

2. Start the server
   - npm start
   - The server listens on http://localhost:3000 by default.

3. Development
   - npm run dev
   - Note: `dev` uses `nodemon` if available. If you don't have it installed, run `node server.js` directly.

4. Open the UI
   - Open http://localhost:3000 in your browser. The UI loads the relay data from `/api/relays`.

---

## What is included

- server.js — Express server. Serves `public/` statically and exposes `/api/relays` which returns the JSON found at `data/relays.json`.
- public/
  - index.html — main UI (Leaflet + Chart.js).
  - app.js — frontend logic: fetches `/api/relays`, renders markers and charts, provides hash-based navigation.
- data/
  - relays.json — canonical relay list consumed by the frontend (cached by the ingestion tool).
  - city-coordinates.json — supplemental map of city codes / names -> lat/lon used by ingestion tooling.
  - countries.json — optional country code → country name map used when resolving names.
- tools/
  - fetch-relays.js — ingestion script that fetches the public Mullvad relays API (https://api.mullvad.net/www/relays/all/), normalizes entries into the canonical relay format, resolves coordinates using `data/city-coordinates.json` and `data/countries.json`, and writes `data/relays.json` (and `tools/data/relays.json`) as a cached copy.
  - add-city-coordinate.js — helper script to add a predefined Tirana coordinate entry into `data/city-coordinates.json`.
  - data/ — example tool data (note: some older CLI-specific diagnostic tools have been removed).

---

## Ingestion (how it works)

- Run:
  - npm run ingest
  - This runs `tools/fetch-relays.js`, which:
    1. Fetches the public Mullvad relays API at https://api.mullvad.net/www/relays/all/
    2. Maps the API's fields to the project's canonical relay schema:
       - id, country, countryCode, city, lat, lon, ownership, protocols
    3. Resolves lat/lon using:
       - data/city-coordinates.json (tools/data fallback)
       - case-insensitive city name lookup
       - friendly cityCode -> cityName fallback
       - country centroid fallback
       - If none match, lat and lon are set to null (the frontend will skip markers with null coords).
    4. Writes the sanitized dataset to `tools/data/relays.json` and `data/relays.json` for caching.
- The ingestion no longer invokes or requires the Mullvad CLI.

---

## Available npm scripts

- npm start — start the Express server
- npm run dev — start with nodemon (if available)
- npm run ingest — fetch relays from the Mullvad public API and cache to `data/relays.json`
- npm run add-city — run the helper that adds a Tirana (tia) coordinate to the city coordinates file

---

## Data format (relays.json)

Each relay entry is a JSON object with these fields:

- id (string) — host identifier (e.g., `gb-lon-wg-001`)
- country (string) — friendly country name (e.g., `United Kingdom`)
- countryCode (string) — ISO-like code (e.g., `GB`)
- city (string) — display name for city
- lat (number|null) — latitude (decimal degrees) or null when unresolved
- lon (number|null) — longitude (decimal degrees) or null when unresolved
- ownership (string) — `"Mullvad"` or `"Rented"` (defaults to `"Mullvad"`)
- protocols (array of strings) — e.g., `["OpenVPN"]` or `["WireGuard"]`

Example:
{
  "id": "gb-lon-ovpn-001",
  "country": "United Kingdom",
  "countryCode": "GB",
  "city": "London",
  "lat": 51.51412,
  "lon": -0.09369,
  "ownership": "Mullvad",
  "protocols": ["OpenVPN"]
}

Note: Coordinates may be null when unable to resolve; the frontend skips null coordinates to avoid plotting points at (0,0).

---

## Tools and ingestion

- tools/fetch-relays.js
  - Fetches the Mullvad relays API and writes sanitized JSON to `tools/data/relays.json` and `data/relays.json`.
  - Resolves coordinates using local supplemental files and fallbacks described above.
  - Sets lat/lon to null when unresolved (frontend should skip markers with null coords).

- tools/add-city-coordinate.js
  - Adds a Tirana (`tia`) coordinate to `data/city-coordinates.json`. Intended as a convenience helper.

---

## Known issues & recommendations

- Null coordinates:
  - Entries with lat/lon set to `null` are treated as unresolved. The frontend will skip plotting these markers.
  - Recommendation: Add or improve entries in `data/city-coordinates.json` for better city-level placement.

- Tests & validation:
  - Consider adding a validation script (e.g., `tools/validate-relays.js`) to assert the shape and types in `data/relays.json`.

---

## Troubleshooting

- If the map shows no markers:
  - Verify `data/relays.json` exists and contains an array of objects.
  - Check the server by visiting http://localhost:3000/api/relays (should return JSON).
- If `npm run ingest` fails:
  - Ensure your environment can perform outbound HTTPS requests (the ingestion script fetches the public Mullvad API).
  - Enable `INGEST_DEBUG=1` to get verbose logs from the ingestion script.

---

## License

This project is licensed under the MIT license. See the `LICENSE` file or the `license` field in `package.json`.
