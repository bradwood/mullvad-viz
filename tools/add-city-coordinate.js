import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CITY_COORDS_PATH = path.join(__dirname, '..', 'data', 'city-coordinates.json');

async function main() {
  try {
    const contents = await readFile(CITY_COORDS_PATH, 'utf8');
    const coords = JSON.parse(contents);
    // Add Tirana coordinates (TIA) based on known location: 41.32795, -19.81902
    coords['tia'] = { lat: 41.32795, lon: -19.81902 };
    await writeFile(CITY_COORDS_PATH, JSON.stringify(coords, null, 2), 'utf8');
    console.log('city-coordinates.json updated with tia');
  } catch (e) {
    console.error('Failed to update city coordinates:', e);
  }
}

main();
