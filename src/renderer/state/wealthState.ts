// Wealth tracking state management

import { WealthMode, HourlyBucket } from '../types.js';

// Wealth mode
let wealthMode: WealthMode = 'realtime';

// History data
let realtimeHistory: { time: number; value: number }[] = [];
let hourlyHistory: { time: number; value: number }[] = [];

// Hourly mode state
let hourlyStartSnapshot: Map<string, number> = new Map(); // baseId -> quantity
let hourlyStartTime = 0;
let hourlyElapsedSeconds = 0;
let isHourlyActive = false;
let hourlyPaused = false;

// Compass/beacon tracking
let includedItems: Set<string> = new Set(); // baseId -> track usage for this item
let compassBeaconSelectionState: Set<string> | null = null;
let previousQuantities: Map<string, number> = new Map(); // baseId -> previous quantity
let hourlyUsage: Map<string, number> = new Map(); // baseId -> quantity used this hour
let hourlyPurchases: Map<string, number> = new Map(); // baseId -> quantity purchased this hour

// Hourly buckets
let hourlyBuckets: HourlyBucket[] = [];
let currentHourStartValue = 0;

// Realtime tracking state
let realtimeStartValue = 0;
let realtimeStartTime = 0;
let realtimeElapsedSeconds = 0;
let isRealtimeInitialized = false;

// Wealth mode getters/setters
export function getWealthMode(): WealthMode {
  return wealthMode;
}

export function setWealthMode(mode: WealthMode): void {
  wealthMode = mode;
}

// History getters/setters
export function getRealtimeHistory(): { time: number; value: number }[] {
  return realtimeHistory;
}

export function setRealtimeHistory(history: { time: number; value: number }[]): void {
  realtimeHistory = history;
}

export function getHourlyHistory(): { time: number; value: number }[] {
  return hourlyHistory;
}

export function setHourlyHistory(history: { time: number; value: number }[]): void {
  hourlyHistory = history;
}

// Hourly state getters/setters
export function getHourlyStartSnapshot(): Map<string, number> {
  return hourlyStartSnapshot;
}

export function setHourlyStartSnapshot(snapshot: Map<string, number>): void {
  hourlyStartSnapshot = snapshot;
}

export function getHourlyStartTime(): number {
  return hourlyStartTime;
}

export function setHourlyStartTime(time: number): void {
  hourlyStartTime = time;
}

export function getHourlyElapsedSeconds(): number {
  return hourlyElapsedSeconds;
}

export function setHourlyElapsedSeconds(seconds: number): void {
  hourlyElapsedSeconds = seconds;
}

export function getIsHourlyActive(): boolean {
  return isHourlyActive;
}

export function setIsHourlyActive(active: boolean): void {
  isHourlyActive = active;
}

export function getHourlyPaused(): boolean {
  return hourlyPaused;
}

export function setHourlyPaused(paused: boolean): void {
  hourlyPaused = paused;
}

// Compass/beacon tracking getters/setters
export function getIncludedItems(): Set<string> {
  return includedItems;
}

export function setIncludedItems(items: Set<string>): void {
  includedItems = items;
}

export function getCompassBeaconSelectionState(): Set<string> | null {
  return compassBeaconSelectionState;
}

export function setCompassBeaconSelectionState(state: Set<string> | null): void {
  compassBeaconSelectionState = state;
}

export function getPreviousQuantities(): Map<string, number> {
  return previousQuantities;
}

export function setPreviousQuantities(quantities: Map<string, number>): void {
  previousQuantities = quantities;
}

export function getHourlyUsage(): Map<string, number> {
  return hourlyUsage;
}

export function setHourlyUsage(usage: Map<string, number>): void {
  hourlyUsage = usage;
}

export function getHourlyPurchases(): Map<string, number> {
  return hourlyPurchases;
}

export function setHourlyPurchases(purchases: Map<string, number>): void {
  hourlyPurchases = purchases;
}

// Hourly buckets getters/setters
export function getHourlyBuckets(): HourlyBucket[] {
  return hourlyBuckets;
}

export function setHourlyBuckets(buckets: HourlyBucket[]): void {
  hourlyBuckets = buckets;
}

export function getCurrentHourStartValue(): number {
  return currentHourStartValue;
}

export function setCurrentHourStartValue(value: number): void {
  currentHourStartValue = value;
}

// Realtime state getters/setters
export function getRealtimeStartValue(): number {
  return realtimeStartValue;
}

export function setRealtimeStartValue(value: number): void {
  realtimeStartValue = value;
}

export function getRealtimeStartTime(): number {
  return realtimeStartTime;
}

export function setRealtimeStartTime(time: number): void {
  realtimeStartTime = time;
}

export function getRealtimeElapsedSeconds(): number {
  return realtimeElapsedSeconds;
}

export function setRealtimeElapsedSeconds(seconds: number): void {
  realtimeElapsedSeconds = seconds;
}

export function getIsRealtimeInitialized(): boolean {
  return isRealtimeInitialized;
}

export function setIsRealtimeInitialized(initialized: boolean): void {
  isRealtimeInitialized = initialized;
}
