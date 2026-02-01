// Map History page rendering

import { ElectronAPI } from '../types.js';
import { getMapHistory, getMapStats, getCurrentMap, clearMapHistory } from '../state/mapHistoryState.js';
import { getZoneDisplayName } from './zoneMappings.js';
import { clearMapTracking } from './mapTracker.js';

declare const electronAPI: ElectronAPI;

// Store the refresh interval ID so we can clear it
let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

// Store the duration update interval ID
let durationIntervalId: ReturnType<typeof setInterval> | null = null;

// Flag to prevent overlapping refresh calls
let isRefreshing = false;

  // Cache previous state to avoid unnecessary DOM updates
  let cachedMapHistoryLength = -1;
  let cachedTotalMaps = -1;
  let cachedAverageDuration = -1;
  let cachedTotalProfit: number | null = null;
  let cachedCurrentMapStartTime: string | null = null;

/**
 * Initialize and render the map history page
 */
export async function renderMapHistoryPage(): Promise<void> {

  // Always clear any existing intervals first to prevent duplicates
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
  if (durationIntervalId !== null) {
    clearInterval(durationIntervalId);
    durationIntervalId = null;
  }

  // Note: Map tracking reset happens at app startup in renderer.ts
  // We only handle UI rendering and refresh here

  // Initial render of all content
  renderMapHistoryContent();
  initializeEventListeners();

  // Only set up UI refresh intervals if we're on the map history page
  // Note: Map tracking continues running globally at the renderer level

  // Set up auto-refresh to update the UI with changes from global map tracking
  refreshIntervalId = setInterval(async () => {
    await refreshMapHistory();
  }, 500); // Refresh every 500ms to match global polling

  // Set up duration update interval (only updates current map duration, doesn't rebuild DOM)
  durationIntervalId = setInterval(() => {
    updateCurrentMapDurationOnly();
  }, 1000); // Update duration every 1 second
}

/**
 * Render the main map history content (initial full render)
 */
function renderMapHistoryContent(): void {
  const mapHistory = getMapHistory();
  const stats = getMapStats();
  const currentMap = getCurrentMap();

  // Update cache with initial values
  cachedMapHistoryLength = mapHistory.length;
  cachedTotalMaps = stats.totalMaps;
  cachedAverageDuration = Math.round(stats.averageDuration);
  cachedTotalProfit = stats.totalProfit;
  cachedCurrentMapStartTime = currentMap ? currentMap.startTime : null;

  // Update statistics values
  updateStatistics(stats);

  // Update current map section
  updateCurrentMap(currentMap);

  // Update map history table
  updateMapHistoryTable(mapHistory);
}

/**
 * Refresh the map history display (only updates changed values)
 */
async function refreshMapHistory(): Promise<void> {
  // Prevent overlapping refresh calls to avoid memory leaks and race conditions
  if (isRefreshing) {
    return;
  }

  try {
    isRefreshing = true;

    // Get current state (map tracking is handled at the renderer level)
    const mapHistory = getMapHistory();
    const stats = getMapStats();
    const currentMap = getCurrentMap();

    // Only update statistics if values changed
    if (stats.totalMaps !== cachedTotalMaps ||
        Math.round(stats.averageDuration) !== cachedAverageDuration ||
        stats.totalProfit !== cachedTotalProfit) {
      updateStatistics(stats);
      cachedTotalMaps = stats.totalMaps;
      cachedAverageDuration = Math.round(stats.averageDuration);
      cachedTotalProfit = stats.totalProfit;
    }

    // Only update current map if it changed
    const newMapStartTime = currentMap ? currentMap.startTime : null;
    if (newMapStartTime !== cachedCurrentMapStartTime) {
      console.log(`[MapHistoryRenderer] Current map changed from ${cachedCurrentMapStartTime} to ${newMapStartTime}`);
      console.log(`[MapHistoryRenderer] New current map:`, currentMap ? {
        zonePath: currentMap.zonePath,
        levelId: currentMap.levelId,
        isHideout: (currentMap as any).isHideout
      } : null);
      updateCurrentMap(currentMap);
      cachedCurrentMapStartTime = newMapStartTime;
    }

    // Only update table if history length changed (new map completed)
    if (mapHistory.length !== cachedMapHistoryLength) {
      console.log(`[MapHistoryRenderer] History length changed from ${cachedMapHistoryLength} to ${mapHistory.length}`);
      updateMapHistoryTable(mapHistory);
      cachedMapHistoryLength = mapHistory.length;
    }

  } finally {
    isRefreshing = false;
  }
}

/**
 * Update statistics display values
 */
function updateStatistics(stats: any): void {
  const totalMapsEl = document.getElementById('statTotalMaps');
  const averageDurationEl = document.getElementById('statAverageDuration');
  const totalProfitEl = document.getElementById('statTotalProfit');

  if (totalMapsEl) {
    totalMapsEl.textContent = stats.totalMaps.toString();
  }

  if (averageDurationEl) {
    averageDurationEl.textContent = formatMapDuration(Math.round(stats.averageDuration));
  }

  if (totalProfitEl) {
    totalProfitEl.textContent = (stats.netProfit >= 0 ? '+' : '') + formatCurrency(stats.netProfit);
    totalProfitEl.className = 'map-stat-value ' + (stats.netProfit >= 0 ? 'positive' : 'negative');
  }
}

/**
 * Update current map section
 */
function updateCurrentMap(currentMap: any): void {
  const currentMapSection = document.getElementById('currentMapSection');

  if (!currentMap) {
    if (currentMapSection) {
      currentMapSection.style.display = 'none';
    }
    return;
  }

  if (currentMapSection) {
    currentMapSection.style.display = 'block';
  }

  const zoneEl = document.getElementById('currentMapZone');
  const startedEl = document.getElementById('currentMapStarted');
  const durationEl = document.getElementById('currentMapDuration');

  if (zoneEl) {
    const zoneName = currentMap.zonePath
      ? getZoneDisplayName(currentMap.zonePath, currentMap.levelId)
      : ((currentMap as any).isHideout ? 'Hideout' : 'Unknown Zone');
    zoneEl.textContent = zoneName;
  }

  if (startedEl) {
    startedEl.textContent = formatTimestamp(currentMap.startTime);
  }

  if (durationEl) {
    // Initial duration value - will be updated by the duration interval
    const start = parseTimestamp(currentMap.startTime);
    const now = Date.now();
    const elapsed = Math.floor((now - start.getTime()) / 1000);
    durationEl.textContent = formatMapDuration(elapsed);
  }
}

/**
 * Update map history table (only called when history length changes)
 */
function updateMapHistoryTable(mapHistory: any[]): void {
  const emptyMessageEl = document.getElementById('emptyHistoryMessage');
  const tableEl = document.getElementById('mapHistoryTable');
  const tableBodyEl = document.getElementById('mapHistoryTableBody');

  if (mapHistory.length === 0) {
    if (emptyMessageEl) emptyMessageEl.style.display = 'block';
    if (tableEl) tableEl.style.display = 'none';
    return;
  }

  if (emptyMessageEl) emptyMessageEl.style.display = 'none';
  if (tableEl) tableEl.style.display = 'table';

  if (tableBodyEl) {
    tableBodyEl.innerHTML = mapHistory.slice().reverse().map(map => {
      const zoneName = map.zonePath
        ? getZoneDisplayName(map.zonePath, map.levelId)
        : 'Unknown Zone';

      const duration = map.duration !== undefined ? formatMapDuration(map.duration) : 'N/A';

      // Profit is now already the net profit (totalEarned - totalSpent)
      // No need to subtract spent again
      let gainedValue: number | null = null;
      if (map.profit !== undefined) {
        gainedValue = map.profit;
      }

      const gained = gainedValue !== null ?
        `<span class="${gainedValue >= 0 ? 'positive' : 'negative'}">
          ${gainedValue >= 0 ? '+' : ''}${formatCurrency(gainedValue)}
        </span>` : 'N/A';

      return `
        <tr>
          <td>${formatTimestamp(map.startTime)}</td>
          <td>${zoneName}</td>
          <td>${duration}</td>
          <td>${gained}</td>
        </tr>
      `;
    }).join('');
  }
}

/**
 * Initialize event listeners
 */
function initializeEventListeners(): void {
  const clearMapHistoryBtn = document.getElementById('clearMapHistoryBtn');

  if (clearMapHistoryBtn) {
    clearMapHistoryBtn.addEventListener('click', () => {
      clearMapHistory();
      renderMapHistoryContent();
    });
  }
}

/**
 * Update only the current map duration (called every second)
 * This is the only thing that needs frequent updates without rebuilding DOM
 */
function updateCurrentMapDurationOnly(): void {
  if (!cachedCurrentMapStartTime) {
    return;
  }

  const durationElement = document.getElementById('currentMapDuration');
  if (durationElement) {
    const now = Date.now();
    const start = parseTimestamp(cachedCurrentMapStartTime);
    const elapsed = Math.floor((now - start.getTime()) / 1000);
    durationElement.textContent = formatMapDuration(elapsed);
  }
}

/**
 * Format duration in seconds to readable format (e.g., "5m 23s")
 */
export function formatMapDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Parse timestamp string to Date object
 * Format: 2026.01.28-02.43.35:826
 * Note: Timestamps from game logs are in UTC, so we create a UTC Date object
 */
function parseTimestamp(timestampStr: string): Date {
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
 * Format timestamp string to readable time
 * Format: 2026.01.28-02.43.35:826 -> Jan 28, 02:43
 * Note: Uses the user's local timezone for display
 */
function formatTimestamp(timestampStr: string): string {
  const date = parseTimestamp(timestampStr);
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  return date.toLocaleString('en-US', options);
}

/**
 * Format currency value
 */
function formatCurrency(value: number): string {
  return value.toFixed(2);
}

/**
 * Cleanup - stop intervals and reset state when navigating away
 */
export function cleanupMapHistoryPage(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }

  if (durationIntervalId !== null) {
    clearInterval(durationIntervalId);
    durationIntervalId = null;
  }

  // Reset refresh flag to prevent stuck states
  isRefreshing = false;

  // Reset cache variables
  cachedMapHistoryLength = -1;
  cachedTotalMaps = -1;
  cachedAverageDuration = -1;
  cachedTotalProfit = null;
  cachedCurrentMapStartTime = null;

  // Don't clear map tracking here - it continues running at the renderer level
  // Only clear the UI-specific intervals

  // Note: We DON'T clear mapHistory state here because user's map history
  // should persist across navigation within the same app session.
  // It will be automatically cleared when the app is closed and restarted.
}
