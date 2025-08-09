import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to fetch relays data
app.get('/api/relays', async (req, res) => {
  const dataPath = path.join(__dirname, 'data', 'relays.json');
  try {
    const contents = await readFile(dataPath, 'utf8');
    const data = JSON.parse(contents);
    res.json(data);
  } catch (err) {
    // If file doesn't exist or parsing fails, return empty array
    res.json([]);
  }
});

// On-demand geocoding endpoint (uses Nominatim). This is intended for
// ad-hoc lookups when a new city appears in the Mullvad relays API.
// NOTE: Nominatim is rate-limited; avoid automated high-volume usage.
app.get('/api/geocode', async (req, res) => {
  const city = (req.query.city || '').toString().trim();
  if (!city) return res.status(400).json({ error: 'missing city query parameter' });

  const url = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(city)}&format=json&limit=1`;
  try {
    const headers = {
      'User-Agent': 'mullvad-viz/1.0 (+https://github.com/your-org/mullvad-viz)',
      'Accept': 'application/json'
    };
    const r = await fetch(url, { headers });
    if (!r.ok) {
      return res.status(502).json({ error: 'geocode request failed', status: r.status, statusText: r.statusText });
    }
    const json = await r.json();
    if (!Array.isArray(json) || json.length === 0) {
      return res.status(404).json({ error: 'not found' });
    }
    const entry = json[0];
    const lat = parseFloat(entry.lat);
    const lon = parseFloat(entry.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(502).json({ error: 'invalid coordinates returned' });
    }
    return res.json({ lat, lon, display_name: entry.display_name || null });
  } catch (err) {
    return res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Simple health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Ensure data directory exists on startup (best-effort)
async function ensureDataDir() {
  const dir = path.join(__dirname, 'data');
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
}

ensureDataDir().then(() => {
  app.listen(PORT, () => {
    console.log(`MullvadViz server listening on http://localhost:${PORT}`);
  });
});
