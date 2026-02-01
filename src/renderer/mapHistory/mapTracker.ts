// Map tracker service for tracking map runs from log file

import { MapEvent, ElectronAPI } from '../types.js';
import { startMap, endMap, getCurrentMap, setMapStartTotalWealth, setMapEndTotalWealth } from '../state/mapHistoryState.js';
import { getZoneDisplayName } from './zoneMappings.js';
import { getCurrentTotalValue } from '../wealth/wealthCalculations.js';

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

// Track wealth while in hideout - updates continuously
let hideoutWealth: number = 0;
let hideoutUpdateInterval: ReturnType<typeof setInterval> | null = null;

// Track hideout wealth history to capture pre-drop value
interface WealthSnapshot {
  wealth: number;
  timestamp: number;
}
let hideoutWealthHistory: WealthSnapshot[] = [];
const MAX_HISTORY_SIZE = 10; // Store last 10 seconds of data

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
  // Start tracking hideout wealth continuously
  startHideoutWealthTracking();

  // If not initialized yet, do first-time setup
  // If not initialized yet, do first-time setup
  if (!isMapTrackingInitialized) {

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
  const isCurrentHideout = currentMap && (currentMap as any).isHideout;

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
      // If leaving hideout to enter real map, capture hideout wealth FIRST
      // This captures wealth BEFORE any map entry costs are deducted
      if (isCurrentHideout && !isHideout) {
        await captureHideoutExitWealth();
      }

      // End the current map (only hideouts during initial setup, or different types during runtime)
      const currentZoneName = currentMap.zonePath
        ? getZoneDisplayName(currentMap.zonePath, currentMap.levelId)
        : ((currentMap as any).isHideout ? 'Hideout' : 'Unknown Zone');
      const newZoneName = event.zonePath
        ? getZoneDisplayName(event.zonePath, event.levelId)
        : (isHideout ? 'Hideout' : 'Unknown Map');

      endMap(event.timestamp);
    }
  }

  // Start a new map (hideouts are tracked but not saved to history)
  if (!initialSetup) {

    // For non-hideout maps, capture hideout wealth BEFORE starting the map
    // This ensures we get wealth before map entry costs are deducted
    if (!isHideout) {
      // Capture current hideout wealth (which has been continuously updated while in hideout)
      await captureHideoutExitWealth();
    }

    startMap(event.timestamp, event.zonePath, event.levelId);

    // Mark hideout maps so we can exclude them from history
    if (isHideout) {
      const currentMap = getCurrentMap();
      if (currentMap) {
        (currentMap as any).isHideout = true;
      }

      // Clear history when entering hideout to prevent using stale data
      hideoutWealthHistory = [];
    }

    // For non-hideout maps, use the captured hideout exit wealth as start wealth
    if (!isHideout) {
      await captureMapStartWealth(hideoutWealth);
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
      // Capture total wealth at map end before ending the map
      await captureMapEndWealth();

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
 * Capture total wealth at map start (uses captured hideout exit wealth)
 * @param wealth - The hideout exit wealth to use as start wealth
 */
async function captureMapStartWealth(wealth: number): Promise<void> {
  try {
    setMapStartTotalWealth(wealth);
  } catch (error) {
    console.error('[MapTracker] Error capturing map start wealth:', error);
  }
}

/**
 * Capture hideout wealth when leaving hideout to enter a map
 * This captures wealth BEFORE any map entry costs are deducted
 */
async function captureHideoutExitWealth(): Promise<void> {
  try {
    // Analyze the history to find the last stable wealth value before the drop
    // This happens during the loading screen when costs are deducted
    if (hideoutWealthHistory.length >= 2) {
      // Find the peak value in the recent history (before costs were deducted)
      const maxWealth = Math.max(...hideoutWealthHistory.map(h => h.wealth));

      // Only use it if it's significantly different from current (means we caught a drop)
      if (maxWealth > hideoutWealth) {
        hideoutWealth = maxWealth;
      }
    }

  } catch (error) {
    console.error('[MapTracker] Error capturing hideout exit wealth:', error);
  }
}

/**
 * Capture total wealth at map end (when leaving map)
 */
async function captureMapEndWealth(): Promise<void> {
  try {
    const totalWealth = getCurrentTotalValue();
    setMapEndTotalWealth(totalWealth);
  } catch (error) {
    console.error('[MapTracker] Error capturing map end wealth:', error);
  }
}

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
 * Start tracking hideout wealth continuously
 */
function startHideoutWealthTracking(): void {
  if (hideoutUpdateInterval) {
    return; // Already tracking
  }

  // Update hideout wealth every second
  hideoutUpdateInterval = setInterval(async () => {
    const currentMap = getCurrentMap();
    const isHideout = currentMap && (currentMap as any).isHideout;

    // Only update hideout wealth while in hideout or not in any map
    // CRITICAL: Do NOT update while in a real map (non-hideout)
    if (isHideout || !currentMap) {
      try {
        const currentWealth = getCurrentTotalValue();
        hideoutWealth = currentWealth;

        // Store in history to detect pre-map-entry values
        hideoutWealthHistory.push({
          wealth: currentWealth,
          timestamp: Date.now()
        });

        // Trim history to prevent memory bloat
        if (hideoutWealthHistory.length > MAX_HISTORY_SIZE) {
          hideoutWealthHistory = hideoutWealthHistory.slice(-MAX_HISTORY_SIZE);
        }

      } catch (error) {
        console.error('[MapTracker] Error updating hideout wealth:', error);
      }
    } else {
    }
  }, 1000); // Update every second
}

/**
 * Stop tracking hideout wealth
 */
function stopHideoutWealthTracking(): void {
  if (hideoutUpdateInterval) {
    clearInterval(hideoutUpdateInterval);
    hideoutUpdateInterval = null;
  }
}

/**
 * Clear all map tracking state (called on page navigation)
 */
export function clearMapTracking(): void {
  // Stop hideout wealth tracking
  stopHideoutWealthTracking();

  // Clear hideout wealth history
  hideoutWealthHistory = [];
  hideoutWealth = 0;

  // Don't reset lastProcessedEventIndex and isMapTrackingInitialized
  // These need to persist across page navigation to avoid reprocessing events
  // Only clear the event cache to free memory
  cachedMapEvents = [];
  localStorage.removeItem('mapTrackingLastPosition');
  // Map history state is cleared separately in mapHistoryState
}
