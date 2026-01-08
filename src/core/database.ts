import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface ItemData {
  name: string;
  tradable?: boolean; // Optional for backwards compatibility, defaults to true if not specified
  group?: string; // Optional group identifier (e.g., "compass", "none")
}

export interface ItemDatabase {
  [baseId: string]: ItemData;
}

export interface PriceCache {
  [baseId: string]: number;
}

// Use app.getPath('userData') for writable files in production
// Use process.resourcesPath for read-only files from extraResources
function getDataPath(filename: string): string {
  if (app.isPackaged) {
    // In production, look in the app's resources folder
    return path.join(process.resourcesPath, filename);
  } else {
    // In development, look in the project root
    return path.join(process.cwd(), filename);
  }
}

function getUserDataPath(filename: string): string {
  // Always use userData directory for writable files (like price_cache.json)
  return path.join(app.getPath('userData'), filename);
}

const ITEM_DATABASE_FILE = getDataPath('item_database.json');

export function loadItemDatabase(): ItemDatabase {
  if (!fs.existsSync(ITEM_DATABASE_FILE)) {
    console.log('⚠️  Item database not found. Creating empty database...');
    const emptyDb = {};
    fs.writeFileSync(ITEM_DATABASE_FILE, JSON.stringify(emptyDb, null, 2));
    return emptyDb;
  }

  const data = fs.readFileSync(ITEM_DATABASE_FILE, 'utf-8');
  return JSON.parse(data);
}

export function loadPriceCache(): PriceCache {
  const PRICE_CACHE_FILE = getUserDataPath('price_cache.json');
  
  if (!fs.existsSync(PRICE_CACHE_FILE)) {
    return {};
  }

  try {
    const data = fs.readFileSync(PRICE_CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load price cache:', error);
    return {};
  }
}

export function savePriceCache(cache: PriceCache): void {
  const PRICE_CACHE_FILE = getUserDataPath('price_cache.json');
  
  try {
    // Ensure the directory exists
    const dir = path.dirname(PRICE_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PRICE_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error('Failed to save price cache:', error);
  }
}