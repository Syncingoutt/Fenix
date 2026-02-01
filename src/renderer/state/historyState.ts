// History page state management

import { HourlyBucket, SavedHourlySession, ElectronAPI } from '../types.js';
import { mergeBucketsByHour, mergeConsecutiveHours } from '../../utils/bucketUtils.js';

declare const electronAPI: ElectronAPI;

export interface HistoryDate {
  date: string; // YYYY-MM-DD format
  displayDate: string; // Formatted date string
  buckets: HourlyBucket[];
}

// History data storage
let historyDates: HistoryDate[] = [];
let selectedDate: string | null = null;
let selectedBucketStartTime: number | null = null; // Changed from selectedHour to selectedBucketStartTime for unique identification
let savedSessions: SavedHourlySession[] = [];

// Getters
export function getHistoryDates(): HistoryDate[] {
  return historyDates;
}

export function getSelectedDate(): string | null {
  return selectedDate;
}

export function getSelectedHour(): number | null {
  // For backward compatibility, return hourNumber from the selected bucket
  if (selectedBucketStartTime === null) return null;
  const data = getCurrentHistoryData();
  if (!data) return null;
  const bucket = data.buckets.find(b => b.bucketStartTime === selectedBucketStartTime);
  return bucket ? bucket.hourNumber : null;
}

export function getSelectedBucketStartTime(): number | null {
  return selectedBucketStartTime;
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
  // For backward compatibility, find bucket by hourNumber and select it
  if (hour === null) {
    selectedBucketStartTime = null;
    return;
  }
  const data = getCurrentHistoryData();
  if (!data) {
    selectedBucketStartTime = null;
    return;
  }
  const bucket = data.buckets.find(b => b.hourNumber === hour);
  selectedBucketStartTime = bucket?.bucketStartTime ?? null;
}

export function setSelectedBucketStartTime(bucketStartTime: number | null): void {
  selectedBucketStartTime = bucketStartTime;
}

export function setSavedSessions(sessions: SavedHourlySession[]): void {
  savedSessions = sessions;
}

// Helper functions
export async function loadHistoryData(): Promise<void> {
  savedSessions = await electronAPI.loadHourlySessions();

  // Group buckets by date based on bucket end time, not just bucket hour number
  // This handles cross-day sessions (e.g., 11:30 PM to 1:00 AM shows up on Jan 31)
  const dateMap = new Map<string, { date: string; displayDate: string; buckets: HourlyBucket[] }>();

  for (const session of savedSessions) {
    for (const bucket of session.buckets) {
      // Use bucketEndTime if available, otherwise fall back to timestamp + duration
      const bucketEndTime = bucket.bucketEndTime || (bucket.timestamp + bucket.duration * 1000);
      const date = new Date(bucketEndTime);
      const dateStr = formatDate(date);
      const displayDateStr = formatDateDisplay(date);

      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, { date: dateStr, displayDate: displayDateStr, buckets: [] });
      }

      dateMap.get(dateStr)!.buckets.push(bucket);
    }
  }

  // First merge buckets with same hour within same session
  for (const dateData of dateMap.values()) {
    dateData.buckets = mergeBucketsByHour(dateData.buckets);
  }

  // Then merge consecutive hours within same session
  for (const dateData of dateMap.values()) {
    dateData.buckets = mergeConsecutiveHours(dateData.buckets);
  }

  // Sort dates descending
  historyDates = Array.from(dateMap.values())
    .map(d => ({ date: d.date, displayDate: d.displayDate, buckets: d.buckets }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getOverviewStats(): {
  totalDuration: number;
  fePerHour: number;
  totalFe: number;
  bucketsCount: number;
} {
  const data = getCurrentHistoryData();
  const selectedBucketStartTime = getSelectedBucketStartTime();

  if (!data || data.buckets.length === 0) {
    return {
      totalDuration: 0,
      fePerHour: 0,
      totalFe: 0,
      bucketsCount: 0
    };
  }

  // Get buckets to calculate stats for
  const bucketsToCalc = selectedBucketStartTime !== null
    ? data.buckets.filter(b => b.bucketStartTime === selectedBucketStartTime)
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
