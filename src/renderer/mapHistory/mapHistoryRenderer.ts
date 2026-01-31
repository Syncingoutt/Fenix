// Map History page rendering

import { ElectronAPI } from '../types.js';
import { getMapHistory, getMapStats, getCurrentMap } from '../state/mapHistoryState.js';
import { getZoneDisplayName } from './zoneMappings.js';
import { initializeMapTracking, processMapEvents } from './mapTracker.js';

declare const electronAPI: ElectronAPI;

let isMapTrackingInitialized = false;

// Store the refresh interval ID so we can clear it
let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize and render the map history page
 */
export async function renderMapHistoryPage(): Promise<void> {
  console.log('[MapHistory] Rendering map history page');

  // Initialize map tracking only once
  if (!isMapTrackingInitialized) {
    await initializeMapTracking();
    isMapTrackingInitialized = true;
  }

  renderMapHistoryContent();
  initializeEventListeners();
  
  // Clear any existing interval to avoid multiple refresh timers
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId);
  }
  
  // Set up auto-refresh to fetch new map events and update the page
  refreshIntervalId = setInterval(async () => {
    await refreshMapHistory();
  }, 500); // Refresh every 500ms to match main process polling
}

/**
 * Render the main map history content
 */
function renderMapHistoryContent(): void {
  const content = document.getElementById('mapHistoryContent');
  if (!content) return;

  const mapHistory = getMapHistory();
  const stats = getMapStats();
  const currentMap = getCurrentMap();

  // Build HTML for map history
  let historyHtml = '';

  // Show statistics section
  historyHtml += `
    <div class="map-stats">
      <h2>Map Statistics</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Maps</div>
          <div class="stat-value">${stats.totalMaps}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Average Duration</div>
          <div class="stat-value">${formatMapDuration(Math.round(stats.averageDuration))}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Profit</div>
          <div class="stat-value ${stats.totalProfit >= 0 ? 'positive' : 'negative'}">
            ${stats.totalProfit >= 0 ? '+' : ''}${formatCurrency(stats.totalProfit)}
          </div>
        </div>
      </div>
    </div>
  `;

  // Show current map if active
  if (currentMap) {
    const zoneName = currentMap.zonePath 
      ? getZoneDisplayName(currentMap.zonePath, currentMap.levelId)
      : 'Unknown Zone';
    const isHideout = (currentMap as any).isHideout || false;

    historyHtml += `
      <div class="current-map">
        <h2>Current Map</h2>
        <div class="current-map-info">
          <div class="info-row">
            <span class="info-label">Zone:</span>
            <span class="info-value">${zoneName}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Started:</span>
            <span class="info-value">${formatTimestamp(currentMap.startTime)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Duration:</span>
            <span class="info-value" id="currentMapDuration">Calculating...</span>
          </div>
        </div>
      </div>
    `;
  }

  // Show map history table
  historyHtml += `
    <div class="map-history-list">
      <h2>Map History</h2>
      ${mapHistory.length === 0 ? `
        <div class="empty-history">
          <p>No map history yet. Start tracking by entering maps!</p>
        </div>
      ` : `
        <table class="map-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Map</th>
              <th>Duration</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            ${mapHistory.slice().reverse().map(map => {
              const zoneName = map.zonePath 
                ? getZoneDisplayName(map.zonePath, map.levelId)
                : 'Unknown Zone';
              
              const duration = map.duration !== undefined ? formatMapDuration(map.duration) : 'N/A';
              const profit = map.profit !== undefined ? 
                `<span class="${map.profit >= 0 ? 'positive' : 'negative'}">
                  ${map.profit >= 0 ? '+' : ''}${formatCurrency(map.profit)}
                </span>` : 'N/A';

              return `
                <tr>
                  <td>${formatTimestamp(map.startTime)}</td>
                  <td>${zoneName}</td>
                  <td>${duration}</td>
                  <td>${profit}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `}
    </div>
  `;

  content.innerHTML = historyHtml;

  // Update current map duration if there is one
  if (currentMap) {
    updateCurrentMapDuration(currentMap.startTime);
  }
}

/**
 * Initialize event listeners
 */
function initializeEventListeners(): void {
  // Back button handler is already handled in uiEvents.ts
  // We'll add more event listeners here when implementing the full feature
}

/**
 * Refresh the map history display
 */
async function refreshMapHistory(): Promise<void> {
  // Process any new map events from the log
  await processMapEvents();
  
  // Re-render entire content to show new maps, updates to current map, etc.
  renderMapHistoryContent();
}

/**
 * Update the duration display for the current map
 */
function updateCurrentMapDuration(startTime: string): void {
  const durationElement = document.getElementById('currentMapDuration');
  if (durationElement) {
    const now = Date.now();
    const start = parseTimestamp(startTime);
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
 */
function parseTimestamp(timestampStr: string): Date {
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
 * Format timestamp string to readable time
 * Format: 2026.01.28-02.43.35:826 -> Jan 28, 02:43
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
  if (Math.abs(value) >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  } else if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

/**
 * Cleanup - stop refresh interval when navigating away
 */
export function cleanupMapHistoryPage(): void {
  if (refreshIntervalId !== null) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
    console.log('[MapHistory] Cleaned up refresh interval');
  }
}
