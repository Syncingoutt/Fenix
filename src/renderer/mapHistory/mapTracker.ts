// Map tracker service for tracking map runs from log file

import { MapEvent, ElectronAPI } from '../types.js';
import { startMap, endMap, getCurrentMap, setMapStartInventory, setMapEndInventory } from '../state/mapHistoryState.js';
import { getZoneDisplayName } from './zoneMappings.js';

declare const electronAPI: ElectronAPI;

// Callback for when a map ends and average time should be updated
let onMapEndCallback: (() => void) | null = null;

// Store: last position we've read from log file
let lastReadPosition = 0;

// Map tracking state
let isMapTrackingInitialized = false;
let lastProcessedEventIndex = -1; // Track by index instead of timestamp
let cachedMapEvents: MapEvent[] = [];

// Limit cached map events to prevent memory leaks
const MAX_CACHED_EVENTS = 500;

// Store inventory from hideout end to use as start for next real map
// This captures beacons used right before entering the map
let hideoutEndInventory: Map<string, number> | null = null;

/**
 * Register a callback to be called when a map ends
 */
export function setOnMapEndCallback(callback: () => void): void {
  onMapEndCallback = callback;
}

/**
 * Initialize map tracking
 * @param forceRebuild - If true, rebuild state from all events (used on first load)
 */
export async function initializeMapTracking(forceRebuild = false): Promise<void> {
  // If not initialized yet, do first-time setup
  if (!isMapTrackingInitialized) {
    console.log('[MapTracker] First-time initialization');

    // Read initial position from local storage
    const savedPosition = localStorage.getItem('mapTrackingLastPosition');
    if (savedPosition) {
      lastReadPosition = parseInt(savedPosition, 10);
    }

    // Load map events from main process
    await refreshMapEvents();

    // Don't process events here - let the inventory update handler handle them
    // This way we don't double-process events

    isMapTrackingInitialized = true;
    return;
  }

  // Already initialized - if forced rebuild requested (e.g., returning to page after it was closed),
  // refresh events and process any that occurred while away
  if (forceRebuild) {
    await refreshMapEvents();
    // Process events with initialSetup=false so new maps are recorded
    await processMapEvents(false);
  }
}

/**
 * Refresh map events from main process
 */
async function refreshMapEvents(): Promise<void> {
  try {
    const newEvents = await electronAPI.getMapEvents();

    // Only log if we actually got new events (not on every refresh)
    if (newEvents.length > 0) {
      console.log(`[MapTracker] Loaded ${newEvents.length} new events from main process`);
      // Accumulate new events instead of replacing
      cachedMapEvents = [...cachedMapEvents, ...newEvents];
    }

    // Log warning if we're accumulating too many events
    if (cachedMapEvents.length > MAX_CACHED_EVENTS) {
      console.warn(`[MapTracker] Large number of cached events: ${cachedMapEvents.length}. Consider navigating away from map history page to clear cache.`);
    }
  } catch (error) {
    console.error('[MapTracker] Error fetching map events:', error);
    cachedMapEvents = [];
  }
}

/**
 * Process map events from log file
 * @param initialSetup - If true, this is initial setup and we should only build state without recording maps
 * @param skipRefresh - If true, don't call refreshMapEvents (used when events were just refreshed)
 */
export async function processMapEvents(initialSetup: boolean = false, skipRefresh: boolean = false): Promise<void> {
  try {
    // Refresh events from main process (only if not already refreshed)
    if (!skipRefresh) {
      await refreshMapEvents();
    }

    if (cachedMapEvents.length === 0) {
      return;
    }

    // Process events starting from where we left off
    const startIndex = lastProcessedEventIndex + 1;
    const eventsToProcess = cachedMapEvents.length - startIndex;

    if (eventsToProcess <= 0) {
      return; // No new events to process
    }

    for (let i = startIndex; i < cachedMapEvents.length; i++) {
      const event = cachedMapEvents[i];

      console.log(`[MapTracker] Processing event ${i}:`, {
        type: event.eventType,
        zonePath: event.zonePath,
        isHideout: event.isHideout,
        timestamp: event.timestamp
      });

      await processMapEvent(event, initialSetup);
      lastProcessedEventIndex = i;
    }

    // Only log when we actually processed events, and only once per batch
    console.log(`[MapTracker] Processed ${eventsToProcess} new event(s) (index ${startIndex}-${lastProcessedEventIndex})`);
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
  const isCurrentHideout = currentMap && (currentMap as any).isHideout;

  // If leaving hideout to enter real map, capture inventory FIRST
  // This must happen before we end the hideout and start the new map
  if (isCurrentHideout && !isHideout) {
    await handleHideoutEnd(event, initialSetup);
  }

  // If there's a current map without an end time, end it now
  // During initial setup: only end hideouts if entering real map (hideout → non-hideout)
  // During runtime: only end hideouts if entering different type
  if (currentMap && !currentMap.endTime) {
    const shouldEndCurrentMap =
      // During initial setup: end if transitioning from hideout to non-hideout
      (initialSetup && isCurrentHideout && !isHideout) ||
      // During runtime: end if transitioning to different type
      (!initialSetup && isCurrentHideout !== isHideout);

    if (shouldEndCurrentMap) {
      // End the current map (only hideouts during initial setup, or different types during runtime)
      const currentZoneName = currentMap.zonePath
        ? getZoneDisplayName(currentMap.zonePath, currentMap.levelId)
        : ((currentMap as any).isHideout ? 'Hideout' : 'Unknown Zone');
      const newZoneName = event.zonePath
        ? getZoneDisplayName(event.zonePath, event.levelId)
        : (isHideout ? 'Hideout' : 'Unknown Map');

      console.log(`[MapTracker] Ending "${currentZoneName}" (${isCurrentHideout ? 'hideout' : 'map'}), entering "${newZoneName}" (${isHideout ? 'hideout' : 'map'})`);
      endMap(event.timestamp);
    }
  }

  // Start a new map (hideouts are tracked but not saved to history)
  if (!initialSetup) {
    console.log(`[MapTracker] Starting map: zonePath=${event.zonePath}, isHideout=${isHideout}, timestamp=${event.timestamp}`);
    startMap(event.timestamp, event.zonePath, event.levelId);

    // Mark hideout maps so we can exclude them from history
    if (isHideout) {
      const currentMap = getCurrentMap();
      if (currentMap) {
        (currentMap as any).isHideout = true;
      }
    }

    // Use hideout end inventory as starting point (after beacons were used)
    if (!isHideout && hideoutEndInventory) {
      console.log('[MapTracker] Using hideout end inventory as map start (includes beacons)');
      const priceCache = await electronAPI.getPriceCache();
      setMapStartInventory(hideoutEndInventory, priceCache);
      hideoutEndInventory = null; // Clear after using
    } else {
      // Capture inventory snapshot at map start
      await captureInventorySnapshot('start');
    }
  }
}

/**
 * Handle map end event
 */
async function handleMapEnd(event: MapEvent, initialSetup: boolean): Promise<void> {
  const currentMap = getCurrentMap();

  if (currentMap && !currentMap.endTime) {
    if (!initialSetup) {
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
 * Handle map start event for hideouts ending
 * When we leave hideout, save inventory state to use as starting point for next map
 */
async function handleHideoutEnd(event: MapEvent, initialSetup: boolean): Promise<void> {
  // Save inventory from hideout end - this will be starting point for real map
  await captureInventorySnapshot('start');
  hideoutEndInventory = await getInventorySnapshotMap();
  console.log('[MapTracker] Saved hideout inventory for next map start');
}

async function getInventorySnapshotMap(): Promise<Map<string, number>> {
  const currentItems = await electronAPI.getInventory();
  const snapshot = new Map<string, number>();
  for (const item of currentItems) {
    snapshot.set(item.baseId, item.totalQuantity);
  }
  return snapshot;
}

/**
 * Capture inventory snapshot for map tracking
 * @param when - 'start' or 'end' to indicate when snapshot is being taken
 */
async function captureInventorySnapshot(when: 'start' | 'end'): Promise<void> {
  try {
    const currentItems = await electronAPI.getInventory();

    // Convert inventory to a Map of baseId -> totalQuantity
    const inventorySnapshot = new Map<string, number>();
    for (const item of currentItems) {
      inventorySnapshot.set(item.baseId, item.totalQuantity);
    }

    // Get price cache (only needed at map start)
    let priceCache = null;
    if (when === 'start') {
      priceCache = await electronAPI.getPriceCache();
      const priceCacheSize = priceCache ? Object.keys(priceCache).length : 0;
    }

    // Store the snapshot
    if (when === 'start') {
      setMapStartInventory(inventorySnapshot, priceCache);
    } else {
      setMapEndInventory(inventorySnapshot);
    }
  } catch (error) {
    console.error(`[MapTracker] Error capturing ${when} inventory snapshot:`, error);
  }
}

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
 * Clear all map tracking state (called on page navigation)
 */
export function clearMapTracking(): void {
  // Don't reset lastProcessedEventIndex and isMapTrackingInitialized
  // These need to persist across page navigation to avoid reprocessing events
  // Only clear the event cache to free memory
  cachedMapEvents = [];
  hideoutEndInventory = null;
  localStorage.removeItem('mapTrackingLastPosition');
  // Map history state is cleared separately in mapHistoryState
}
