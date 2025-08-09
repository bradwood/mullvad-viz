Mullvad Viz — Context & Developer Notes

Purpose
- Visualize Mullvad VPN relays (locations, ownership, protocols) on a world map and show simple aggregate charts.
- Lightweight demo / operational tool for inspecting relay distribution.

High-level architecture
- server.js (Express)
  - Serves static assets from `public/`
  - Exposes `/api/relays` which returns the JSON file at `data/relays.json`
  - Health endpoint at `/health`
- Frontend
  - public/index.html — loads Leaflet and Chart.js, app.js
  - public/app.js — fetches `/api/relays` and:
    - Renders a Leaflet map with circle markers for each relay
    - Renders ownership (doughnut) and protocol (bar) charts
    - Provides simple hash-based navigation (#/map, #/ownership, #/protocols)
- Data & Tools
  - data/relays.json — canonical dataset consumed by the frontend
  - data/city-coordinates.json — fallback / supplemental coordinates keyed by city code, friendly name, and a few short tokens
  - data/countries.json — country code → name map used during ingestion
  - tools/fetch-relays.js — CLI ingestion and parsing of "mullvad relay list" output, writes sanitized JSON to both `tools/data/relays.json` and `data/relays.json`
  - tools/add-city-coordinate.js — small helper to add Tirana (`tia`) coordinates to the city coordinates file

Data schema (relays.json)
- id: string — unique host identifier
- country: string — friendly country name
- countryCode: string — two-letter-ish code (uppercased)
- city: string — friendly city name
- lat: number — latitude (decimal degrees) — may be 0 as a fallback when unknown
- lon: number — longitude (decimal degrees) — may be 0 as a fallback when unknown
- ownership: string — "Mullvad" (default) or "Rented"
- protocols: string[] — e.g., ["OpenVPN"], ["WireGuard"], or []

Ingestion/parser notes (tools/fetch-relays.js)
- The parser is intentionally permissive:
  - It understands country headers like "Albania (al)"
  - City headers with optional coords like "Tirana (tia) @ 41.32795°N, 19.81902°W"
  - Host lines like "gb-lon-wg-001 (1.2.3.4) - WireGuard" or variants without hyphens
- Protocol detection:
  - Checks for "openvpn", "ovpn", "wireguard", "wg" in hostname and surrounding text
- Ownership detection:
  - Looks for "rented" or "hosted by ... (rented)" tokens. Defaults to "Mullvad".
- Coordinate resolution:
  - Priority: tools/data or data/city-coordinates.json → case-insensitive city name → friendly map (city code -> name) → country centroid → fallback to [0,0]
  - The parser will set lat/lon to 0 if it cannot find a reasonable coordinate.

Known limitations & recommended fixes
- 0,0 coordinates:
  - Items with lat/lon set to 0 will be plotted at the ocean origin. Instead:
    - Option A: Change `fetch-relays.js` to set lat/lon to null when unresolved; update frontend to skip null-coordinates.
    - Option B: Use country centroid fallback instead of 0,0 when city-level coords are missing.
- Strict exit on failure:
  - `tools/fetch-relays.js` exits with code 1 if no valid CLI output is parsed. Consider returning a non-fatal error or adding a `--fail-on-empty` flag.
- Frontend robustness:
  - app.js currently treats 0 as a valid coordinate. Add a guard to skip 0/0 or null coordinates.
- Tests:
  - No tests included. Add a basic validation script to assert relays.json types (lat/lon are numbers or null, protocols array etc).
- Packaging:
  - `nodemon` is not in devDependencies. Either add it or instruct contributors to install globally.

Recommended next tasks
1. Update parser to avoid writing 0,0; prefer null or country centroid.
2. Update frontend to skip plotting null coords.
3. Add a validation script (e.g., tools/validate-relays.js) to check data quality.
4. Add basic unit tests for parsing logic using sample CLI output fixtures.
5. Consider exposing additional endpoints for filtered queries (e.g., by protocol or country).

Contact / Author
- No author specified in package.json. Add an author name or contact info if desired.
