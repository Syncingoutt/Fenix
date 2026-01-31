// Map history state management

import { MapEntry } from '../mapHistory/zoneMappings.js';
import { getItemDatabase } from './inventoryState.js';

// Map history storage
let mapHistory: MapEntry[] = [];
let currentMap: MapEntry | null = null;
let mapStartInventory: Map<string, number> = new Map(); // baseId -> quantity at map start
let mapEndInventory: Map<string, number> = new Map(); // baseId -> quantity at map end

/**
 * Parse timestamp string to Date object
 * Format: 2026.01.28-02.43.35:826
 */
function parseTimestamp(timestampStr: string): Date {
  // Format: YYYY.MM.DD-HH.MM.SS:ms
  const match = timestampStr.match(/(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})[:.](\d{3})/);
  if (match) {
    const [, year, month, day, hours, minutes, seconds, millis] = match;
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hours),
      parseInt(minutes),
      parseInt(seconds),
      parseInt(millis)
    );
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
}

/**
 * End tracking the current map
 */
export function endMap(endTime: string): void {
  if (!currentMap) return;

  currentMap.endTime = endTime;
  currentMap.duration = calculateDuration(currentMap.startTime, endTime);

  // Calculate profit based on inventory changes
  const profit = calculateMapProfit();
  if (profit !== null) {
    currentMap.profit = profit;
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
}

/**
 * Set inventory snapshot at map start
 */
export function setMapStartInventory(inventory: Map<string, number>): void {
  mapStartInventory = new Map(inventory);
}

/**
 * Set inventory snapshot at map end
 */
export function setMapEndInventory(inventory: Map<string, number>): void {
  mapEndInventory = new Map(inventory);
}

/**
 * Calculate profit for the current map based on inventory changes
 * This is a simplified calculation that could be enhanced with price data
 */
function calculateMapProfit(): number | null {
  if (mapStartInventory.size === 0 && mapEndInventory.size === 0) {
    return null; // Not enough data
  }

  // For now, return 0 - this would be enhanced with actual item prices later
  // Future implementation would:
  // 1. Get price data from price tracker
  // 2. Calculate value of items at start
  // 3. Calculate value of items at end
  // 4. Return the difference
  return 0;
}

/**
 * Clear all map history
 */
export function clearMapHistory(): void {
  mapHistory = [];
  currentMap = null;
  mapStartInventory.clear();
  mapEndInventory.clear();
}

/**
 * Get map statistics (total maps, average duration, total profit, etc.)
 */
export function getMapStats(): {
  totalMaps: number;
  averageDuration: number;
  totalProfit: number;
} {
  const totalMaps = mapHistory.length;

  if (totalMaps === 0) {
    return {
      totalMaps: 0,
      averageDuration: 0,
      totalProfit: 0
    };
  }

  const totalDuration = mapHistory.reduce((sum, map) => sum + (map.duration || 0), 0);
  const averageDuration = totalDuration / totalMaps;
  const totalProfit = mapHistory.reduce((sum, map) => sum + (map.profit || 0), 0);

  return {
    totalMaps,
    averageDuration,
    totalProfit
  };
}
