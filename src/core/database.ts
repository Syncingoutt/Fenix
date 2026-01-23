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

// Daily price point for history (one entry per calendar day)
export interface DailyPricePoint {
  date: string; // ISO date string: YYYY-MM-DD (UTC)
  price: number;
}

export interface PriceCacheEntry {
  price: number;
  timestamp: number; // Unix timestamp in milliseconds
  listingCount?: number; // Optional: number of listings used for average
  history?: DailyPricePoint[]; // Optional: last N days of prices (we currently keep 7)
}

export interface PriceCache {
  [baseId: string]: PriceCacheEntry;
}

// Legacy format for migration
interface LegacyPriceCache {
  [baseId: string]: number | PriceCacheEntry;
}

export function mergePriceCaches(localCache: PriceCache, cloudCache: PriceCache): PriceCache {
  const merged: PriceCache = { ...localCache };

  for (const [baseId, cloudEntry] of Object.entries(cloudCache)) {
    const localEntry = localCache[baseId];
    const cloudListings = cloudEntry.listingCount ?? 0;
    const localListings = localEntry?.listingCount ?? 0;
    let decision = 'use-cloud';
    let reason = 'no local entry';

    if (localEntry) {
      if (cloudEntry.timestamp > localEntry.timestamp) {
        decision = 'use-cloud';
        reason = 'cloud newer';
      } else if (cloudEntry.timestamp < localEntry.timestamp) {
        decision = 'keep-local';
        reason = 'local newer';
      } else if (cloudListings > localListings) {
        decision = 'use-cloud';
        reason = 'equal timestamp, cloud has more listings';
      } else {
        decision = 'keep-local';
        reason = 'equal timestamp, local has same or more listings';
      }
    }

    if (decision === 'use-cloud') {
      merged[baseId] = {
        ...cloudEntry,
        ...(localEntry?.history && { history: localEntry.history })
      };
    }
  }

  return merged;
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

export async function loadPriceCache(
  cloudCacheProvider?: (options?: { forceFull?: boolean }) => Promise<PriceCache>
): Promise<PriceCache> {
  const PRICE_CACHE_FILE = getUserDataPath('price_cache.json');
  
  if (!fs.existsSync(PRICE_CACHE_FILE)) {
    const emptyCache = {};
    if (!cloudCacheProvider) {
      return emptyCache;
    }
    try {
      const cloudCache = await cloudCacheProvider({ forceFull: true });
      return mergePriceCaches(emptyCache, cloudCache);
    } catch (error) {
      console.error('Failed to load cloud price cache:', error);
      return emptyCache;
    }
  }

  try {
    const data = fs.readFileSync(PRICE_CACHE_FILE, 'utf-8');
    const rawCache: LegacyPriceCache = JSON.parse(data);
    
    // Migrate old format to new format if needed
    const migratedCache: PriceCache = {};
    let migrationNeeded = false;
    
    for (const [baseId, value] of Object.entries(rawCache)) {
      if (typeof value === 'number') {
        // Old format - migrate to new structure with current timestamp
        migratedCache[baseId] = {
          price: value,
          timestamp: Date.now()
        };
        migrationNeeded = true;
      } else {
        // Already new format
        migratedCache[baseId] = value;
      }
    }
    
    if (migrationNeeded) {
      console.log('💰 Migrated price cache to new format with timestamps');
    }

    if (!cloudCacheProvider) {
      return migratedCache;
    }

    try {
      const forceFull = Object.keys(migratedCache).length === 0;
      const cloudCache = await cloudCacheProvider({ forceFull });
      return mergePriceCaches(migratedCache, cloudCache);
    } catch (error) {
      console.error('Failed to load cloud price cache:', error);
      return migratedCache;
    }
  } catch (error) {
    console.error('Failed to load price cache:', error);
    return {};
  }
}

export async function savePriceCache(cache: PriceCache): Promise<void> {
  const PRICE_CACHE_FILE = getUserDataPath('price_cache.json');
  
  try {
    // Ensure the directory exists
    const dir = path.dirname(PRICE_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(PRICE_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    console.error('Failed to save price cache:', error);
  }
}