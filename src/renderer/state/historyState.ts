// History page state management

import { HourlyBucket, SavedHourlySession, ElectronAPI } from '../types.js';

declare const electronAPI: ElectronAPI;

export interface HistoryDate {
  date: string; // YYYY-MM-DD format
  displayDate: string; // Formatted date string
  buckets: HourlyBucket[];
}

// History data storage
let historyDates: HistoryDate[] = [];
let selectedDate: string | null = null;
let selectedHour: number | null = null;
let savedSessions: SavedHourlySession[] = [];

// Getters
export function getHistoryDates(): HistoryDate[] {
  return historyDates;
}

export function getSelectedDate(): string | null {
  return selectedDate;
}

export function getSelectedHour(): number | null {
  return selectedHour;
}

export function getCurrentHistoryData(): HistoryDate | null {
  if (!selectedDate) return null;
  return historyDates.find(d => d.date === selectedDate) || null;
}

export function getSavedSessions(): SavedHourlySession[] {
  return savedSessions;
}

// Setters
export function setHistoryDates(dates: HistoryDate[]): void {
  historyDates = dates;
}

export function setSelectedDate(date: string | null): void {
  selectedDate = date;
}

export function setSelectedHour(hour: number | null): void {
  selectedHour = hour;
}

export function setSavedSessions(sessions: SavedHourlySession[]): void {
  savedSessions = sessions;
}

// Helper functions
export async function loadHistoryData(): Promise<void> {
  savedSessions = await electronAPI.loadHourlySessions();
  
  // Group buckets by date from all sessions
  const dateMap = new Map<string, { date: string; displayDate: string; buckets: HourlyBucket[] }>();
  
  for (const session of savedSessions) {
    for (const bucket of session.buckets) {
      const date = new Date(bucket.timestamp);
      const dateStr = formatDate(date);
      const displayDateStr = formatDateDisplay(date);
      
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, { date: dateStr, displayDate: displayDateStr, buckets: [] });
      }
      
      dateMap.get(dateStr)!.buckets.push(bucket);
    }
  }
  
  // Merge buckets with the same hour number within each date
  for (const dateData of dateMap.values()) {
    dateData.buckets = mergeBucketsByHour(dateData.buckets);
  }
  
  // Sort dates descending
  historyDates = Array.from(dateMap.values())
    .map(d => ({ date: d.date, displayDate: d.displayDate, buckets: d.buckets }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Merge buckets with the same hour number
 */
function mergeBucketsByHour(buckets: HourlyBucket[]): HourlyBucket[] {
  const hourMap = new Map<number, HourlyBucket[]>();
  
  // Group buckets by hour number
  for (const bucket of buckets) {
    if (!hourMap.has(bucket.hourNumber)) {
      hourMap.set(bucket.hourNumber, []);
    }
    hourMap.get(bucket.hourNumber)!.push(bucket);
  }
  
  // Merge each group
  const mergedBuckets: HourlyBucket[] = [];
  for (const [hourNumber, hourBuckets] of hourMap) {
    // Sort by timestamp to ensure correct order
    hourBuckets.sort((a, b) => a.timestamp - b.timestamp);
    
    if (hourBuckets.length === 1) {
      mergedBuckets.push(hourBuckets[0]);
      continue;
    }
    
    // Merge multiple buckets for the same hour
    const first = hourBuckets[0];
    const last = hourBuckets[hourBuckets.length - 1];
    
    // Sum earnings and durations
    const totalEarnings = hourBuckets.reduce((sum, b) => sum + b.earnings, 0);
    const totalDuration = hourBuckets.reduce((sum, b) => sum + b.duration, 0);
    
    // Combine and sort history points
    const combinedHistory: { time: number; value: number }[] = [];
    for (const bucket of hourBuckets) {
      combinedHistory.push(...bucket.history);
    }
    combinedHistory.sort((a, b) => a.time - b.time);
    
    // Merge usage snapshots
    const mergedUsageSnapshot: { [baseId: string]: { used: number; purchased: number } } = {};
    for (const bucket of hourBuckets) {
      for (const [baseId, usage] of Object.entries(bucket.usageSnapshot)) {
        if (!mergedUsageSnapshot[baseId]) {
          mergedUsageSnapshot[baseId] = { used: 0, purchased: 0 };
        }
        mergedUsageSnapshot[baseId].used += usage.used;
        mergedUsageSnapshot[baseId].purchased += usage.purchased;
      }
    }
    
    // Use the earliest start value and the latest end value
    const mergedBucket: HourlyBucket = {
      hourNumber,
      startValue: first.startValue,
      endValue: last.endValue,
      earnings: totalEarnings,
      history: combinedHistory,
      timestamp: first.timestamp, // Use the earliest timestamp
      duration: totalDuration,
      inventorySnapshot: last.inventorySnapshot, // Use the latest inventory snapshot
      pricesSnapshot: last.pricesSnapshot, // Use the latest prices
      includedItems: last.includedItems,
      usageSnapshot: mergedUsageSnapshot,
      customName: hourBuckets.find(b => b.customName)?.customName // Preserve custom name if any bucket has one
    };
    
    mergedBuckets.push(mergedBucket);
  }
  
  // Sort merged buckets by hour number
  mergedBuckets.sort((a, b) => a.hourNumber - b.hourNumber);
  
  return mergedBuckets;
}

export function getOverviewStats(): {
  totalDuration: number;
  fePerHour: number;
  totalFe: number;
  bucketsCount: number;
} {
  const data = getCurrentHistoryData();
  const selectedHour = getSelectedHour();
  
  if (!data || data.buckets.length === 0) {
    return {
      totalDuration: 0,
      fePerHour: 0,
      totalFe: 0,
      bucketsCount: 0
    };
  }
  
  // Get buckets to calculate stats for
  const bucketsToCalc = selectedHour !== null
    ? data.buckets.filter(b => b.hourNumber === selectedHour)
    : data.buckets;
  
  // Calculate stats
  const totalDuration = bucketsToCalc.reduce((sum, b) => sum + b.duration, 0);
  const totalFe = bucketsToCalc.reduce((sum, b) => sum + b.earnings, 0);
  const bucketsCount = bucketsToCalc.length;
  const fePerHour = totalDuration > 0 ? (totalFe / (totalDuration / 3600)) : 0;
  
  return {
    totalDuration,
    fePerHour,
    totalFe,
    bucketsCount
  };
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(date: Date): string {
  const month = date.toLocaleString('default', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
}
