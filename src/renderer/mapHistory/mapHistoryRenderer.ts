// Map History page rendering

import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

/**
 * Initialize and render the map history page
 */
export async function renderMapHistoryPage(): Promise<void> {
  console.log('[MapHistory] Rendering map history page');

  // For now, just initialize the page with placeholders
  renderMapHistoryContent();
  initializeEventListeners();
}

/**
 * Render the main map history content
 */
function renderMapHistoryContent(): void {
  // This will be populated with actual map history data later
  // For now, we'll just show a placeholder
  const content = document.getElementById('mapHistoryContent');
  if (!content) return;

  content.innerHTML = `
    <div class="map-history-placeholder">
      <p>Map history data will appear here</p>
      <p class="placeholder-text">
        This page will show:
      </p>
      <ul class="placeholder-list">
        <li>Map name</li>
        <li>Time taken</li>
        <li>Profit/loss</li>
      </ul>
    </div>
  `;
}

/**
 * Initialize event listeners
 */
function initializeEventListeners(): void {
  // Back button handler is already handled in uiEvents.ts
  // We'll add more event listeners here when implementing the full feature
}

/**
 * Format duration in seconds to readable format (e.g., "5m 23s")
 */
export function formatMapDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}
