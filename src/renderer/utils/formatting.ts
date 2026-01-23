// Formatting utilities

import { PRICE_STALE_3_DAYS_MS, PRICE_STALE_7_DAYS_MS } from '../constants.js';

/**
 * Format seconds into HH:MM:SS format
 */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Format keybind string for display (e.g., CommandOrControl -> Ctrl)
 */
export function formatKeybind(keybind: string): string {
  return keybind
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Alt/g, 'Alt')
    .replace(/Shift/g, 'Shift');
}

/**
 * Format group name for display (e.g., "compass_beacon" -> "Compass Beacon")
 */
export function formatGroupName(group: string): string {
  if (group === 'none') return 'Uncategorized';
  // Replace underscores with spaces and capitalize each word
  return group
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Get CSS class for price age (stale indicator)
 * @param priceTimestamp Unix timestamp in milliseconds when price was last updated
 * @returns CSS class name or empty string
 */
export function getPriceAgeClass(priceTimestamp: number | null): string {
  if (priceTimestamp === null) return '';
  
  const ageMs = Date.now() - priceTimestamp;
  
  if (ageMs >= PRICE_STALE_7_DAYS_MS) {
    return 'price-very-stale';
  } else if (ageMs >= PRICE_STALE_3_DAYS_MS) {
    return 'price-stale';
  }
  
  return '';
}
