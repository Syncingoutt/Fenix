// Map history state management

import { MapEntry } from '../mapHistory/zoneMappings.js';
import { getItemDatabase } from './inventoryState.js';
import { FLAME_ELEMENTIUM_ID } from '../constants.js';
import { applyTax } from '../utils/tax.js';

// Map history storage
let mapHistory: MapEntry[] = [];
let currentMap: MapEntry | null = null;
let mapStartInventory: Map<string, number> = new Map(); // baseId -> quantity at map start
let mapEndInventory: Map<string, number> = new Map(); // baseId -> quantity at map end
let mapPriceCache: any = null; // Price cache at the time of the map

// Limit the number of maps to store in history to prevent memory leaks
const MAX_MAP_HISTORY_SIZE = 1000;

/**
 * Parse timestamp string to Date object
 * Format: 2026.01.28-02.43.35:826
 * Note: Timestamps from game logs are in UTC, so we create a UTC Date object
 */
function parseTimestamp(timestampStr: string): Date {
  // Format: YYYY.MM.DD-HH.MM.SS:ms
  const match = timestampStr.match(/(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})[:.](\d{3})/);
  if (match) {
    const [, year, month, day, hours, minutes, seconds, millis] = match;
    // Create a Date object using UTC values to preserve the timezone
    return new Date(Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(minutes),
      parseInt(seconds),
      parseInt(millis)
    ));
  }
  return new Date();
}

/**
 * Calculate duration in seconds between two timestamps
 */
function calculateDuration(startTime: string, endTime: string): number {
  const start = parseTimestamp(startTime);
  const end = parseTimestamp(endTime);
  return Math.floor((end.getTime() - start.getTime()) / 1000);
}

/**
 * Get all map history entries
 */
export function getMapHistory(): MapEntry[] {
  return mapHistory;
}

/**
 * Set the entire map history
 */
export function setMapHistory(history: MapEntry[]): void {
  mapHistory = history;
}

/**
 * Add a map entry to history
 */
export function addMapEntry(entry: MapEntry): void {
  mapHistory.push(entry);

  // Trim history to prevent unbounded memory growth
  if (mapHistory.length > MAX_MAP_HISTORY_SIZE) {
    // Remove the oldest maps (from the beginning of the array)
    mapHistory = mapHistory.slice(-MAX_MAP_HISTORY_SIZE);
    console.log(`[MapHistory] Trimmed history to ${MAX_MAP_HISTORY_SIZE} entries`);
  }
}

/**
 * Get the currently active map (if any)
 */
export function getCurrentMap(): MapEntry | null {
  return currentMap;
}

/**
 * Start tracking a new map
 */
export function startMap(startTime: string, zonePath?: string, levelId?: number): void {
  currentMap = {
    startTime,
    zonePath,
    levelId
  };

  // Reset inventory tracking for this map
  mapStartInventory.clear();
  mapEndInventory.clear();
  mapPriceCache = null;
}

/**
 * End tracking the current map
 */
export function endMap(endTime: string): void {
  if (!currentMap) return;

  currentMap.endTime = endTime;
  currentMap.duration = calculateDuration(currentMap.startTime, endTime);

  // Calculate profit and spent based on inventory changes
  const { profit, spent } = calculateMapProfitAndSpent();
  if (profit !== null) {
    currentMap.profit = profit;
  }
  if (spent !== null) {
    currentMap.spent = spent;
  }

  // Only add to history if it's not a hideout map
  const isHideout = (currentMap as any).isHideout;
  if (!isHideout) {
    addMapEntry({ ...currentMap });
  }

  // Clear current map
  currentMap = null;
  mapStartInventory.clear();
  mapEndInventory.clear();
  mapPriceCache = null;
}

/**
 * Set inventory snapshot at map start
 */
export function setMapStartInventory(inventory: Map<string, number>, priceCache?: any): void {
  mapStartInventory = new Map(inventory);
  if (priceCache) {
    mapPriceCache = priceCache;
  }
}

/**
 * Set inventory snapshot at map end
 */
export function setMapEndInventory(inventory: Map<string, number>): void {
  mapEndInventory = new Map(inventory);
}

/**
 * Calculate profit and spent for the current map based on inventory changes
 * Profit is calculated by finding items that increased in quantity (gained)
 * Spent is calculated by finding items that decreased in quantity (used)
 * Returns both profit and spent values
 */
function calculateMapProfitAndSpent(): { profit: number | null; spent: number | null } {
  if (!mapPriceCache || mapPriceCache === null) {
    console.warn('[MapHistoryState] No price cache available, cannot calculate profit/spent');
    return { profit: null, spent: null };
  }

  if (mapStartInventory.size === 0 && mapEndInventory.size === 0) {
    console.warn('[MapHistoryState] No inventory data available, cannot calculate profit/spent');
    return { profit: null, spent: null }; // Not enough data
  }

  let profit = 0;
  let spent = 0;
  let itemsWithGains = 0;
  let itemsWithExpenses = 0;
  let itemsWithoutPrice = 0;

  // Check all items that were present at start OR are present at end
  const allBaseIds = new Set([...mapStartInventory.keys(), ...mapEndInventory.keys()]);

  for (const baseId of allBaseIds) {
    const startQty = mapStartInventory.get(baseId) || 0;
    const endQty = mapEndInventory.get(baseId) || 0;
    const quantityChange = endQty - startQty;

    let itemPrice: number | null = null;

    // Flame Elementium (FE) is currency, always has price 1
    if (baseId === FLAME_ELEMENTIUM_ID) {
      itemPrice = 1;
    } else {
      const priceEntry = mapPriceCache[baseId];
      if (priceEntry && priceEntry.price) {
        itemPrice = priceEntry.price;
      } else {
        itemsWithoutPrice++;
        continue; // Skip items without price
      }
    }

    if (itemPrice !== null) {
      if (quantityChange > 0) {
        // Item was gained (positive change)
        const itemProfit = quantityChange * itemPrice;
        // Apply tax to item profit (FE will be exempted by applyTax)
        const taxedProfit = applyTax(itemProfit, baseId);
        profit += taxedProfit;
        itemsWithGains++;
      } else if (quantityChange < 0) {
        // Item was used/spent (negative change)
        const expense = Math.abs(quantityChange) * itemPrice;
        // Apply tax to expense (FE will be exempted by applyTax)
        const taxedExpense = applyTax(expense, baseId);
        spent += taxedExpense;
        itemsWithExpenses++;
      }
    }
  }

  console.log(`[MapHistoryState] Profit: ${profit.toFixed(2)}, Spent: ${spent.toFixed(2)}, Items gained: ${itemsWithGains}, Items spent: ${itemsWithExpenses}, Skipped: ${itemsWithoutPrice}`);

  return { profit, spent };
}

/**
 * Clear all map history
 */
export function clearMapHistory(): void {
  mapHistory = [];
  currentMap = null;
  mapStartInventory.clear();
  mapEndInventory.clear();
  mapPriceCache = null;
}

/**
 * Get map statistics (total maps, average duration, total profit, total spent, etc.)
 */
export function getMapStats(): {
  totalMaps: number;
  averageDuration: number;
  totalProfit: number;
  totalSpent: number;
  netProfit: number;
} {
  const totalMaps = mapHistory.length;

  if (totalMaps === 0) {
    return {
      totalMaps: 0,
      averageDuration: 0,
      totalProfit: 0,
      totalSpent: 0,
      netProfit: 0
    };
  }

  const totalDuration = mapHistory.reduce((sum, map) => sum + (map.duration || 0), 0);
  const averageDuration = totalDuration / totalMaps;
  const totalProfit = mapHistory.reduce((sum, map) => sum + (map.profit || 0), 0);
  const totalSpent = mapHistory.reduce((sum, map) => sum + (map.spent || 0), 0);
  const netProfit = totalProfit - totalSpent;

  return {
    totalMaps,
    averageDuration,
    totalProfit,
    totalSpent,
    netProfit
  };
}
