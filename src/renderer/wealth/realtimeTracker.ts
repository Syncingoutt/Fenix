// Realtime wealth tracking

import { getCurrentTotalValue } from './wealthCalculations.js';
import {
  getRealtimeStartValue,
  setRealtimeStartValue,
  getRealtimeStartTime,
  setRealtimeStartTime,
  getRealtimeElapsedSeconds,
  setRealtimeElapsedSeconds,
  getIsRealtimeInitialized,
  setIsRealtimeInitialized,
  getRealtimeHistory,
  setRealtimeHistory,
  getWealthMode
} from '../state/wealthState.js';
import { getMapStats } from '../state/mapHistoryState.js';
import { formatTime } from '../utils/formatting.js';
import { ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

// These will be set by the main renderer
let wealthValueEl: HTMLElement;
let wealthHourlyEl: HTMLElement;
let timerEl: HTMLElement;
let avgTimePerMapEl: HTMLElement;
let updateOverlayWidgetData: () => void;
let pushRealtimePoint: (value: number) => void;

export function initRealtimeTracker(
  wealthValueElement: HTMLElement,
  wealthHourlyElement: HTMLElement,
  timerElement: HTMLElement,
  avgTimePerMapElement: HTMLElement,
  overlayWidgetUpdater: () => void,
  pushPointFn: (value: number) => void
): void {
  wealthValueEl = wealthValueElement;
  wealthHourlyEl = wealthHourlyElement;
  timerEl = timerElement;
  avgTimePerMapEl = avgTimePerMapElement;
  updateOverlayWidgetData = overlayWidgetUpdater;
  pushRealtimePoint = pushPointFn;
  updateAverageTimePerMap();
}

/**
 * Initialize realtime tracking with current inventory value
 */
export function initRealtimeTracking(): void {
  const startValue = getCurrentTotalValue();
  setRealtimeStartValue(startValue);
  setRealtimeStartTime(Date.now());
  pushRealtimePoint(startValue);
}

/**
 * Reset realtime timer and tracking
 */
export function resetRealtimeTracking(): void {

  // Reset timer state
  setRealtimeElapsedSeconds(0);
  setRealtimeStartTime(Date.now());

  // Update start value to current total (so per hour calculation starts fresh)
  const currentValue = getCurrentTotalValue();
  setRealtimeStartValue(currentValue);

  // Clear realtime history graph
  setRealtimeHistory([]);

  // Tell main process to reset the timer
  electronAPI.resetRealtimeTimer();

  // Update display immediately
  timerEl.textContent = formatTime(0);
  updateRealtimeWealth();

  // Reset graph with current value
  pushRealtimePoint(currentValue);

  // Update average time per map
  updateAverageTimePerMap();
}

/**
 * Update realtime wealth display and calculations
 */
export function updateRealtimeWealth(): void {
  const currentValue = getCurrentTotalValue();
  const elapsedTimeHours = getRealtimeElapsedSeconds() / 3600;
  const startValue = getRealtimeStartValue();
  const rate = elapsedTimeHours > 0 ? (currentValue - startValue) / elapsedTimeHours : 0;

  // Always track Total (realtime) regardless of current mode
  pushRealtimePoint(currentValue);

  // Update realtime display only when in realtime mode
  if (getWealthMode() === 'realtime') {
    wealthValueEl.textContent = currentValue.toFixed(2);
    wealthHourlyEl.textContent = rate.toFixed(2);
    updateAverageTimePerMap();
  }

  // Update overlay widget with current data
  updateOverlayWidgetData();
}

/**
 * Initialize realtime timer from main process state
 */
export async function initRealtimeTimer(): Promise<void> {
  const state = await electronAPI.getTimerState();
  setRealtimeElapsedSeconds(state.realtimeSeconds);
  timerEl.textContent = formatTime(state.realtimeSeconds);
}

/**
 * Update the average time per map display
 */
export function updateAverageTimePerMap(): void {
  if (!avgTimePerMapEl) return;
  const stats = getMapStats();
  const avgDurationSeconds = Math.round(stats.averageDuration);
  const minutes = Math.floor(avgDurationSeconds / 60);
  const seconds = avgDurationSeconds % 60;
  avgTimePerMapEl.textContent = `Avg time per map: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

