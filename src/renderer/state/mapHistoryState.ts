// Map history state management

import { MapEntry } from '../mapHistory/zoneMappings.js';

// Map history storage
let mapHistory: MapEntry[] = [];
let currentMap: MapEntry | null = null;
let totalWealthAtStart: number = 0; // Total wealth when entering the map
let totalWealthAtEnd: number = 0; // Total wealth when leaving the map

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

  // Reset wealth tracking for this map
  totalWealthAtStart = 0;
  totalWealthAtEnd = 0;
}

/**
 * End tracking the current map
 */
export function endMap(endTime: string): void {
  if (!currentMap) return;

  currentMap.endTime = endTime;
  currentMap.duration = calculateDuration(currentMap.startTime, endTime);

  // Calculate profit: endWealth - startWealth
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
  totalWealthAtStart = 0;
  totalWealthAtEnd = 0;
}

/**
 * Set total wealth at map start (before entering map)
 */
export function setMapStartTotalWealth(wealth: number): void {
  totalWealthAtStart = wealth;
}

/**
 * Set total wealth at map end (when leaving map)
 */
export function setMapEndTotalWealth(wealth: number): void {
  totalWealthAtEnd = wealth;
}

/**
 * Calculate profit for the current map based on wealth changes
 * Simplified logic: profit = endWealth - startWealth
 * Returns profit (can be negative)
 */
function calculateMapProfit(): number | null {
  // Validate we have the necessary wealth data
  if (totalWealthAtStart === 0 || totalWealthAtEnd === 0) {
    console.warn('[MapHistoryState] Insufficient wealth data, cannot calculate profit', {
      totalWealthAtStart,
      totalWealthAtEnd
    });
    return null;
  }

  // Net profit is end wealth minus start wealth
  const profit = totalWealthAtEnd - totalWealthAtStart;

  return profit;
}

/**
 * Clear all map history
 */
export function clearMapHistory(): void {
  mapHistory = [];
  currentMap = null;
  totalWealthAtStart = 0;
  totalWealthAtEnd = 0;
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

  // Profit is now net profit (endWealth - startWealth)
  const netProfit = mapHistory.reduce((sum, map) => sum + (map.profit || 0), 0);

  // For backwards compatibility with existing code
  const totalProfit = netProfit;
  const totalSpent = 0; // No longer tracked

  return {
    totalMaps,
    averageDuration,
    totalProfit,
    totalSpent,
    netProfit
  };
}
