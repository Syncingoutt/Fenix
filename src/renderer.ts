// Main renderer orchestrator

import { ElectronAPI, InventoryItem } from './renderer/types.js';
import { FLAME_ELEMENTIUM_ID } from './renderer/constants.js';

// State
import { setCurrentItems, setItemDatabase, getCurrentItems } from './renderer/state/inventoryState.js';
import { getWealthMode, getIsHourlyActive, getHourlyPaused, getRealtimeElapsedSeconds, getHourlyElapsedSeconds, setRealtimeElapsedSeconds, setHourlyElapsedSeconds, getIsRealtimeInitialized, setIsRealtimeInitialized, getRealtimeStartValue, getHourlyHistory, setHourlyHistory } from './renderer/state/wealthState.js';
import { setIncludeTax } from './renderer/state/settingsState.js';

// Utils
import { formatTime } from './renderer/utils/formatting.js';

// Wealth
import { getCurrentTotalValue, getHourlyWealthGain } from './renderer/wealth/wealthCalculations.js';
import { initRealtimeTracker, initRealtimeTracking, updateRealtimeWealth, resetRealtimeTracking, initRealtimeTimer as initRealtimeTimerFn } from './renderer/wealth/realtimeTracker.js';
import { initHourlyTracker, startHourlyTracking, stopHourlyTracking, pauseHourlyTracking, resumeHourlyTracking, actuallyStartHourlyTracking, trackCompassBeaconUsage, updatePreviousQuantities, updateHourlyWealth, captureHourlyBucket } from './renderer/wealth/hourlyTracker.js';

// Inventory
import { renderInventory } from './renderer/inventory/inventoryRenderer.js';
import { renderBreakdown } from './renderer/inventory/breakdownRenderer.js';
import { updateSortIndicators } from './renderer/inventory/breakdownRenderer.js';

// Graph
import { initGraph, pushRealtimePoint, pushPoint, updateGraph } from './renderer/graph/graphManager.js';

// Modals
import { showBreakdownModal, initBreakdownModal, closeBreakdownModal } from './renderer/modals/breakdownModal.js';
import { showCompassBeaconPrompt, hideCompassBeaconPrompt, showCompassBeaconSelection, hideCompassBeaconSelection, handleCompassBeaconSelectionConfirm } from './renderer/modals/compassBeaconModal.js';
import { initUpdateModal } from './renderer/modals/updateModal.js';
import { initSettingsModal, closeSettingsModal } from './renderer/modals/settingsModal.js';
import { initImportantNoticeModal } from './renderer/modals/importantNoticeModal.js'; // remove after v2.4.0

// Settings & Updates
import { initSettingsManager } from './renderer/settings/settingsManager.js';

// DOM & Events
import { initUIState, wealthValueEl, wealthHourlyEl, timerEl, hourlyTimerEl, startHourlyBtn, stopHourlyBtn, pauseHourlyBtn, resumeHourlyBtn } from './renderer/dom/domElements.js';
import { initInventoryEvents } from './renderer/events/inventoryEvents.js';
import { initWealthEvents } from './renderer/events/wealthEvents.js';
import { initUIEvents } from './renderer/events/uiEvents.js';

declare const electronAPI: ElectronAPI;
declare const Chart: any;

/**
 * Update overlay widget with current data
 */
function updateOverlayWidgetData(): void {
  const wealthMode = getWealthMode();
  const isHourlyActive = getIsHourlyActive();
  const hourlyPaused = getHourlyPaused();
  const isHourlyMode = wealthMode === 'hourly' && isHourlyActive;
  
  let duration: number;
  let hourly: number;
  let total: number;

  if (isHourlyMode) {
    // Hourly mode - use hourly values
    const gainedValue = getHourlyWealthGain();
    const elapsedTimeHours = getHourlyElapsedSeconds() / 3600;
    duration = getHourlyElapsedSeconds();
    hourly = elapsedTimeHours > 0 ? gainedValue / elapsedTimeHours : 0;
    total = gainedValue;
  } else {
    // Realtime mode - use realtime values
    const currentValue = getCurrentTotalValue();
    const elapsedTimeHours = getRealtimeElapsedSeconds() / 3600;
    duration = getRealtimeElapsedSeconds();
    const startValue = getRealtimeStartValue();
    hourly = elapsedTimeHours > 0 ? (currentValue - startValue) / elapsedTimeHours : 0;
    total = currentValue;
  }

  electronAPI.updateOverlayWidget({ duration, hourly, total, isHourlyMode, isPaused: hourlyPaused });
}

/**
 * Update stats (wealth values and breakdown)
 */
function updateStats(items: InventoryItem[]): void {
  updateRealtimeWealth();
  if (getIsHourlyActive() && !getHourlyPaused()) {
  updateHourlyWealth();
  }
  renderBreakdown(renderInventory);
}

/**
 * Load inventory from main process
 */
async function loadInventory(): Promise<void> {
  const [inventory, db] = await Promise.all([
    electronAPI.getInventory(),
    electronAPI.getItemDatabase()
  ]);
  
  setItemDatabase(db);
  
  // Set Flame Elementium price to 1 FE (it's the currency itself)
  const processedInventory = inventory.map(item => {
    if (item.baseId === FLAME_ELEMENTIUM_ID) {
      return { ...item, price: 1 };
    }
    return item;
  });
  
  setCurrentItems(processedInventory);
  
  // Initialize realtime tracking with the loaded inventory value (only once)
  if (!getIsRealtimeInitialized()) {
    initRealtimeTracking();
    setIsRealtimeInitialized(true);
  }
  
  // Track compass/beacon consumption if hourly mode is active
  if (getIsHourlyActive() && !getHourlyPaused()) {
    trackCompassBeaconUsage();
  }
  
  // Update previous quantities for tracking
  updatePreviousQuantities();
  
  renderInventory();
  updateStats(getCurrentItems());
  renderBreakdown(renderInventory);
}

/**
 * Initialize all modules and set up event listeners
 */
async function initialize(): Promise<void> {
  // Initialize UI state
  initUIState();
  
  // Initialize graph
  initGraph();
  
  // Initialize modals
  initBreakdownModal(renderInventory, () => renderBreakdown(renderInventory));
  initUpdateModal();
  initImportantNoticeModal();
  
  // Initialize settings manager and get settings menu state
  const settingsMenuState = initSettingsManager();
  initSettingsModal(renderInventory, () => renderBreakdown(renderInventory), updateStats, settingsMenuState);
  
  // Initialize wealth trackers with DOM elements and callbacks
  initRealtimeTracker(
    wealthValueEl,
    wealthHourlyEl,
    timerEl,
    updateOverlayWidgetData,
    pushRealtimePoint
  );
  
  initHourlyTracker(
    wealthValueEl,
    wealthHourlyEl,
    hourlyTimerEl,
    startHourlyBtn,
    stopHourlyBtn,
    pauseHourlyBtn,
    resumeHourlyBtn,
    updateOverlayWidgetData,
    showCompassBeaconPrompt,
    showBreakdownModal,
    renderInventory,
    () => renderBreakdown(renderInventory)
  );
  
  // Initialize event handlers
  initInventoryEvents(renderInventory, () => renderBreakdown(renderInventory), updateRealtimeWealth, updateHourlyWealth);
  
  initWealthEvents(
    startHourlyTracking,
    stopHourlyTracking,
    pauseHourlyTracking,
    resumeHourlyTracking,
    resetRealtimeTracking,
    updateRealtimeWealth,
    updateHourlyWealth,
    renderInventory,
    () => renderBreakdown(renderInventory),
    updateGraph,
    updateOverlayWidgetData,
    showCompassBeaconPrompt,
    hideCompassBeaconPrompt,
    showCompassBeaconSelection,
    hideCompassBeaconSelection,
    handleCompassBeaconSelectionConfirm,
    actuallyStartHourlyTracking,
    closeBreakdownModal
  );
  
  initUIEvents(loadInventory, closeSettingsModal);

// Listen to timer ticks from main process
electronAPI.onTimerTick((data) => {
  if (data.type === 'realtime') {
      setRealtimeElapsedSeconds(data.seconds);
    
    // Only update the timer display if we're in realtime mode
      if (getWealthMode() === 'realtime') {
        timerEl.textContent = formatTime(data.seconds);
    }
    
    // Update wealth values every second
    updateRealtimeWealth();
  } else if (data.type === 'hourly') {
      setHourlyElapsedSeconds(data.seconds);
      hourlyTimerEl.textContent = formatTime(data.seconds);
    
    // Update wealth and push to history
    const currentGain = getHourlyWealthGain();
      if (getWealthMode() === 'hourly') {
        const hourlyHistory = getHourlyHistory();
      hourlyHistory.push({ time: Date.now(), value: currentGain });
        setHourlyHistory(hourlyHistory);
      updateGraph();
    }
    
    updateHourlyWealth();
    renderInventory();
      renderBreakdown(renderInventory);

    // Check if we've completed an hour
      if (data.seconds % 3600 === 0 && data.seconds > 0) {
        console.log(`🎉 Hour ${Math.floor(data.seconds / 3600)} completed!`);
      captureHourlyBucket();
    }
  }
});

  // Listen for inventory updates
electronAPI.onInventoryUpdate(() => {
      loadInventory();
  });
  
  // Load tax preference on startup and initialize
  const [settings, configured] = await Promise.all([
    electronAPI.getSettings(),
    electronAPI.isLogPathConfigured()
  ]);
  
  setIncludeTax(settings.includeTax !== undefined ? settings.includeTax : false);
  
  if (configured) {
    await loadInventory();
    await initRealtimeTimerFn();
  } else {
    await initRealtimeTimerFn();
  }
  
  // Update sort indicators after initial render
  updateSortIndicators();
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
  } else {
  initialize();
}
