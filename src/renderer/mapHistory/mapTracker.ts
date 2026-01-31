// Map tracker service for tracking map runs from log file

import { MapEvent, ElectronAPI } from '../types.js';
import { startMap, endMap, getCurrentMap, setMapStartInventory, setMapEndInventory } from '../state/mapHistoryState.js';
import { getZoneDisplayName } from './zoneMappings.js';
import { getCurrentItems } from '../state/inventoryState.js';

declare const electronAPI: ElectronAPI;

// Callback for when a map ends and average time should be updated
let onMapEndCallback: (() => void) | null = null;

/**
 * Register a callback to be called when a map ends
 */
export function setOnMapEndCallback(callback: () => void): void {
  onMapEndCallback = callback;
}


// Store: last position we've read from log file
let lastReadPosition = 0;

// Map tracking state
let isMapTrackingInitialized = false;
let lastProcessedEventIndex = -1; // Track by index instead of timestamp
let cachedMapEvents: MapEvent[] = [];

/**
 * Initialize map tracking
 */
export async function initializeMapTracking(): Promise<void> {
  if (isMapTrackingInitialized) {
    return;
  }

  // Read initial position from local storage
  const savedPosition = localStorage.getItem('mapTrackingLastPosition');
  if (savedPosition) {
    lastReadPosition = parseInt(savedPosition, 10);
  }

  // Load map events from main process
  await refreshMapEvents();

  // Process existing log entries to build initial state
  processMapEvents(true);

  isMapTrackingInitialized = true;
}

/**
 * Refresh map events from main process
 */
async function refreshMapEvents(): Promise<void> {
  try {
    cachedMapEvents = await electronAPI.getMapEvents();
  } catch (error) {
    console.error('[MapTracker] Error fetching map events:', error);
    cachedMapEvents = [];
  }
}

/**
 * Process map events from log file
 * @param initialSetup - If true, this is initial setup and we should only build state without recording maps
 */
export async function processMapEvents(initialSetup: boolean = false): Promise<void> {
  try {
    // Refresh events from main process
    await refreshMapEvents();

    if (cachedMapEvents.length === 0) {
      return;
    }

    // Process events starting from where we left off
    const startIndex = lastProcessedEventIndex + 1;

    for (let i = startIndex; i < cachedMapEvents.length; i++) {
      const event = cachedMapEvents[i];

      await processMapEvent(event, initialSetup);
      lastProcessedEventIndex = i;
    }

  } catch (error) {
    console.error('[MapTracker] Error processing map events:', error);
  }
}

/**
 * Process a single map event
 */
async function processMapEvent(event: MapEvent, initialSetup: boolean): Promise<void> {
  const currentMap = getCurrentMap();

  switch (event.eventType) {
    case 'map_start':
      await handleMapStart(event, initialSetup);
      break;

    case 'map_end':
      await handleMapEnd(event, initialSetup);
      break;
  }
}

/**
 * Handle map start event
 */
async function handleMapStart(event: MapEvent, initialSetup: boolean): Promise<void> {
  const currentMap = getCurrentMap();

  // Check if this is a hideout/hub zone
  const isHideout = event.isHideout || false;

  // If there's a current map without an end time, end it now
  if (currentMap && !currentMap.endTime) {
    if (!initialSetup) {
      endMap(event.timestamp);
    } else {
      // During initial setup, just clear current map
      // This happens when we're building state from existing logs
      getCurrentMap; // Force check
    }
  }

  // Start a new map (hideouts are tracked but not saved to history)
  if (!initialSetup) {
    const zoneName = event.zonePath
      ? getZoneDisplayName(event.zonePath, event.levelId)
      : 'Unknown Zone';

    startMap(event.timestamp, event.zonePath, event.levelId);

    // Mark hideout maps so we can exclude them from history
    if (isHideout) {
      const currentMap = getCurrentMap();
      if (currentMap) {
        (currentMap as any).isHideout = true;
      }
    }

    // Capture inventory snapshot at map start
    await captureInventorySnapshot('start');
  }
}

/**
 * Handle map end event
 */
async function handleMapEnd(event: MapEvent, initialSetup: boolean): Promise<void> {
  const currentMap = getCurrentMap();

  if (currentMap && !currentMap.endTime) {
    if (!initialSetup) {
      const zoneName = currentMap.zonePath
        ? getZoneDisplayName(currentMap.zonePath, currentMap.levelId)
        : 'Unknown Zone';

      // Capture inventory snapshot at map end before ending the map
      await captureInventorySnapshot('end');

      endMap(event.timestamp);

      // Call callback to update average time per map display
      if (onMapEndCallback) {
        onMapEndCallback();
      }
    } else {
      // During initial setup, skip ending maps
      // We'll rebuild map history later
    }
  }
}

/**
 * Capture inventory snapshot for map tracking
 * @param when - 'start' or 'end' to indicate when the snapshot is being taken
 */
async function captureInventorySnapshot(when: 'start' | 'end'): Promise<void> {
  try {
    const currentItems = getCurrentItems();

    // Convert inventory to a Map of baseId -> totalQuantity
    const inventorySnapshot = new Map<string, number>();
    for (const item of currentItems) {
      inventorySnapshot.set(item.baseId, item.totalQuantity);
    }

    // Get price cache (only needed at map start)
    let priceCache = null;
    if (when === 'start') {
      priceCache = await electronAPI.getPriceCache();
    }

    // Store the snapshot
    if (when === 'start') {
      setMapStartInventory(inventorySnapshot, priceCache);
    } else {
      setMapEndInventory(inventorySnapshot);
    }
  } catch (error) {
    // Silent fail - if we can't capture inventory, skip it
  }
}

/**
 * Parse timestamp string to Date object
 * Format: 2026.01.28-02.43.35:826
 */
function parseTimestamp(timestampStr: string): Date {
  // Format: YYYY.MM.DD-HH.MM.SS:ms
  const match = timestampStr.match(/(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})[:.](\d{3})/);
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
 * Get map tracking status
 */
export function getMapTrackingStatus(): {
  initialized: boolean;
  currentMap: any;
} {
  return {
    initialized: isMapTrackingInitialized,
    currentMap: getCurrentMap()
  };
}

/**
 * Clear all map tracking state
 */
export function clearMapTracking(): void {
  lastReadPosition = 0;
  lastProcessedEventIndex = -1;
  cachedMapEvents = [];
  localStorage.removeItem('mapTrackingLastPosition');
  // Map history state is cleared separately in mapHistoryState
}
