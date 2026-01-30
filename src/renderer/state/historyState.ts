// History page state management

export interface HistoryDate {
  date: string; // YYYY-MM-DD format
  displayDate: string; // Formatted date string
  buckets: HistoryHourBucket[];
}

export interface HistoryHourBucket {
  hour: number; // 0-23
  timestamp: number; // Unix timestamp
  items: HistoryItem[];
  totalFe: number;
  duration: number; // seconds
}

export interface HistoryItem {
  baseId: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
  iconPath?: string;
}

// History data storage
let historyDates: HistoryDate[] = [];
let selectedDate: string | null = null;
let selectedHour: number | null = null;

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

// Helper functions
export function loadHistoryData(): void {
  // TODO: Load history data from database/storage
  // This will be implemented later
}

export function getOverviewStats(): {
  totalDuration: number;
  fePerHour: number;
  totalFe: number;
  bucketsCount: number;
} {
  // TODO: Calculate overview stats based on selected date/hour
  return {
    totalDuration: 0,
    fePerHour: 0,
    totalFe: 0,
    bucketsCount: 0
  };
}
