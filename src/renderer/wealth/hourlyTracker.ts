// Hourly wealth tracking

import { getHourlyWealthGain } from './wealthCalculations.js';
import {
  getHourlyStartSnapshot,
  setHourlyStartSnapshot,
  getHourlyStartTime,
  setHourlyStartTime,
  getHourlyElapsedSeconds,
  setHourlyElapsedSeconds,
  getIsHourlyActive,
  setIsHourlyActive,
  getHourlyPaused,
  setHourlyPaused,
  getIncludedItems,
  getPreviousQuantities,
  setPreviousQuantities,
  getHourlyUsage,
  setHourlyUsage,
  getHourlyPurchases,
  setHourlyPurchases,
  getHourlyBuckets,
  setHourlyBuckets,
  getCurrentHourStartValue,
  setCurrentHourStartValue,
  getHourlyHistory,
  setHourlyHistory,
  getWealthMode,
  setWealthMode
} from '../state/wealthState.js';
import { getCurrentItems } from '../state/inventoryState.js';
import { formatTime } from '../utils/formatting.js';
import { ElectronAPI, HourlyBucket, PriceCache } from '../types.js';

declare const electronAPI: ElectronAPI;

// These will be set by the main renderer
let wealthValueEl: HTMLElement;
let wealthHourlyEl: HTMLElement;
let hourlyTimerEl: HTMLElement;
let startHourlyBtn: HTMLButtonElement;
let stopHourlyBtn: HTMLButtonElement;
let pauseHourlyBtn: HTMLButtonElement;
let resumeHourlyBtn: HTMLButtonElement;
let updateOverlayWidgetData: () => void;
let showCompassBeaconPrompt: () => void;
let showBreakdownModal: () => void;
let renderInventory: () => void;
let renderBreakdown: () => void;

export function initHourlyTracker(
  wealthValueElement: HTMLElement,
  wealthHourlyElement: HTMLElement,
  hourlyTimerElement: HTMLElement,
  startBtn: HTMLButtonElement,
  stopBtn: HTMLButtonElement,
  pauseBtn: HTMLButtonElement,
  resumeBtn: HTMLButtonElement,
  overlayWidgetUpdater: () => void,
  compassBeaconPromptFn: () => void,
  breakdownModalFn: () => void,
  inventoryRenderer: () => void,
  breakdownRenderer: () => void
): void {
  wealthValueEl = wealthValueElement;
  wealthHourlyEl = wealthHourlyElement;
  hourlyTimerEl = hourlyTimerElement;
  startHourlyBtn = startBtn;
  stopHourlyBtn = stopBtn;
  pauseHourlyBtn = pauseBtn;
  resumeHourlyBtn = resumeBtn;
  updateOverlayWidgetData = overlayWidgetUpdater;
  showCompassBeaconPrompt = compassBeaconPromptFn;
  showBreakdownModal = breakdownModalFn;
  renderInventory = inventoryRenderer;
  renderBreakdown = breakdownRenderer;
}

/**
 * Start hourly tracking (shows prompt first)
 */
export function startHourlyTracking(): void {
  // Show prompt asking if user wants to include compasses/beacons
  showCompassBeaconPrompt();
}

/**
 * Actually start hourly tracking after user confirms
 */
export function actuallyStartHourlyTracking(): void {

  const currentItems = getCurrentItems();
  const hourlyStartSnapshot = getHourlyStartSnapshot();
  const previousQuantities = getPreviousQuantities();
  const hourlyUsage = getHourlyUsage();
  const hourlyPurchases = getHourlyPurchases();
  const includedItems = getIncludedItems();

  // Take snapshot of current inventory
  hourlyStartSnapshot.clear();
  previousQuantities.clear();
  hourlyUsage.clear();
  hourlyPurchases.clear();

  for (const item of currentItems) {
    // Snapshot all items normally
    hourlyStartSnapshot.set(item.baseId, item.totalQuantity);

    // For tracked compasses/beacons, initialize previous quantity
    if (includedItems.has(item.baseId)) {
      previousQuantities.set(item.baseId, item.totalQuantity);
    }
  }

  const startTime = Date.now();
  setHourlyStartTime(startTime);
  setHourlyHistory([]);
  // Don't clear buckets when starting new session - preserve existing buckets
  // setHourlyBuckets([]);
  setCurrentHourStartValue(0);
  
  // Start with 0 gain
  if (getWealthMode() === 'hourly') {
    const history = getHourlyHistory();
    history.push({ time: Date.now(), value: 0 });
    setHourlyHistory(history);
  }
  
  startHourlyBtn.style.display = 'none';
  stopHourlyBtn.style.display = 'inline-block';
  pauseHourlyBtn.style.display = 'inline-block';
  resumeHourlyBtn.style.display = 'none';
  
  hourlyTimerEl.textContent = '00:00:00';
  
  // Set state flags
  setIsHourlyActive(true);
  setHourlyPaused(false);
  
  // Tell main process to start the timer
  electronAPI.startHourlyTimer();
  
  // Initial update
  updateHourlyWealth();
  renderInventory();
  renderBreakdown(); // Reset breakdown to show only gained items
}

/**
 * Track compass/beacon usage for selected items
 */
export function trackCompassBeaconUsage(): void {
  const currentItems = getCurrentItems();
  const includedItems = getIncludedItems();
  const previousQuantities = getPreviousQuantities();
  const hourlyStartSnapshot = getHourlyStartSnapshot();
  const hourlyUsage = getHourlyUsage();
  const hourlyPurchases = getHourlyPurchases();
  
  // Track usage and purchases separately for selected compasses/beacons
  for (const baseId of includedItems) {
    const currentItem = currentItems.find(item => item.baseId === baseId);
    const currentQty = currentItem ? currentItem.totalQuantity : 0;
    const previousQty = previousQuantities.get(baseId) ?? (hourlyStartSnapshot.get(baseId) ?? currentQty);
    const startQty = hourlyStartSnapshot.get(baseId) ?? currentQty;
    
    // Track usage: quantity decreased (used)
    if (currentQty < previousQty) {
      const used = previousQty - currentQty;
      const currentUsage = hourlyUsage.get(baseId) || 0;
      hourlyUsage.set(baseId, currentUsage + used);
    }
    
    // Track purchases: quantity increased (bought)
    if (currentQty > previousQty) {
      const bought = currentQty - previousQty;
      const currentPurchases = hourlyPurchases.get(baseId) || 0;
      hourlyPurchases.set(baseId, currentPurchases + bought);
    }
  }
}

/**
 * Update previous quantities for tracking
 */
export function updatePreviousQuantities(): void {
  const currentItems = getCurrentItems();
  const includedItems = getIncludedItems();
  const previousQuantities = getPreviousQuantities();
  
  // Update previous quantities for all tracked compasses/beacons
  for (const baseId of includedItems) {
    const currentItem = currentItems.find(item => item.baseId === baseId);
    if (currentItem) {
      previousQuantities.set(baseId, currentItem.totalQuantity);
    }
  }
}

/**
 * Capture hourly bucket at end of each hour
 */
export async function captureHourlyBucket(): Promise<void> {
  const currentValue = getHourlyWealthGain();
  const currentHourStartValue = getCurrentHourStartValue();
  const hourlyHistory = getHourlyHistory();
  const hourlyBuckets = getHourlyBuckets();
  const hourlyElapsedSeconds = getHourlyElapsedSeconds();
  const includedItems = getIncludedItems();
  const currentItems = getCurrentItems();
  const previousQuantities = getPreviousQuantities();
  const hourlyUsage = getHourlyUsage();
  const hourlyPurchases = getHourlyPurchases();
  const hourlyStartTime = getHourlyStartTime();

  // Generate a unique session ID when starting a new session
  // This will be used to ensure buckets from different sessions don't merge
  if (hourlyBuckets.length === 0) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    (window as any).currentSessionId = sessionId;
  }

  const sessionId = (window as any).currentSessionId || `session_${Date.now()}`;

  // Calculate hour number based on actual clock time, not elapsed time
  const startDate = new Date(hourlyStartTime);
  const endDate = new Date();
  const hourNumber = startDate.getHours();

  // Capture inventory HTML (before any further changes)
  const inventoryContainer = document.querySelector('#inventory');
  const inventorySnapshot = inventoryContainer?.outerHTML || '';

  // Capture current prices
  const priceCache = await electronAPI.getPriceCache();

  // Capture usage data
  const includedItemsArray = Array.from(includedItems);
  const usageSnapshot: { [baseId: string]: { used: number; purchased: number } } = {};

  for (const [baseId, used] of hourlyUsage) {
    usageSnapshot[baseId] = { used, purchased: hourlyPurchases.get(baseId) || 0 };
  }

  const bucketEndTime = Date.now();
  const bucket: HourlyBucket = {
    hourNumber,
    startValue: currentHourStartValue,
    endValue: currentValue,
    earnings: currentValue - currentHourStartValue,
    history: [...hourlyHistory],
    timestamp: hourlyStartTime, // Keep for backwards compatibility
    duration: hourlyElapsedSeconds,
    inventorySnapshot,
    pricesSnapshot: priceCache,
    includedItems: includedItemsArray,
    usageSnapshot,
    customName: undefined,
    bucketStartTime: hourlyStartTime, // When this bucket actually started
    bucketEndTime: bucketEndTime, // When this bucket actually ended
    sessionId // All buckets from this session share same ID
  };

  hourlyBuckets.push(bucket);
  setHourlyBuckets(hourlyBuckets);

  // Reset for next hour
  setCurrentHourStartValue(currentValue);
  setHourlyHistory([{ time: Date.now(), value: currentValue }]);
  setHourlyStartTime(Date.now()); // Update start time for next hour

  // Reset usage and purchase tracking for next hour and update previous quantities
  hourlyUsage.clear();
  hourlyPurchases.clear();
  for (const baseId of includedItems) {
    const currentItem = currentItems.find(item => item.baseId === baseId);
    if (currentItem) {
      previousQuantities.set(baseId, currentItem.totalQuantity);
    }
  }

  // Show notification (positioned relative to stats container)
  const statsContainer = document.querySelector('.stats-container');
  if (statsContainer) {
    const anim = document.createElement('div');
    anim.className = 'earnings-animation';
    anim.textContent = `Hour ${hourNumber} Complete! +${bucket.earnings.toFixed(2)} FE`;
    anim.style.color = '#10b981';
    statsContainer.appendChild(anim);
    setTimeout(() => anim.remove(), 2000);
  }
}

/**
 * Pause hourly tracking
 */
export function pauseHourlyTracking(): void {
  setHourlyPaused(true);
  electronAPI.pauseHourlyTimer();
  
  // Update previous quantities before pausing to avoid false usage detection on resume
  updatePreviousQuantities();
  
  pauseHourlyBtn.style.display = 'none';
  resumeHourlyBtn.style.display = 'inline-block';
  
  // Update overlay widget immediately
  updateOverlayWidgetData();
}

/**
 * Resume hourly tracking
 */
export function resumeHourlyTracking(): void {
  setHourlyPaused(false);
  electronAPI.resumeHourlyTimer();
  
  // Update previous quantities on resume to start tracking from current state
  updatePreviousQuantities();
  
  pauseHourlyBtn.style.display = 'inline-block';
  resumeHourlyBtn.style.display = 'none';
  
  // Update overlay widget immediately
  updateOverlayWidgetData();
}

/**
 * Stop hourly tracking
 */
export async function stopHourlyTracking(): Promise<void> {

  // Tell main process to stop timer
  electronAPI.stopHourlyTimer();

  const finalGain = getHourlyWealthGain();
  const hourlyBuckets = getHourlyBuckets();
  const hourlyHistory = getHourlyHistory();
  const currentHourStartValue = getCurrentHourStartValue();
  const hourlyElapsedSeconds = getHourlyElapsedSeconds();
  const hourlyStartTime = getHourlyStartTime();

  // Get session ID for this tracking session
  const sessionId = (window as any).currentSessionId || `session_${Date.now()}`;

  // Capture inventory HTML (snapshot before ending session)
  const inventoryContainer = document.querySelector('#inventory');
  const inventorySnapshot = inventoryContainer?.outerHTML || '';

  // Capture current prices
  const priceCache = await electronAPI.getPriceCache();

  // Calculate hour number based on session start time (actual clock hour)
  const startDate = new Date(hourlyStartTime);
  const hourNumber = startDate.getHours();

  // Capture usage data
  const includedItems = getIncludedItems();
  const includedItemsArray = Array.from(includedItems);
  const hourlyUsage = getHourlyUsage();
  const hourlyPurchases = getHourlyPurchases();
  const usageSnapshot: { [baseId: string]: { used: number; purchased: number } } = {};

  for (const [baseId, used] of hourlyUsage) {
    usageSnapshot[baseId] = { used, purchased: hourlyPurchases.get(baseId) || 0 };
  }

  const bucketEndTime = Date.now();
  const bucket: HourlyBucket = {
    hourNumber,
    startValue: currentHourStartValue,
    endValue: finalGain,
    earnings: finalGain - currentHourStartValue,
    history: [...hourlyHistory],
    timestamp: hourlyStartTime, // Keep for backwards compatibility
    duration: hourlyElapsedSeconds,
    inventorySnapshot,
    pricesSnapshot: priceCache,
    includedItems: includedItemsArray,
    usageSnapshot,
    customName: undefined,
    bucketStartTime: hourlyStartTime, // When this bucket actually started
    bucketEndTime: bucketEndTime, // When this bucket actually ended
    sessionId // All buckets from this session share same ID
  };
  hourlyBuckets.push(bucket);
  setHourlyBuckets(hourlyBuckets);

  // Save complete session to disk
  await electronAPI.saveHourlySession(hourlyBuckets);

  // Reset session ID so next session gets a new one
  delete (window as any).currentSessionId;

  // Show breakdown modal
  showBreakdownModal();

  // UI reset
  startHourlyBtn.style.display = 'inline-block';
  stopHourlyBtn.style.display = 'none';
  pauseHourlyBtn.style.display = 'none';
  resumeHourlyBtn.style.display = 'none';
  hourlyTimerEl.textContent = '00:00:00';
  setHourlyElapsedSeconds(0);

  // Reset state flags
  setIsHourlyActive(false);
  setHourlyPaused(false);

  // Update UI to show all items (not just gained items) after stopping hourly mode
  renderInventory();
  renderBreakdown();

  // Update overlay widget with realtime data since hourly mode ended
  updateOverlayWidgetData();
}

/**
 * Update hourly wealth display and calculations
 */
export function updateHourlyWealth(): void {
  const gainedValue = getHourlyWealthGain();
  const elapsedTimeHours = getHourlyElapsedSeconds() / 3600;
  const rate = elapsedTimeHours > 0 ? gainedValue / elapsedTimeHours : 0;
  
  // Update hourly display (allow negative values)
  if (getWealthMode() === 'hourly') {
    wealthValueEl.textContent = gainedValue.toFixed(2);
    wealthHourlyEl.textContent = rate.toFixed(2);
  }
  
  // Update overlay widget with current data
  updateOverlayWidgetData();
}
